"""
db.py — SQLite database persistence layer for MG Attendance.

Replaces flat JSON (users.json) and CSV (attendance.csv) with a transactional,
ACID-compliant SQLite database (data/attendance.db) in WAL mode.
"""

import os
import sqlite3
import logging
from contextlib import contextmanager
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "attendance.db")


@contextmanager
def get_db():
    """Context manager for SQLite connections with WAL mode and row factory."""
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=20.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Create database tables and indices if they do not exist."""
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL COLLATE NOCASE,
                student_number TEXT COLLATE NOCASE,
                employee_id TEXT COLLATE NOCASE,
                email TEXT COLLATE NOCASE,
                phone TEXT,
                department TEXT,
                position TEXT,
                notes TEXT,
                temp_password TEXT,
                password_hash TEXT,
                salt TEXT,
                account_id TEXT COLLATE NOCASE,
                role TEXT DEFAULT 'student',
                credentials_sent INTEGER DEFAULT 0,
                credentials_sent_at TEXT,
                year_level INTEGER DEFAULT 1,
                is_deployed INTEGER DEFAULT 0,
                last_academic_year INTEGER,
                created_at TEXT,
                updated_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_users_student_number ON users(student_number);
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_account_id ON users(account_id);

            CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL COLLATE NOCASE,
                timestamp TEXT NOT NULL,
                event_type TEXT NOT NULL,
                date TEXT NOT NULL,
                status TEXT DEFAULT 'ON_TIME'
            );

            CREATE INDEX IF NOT EXISTS idx_attendance_name_date ON attendance(name, date);
            CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
            CREATE INDEX IF NOT EXISTS idx_attendance_timestamp ON attendance(timestamp);
        """)

        # Migration: ensure status column exists if attendance table was already created
        cursor = conn.execute("PRAGMA table_info(attendance)")
        existing_cols = {row["name"] for row in cursor.fetchall()}
        if "status" not in existing_cols:
            conn.execute("ALTER TABLE attendance ADD COLUMN status TEXT DEFAULT 'ON_TIME'")
            logger.info("Migrated attendance table: added 'status' column.")

        conn.execute("CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);")

        # Migration: ensure year_level, is_deployed, last_academic_year exist in users table
        user_cursor = conn.execute("PRAGMA table_info(users)")
        existing_user_cols = {row["name"] for row in user_cursor.fetchall()}
        if "year_level" not in existing_user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN year_level INTEGER DEFAULT 1")
            logger.info("Migrated users table: added 'year_level' column.")
        if "is_deployed" not in existing_user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN is_deployed INTEGER DEFAULT 0")
            logger.info("Migrated users table: added 'is_deployed' column.")
        if "last_academic_year" not in existing_user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN last_academic_year INTEGER")
            logger.info("Migrated users table: added 'last_academic_year' column.")

        # Run auto-increment check on initialization
        auto_increment_year_levels(conn)

    logger.info("SQLite database initialized at: %s", DB_PATH)


def get_current_academic_year(dt: Optional[Any] = None) -> int:
    """Returns starting year of the academic year based on July rollover.
    July to Dec of year Y is AY Y-(Y+1).
    Jan to June of year Y is AY (Y-1)-Y.
    """
    from src.utils import get_pht_now
    now = dt or get_pht_now()
    return now.year if now.month >= 7 else (now.year - 1)


def auto_increment_year_levels(conn: sqlite3.Connection):
    """Automatically increments student year level on the month of July.
    - If last_academic_year is NULL, initializes it to current_ay.
    - If last_academic_year < current_ay, increments year_level up to max 4,
      and updates last_academic_year = current_ay.
    """
    current_ay = get_current_academic_year()
    conn.execute("UPDATE users SET last_academic_year = ? WHERE last_academic_year IS NULL", (current_ay,))
    conn.execute("""
        UPDATE users
        SET year_level = MIN(4, COALESCE(year_level, 1) + (? - last_academic_year)),
            last_academic_year = ?
        WHERE last_academic_year < ?
    """, (current_ay, current_ay, current_ay))


def db_row_to_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    d = dict(row)
    d["credentials_sent"] = bool(d.get("credentials_sent", 0))
    d["year_level"] = int(d.get("year_level") or 1)
    d["is_deployed"] = bool(d.get("is_deployed", 0))
    d["last_academic_year"] = d.get("last_academic_year")
    return d


def load_user_profiles() -> Dict[str, Dict[str, Any]]:
    """Return all user profiles keyed by sanitized name."""
    init_db()
    with get_db() as conn:
        auto_increment_year_levels(conn)
        cursor = conn.execute("SELECT * FROM users ORDER BY name ASC")
        rows = cursor.fetchall()
        profiles = {}
        for r in rows:
            d = db_row_to_dict(r)
            if d:
                profiles[d["name"]] = d
        return profiles


def save_user_profile(name: str, fields: Dict[str, Any]) -> Dict[str, Any]:
    """Insert or update user profile for `name`."""
    from src.utils import sanitize_name, get_pht_now
    clean_name = sanitize_name(name)
    if not clean_name:
        raise ValueError("Name cannot be empty.")

    now_str = get_pht_now().strftime("%Y-%m-%d %H:%M:%S")
    current_ay = get_current_academic_year()
    init_db()

    with get_db() as conn:
        existing = conn.execute("SELECT * FROM users WHERE name = ?", (clean_name,)).fetchone()
        if existing:
            current = dict(existing)
            student_num = fields.get("student_number") if "student_number" in fields else current.get("student_number", "")
            emp_id = fields.get("employee_id") if "employee_id" in fields else (student_num or current.get("employee_id", ""))
            email = fields.get("email") if "email" in fields else current.get("email", "")
            phone = fields.get("phone") if "phone" in fields else current.get("phone", "")
            department = fields.get("department") if "department" in fields else current.get("department", "")
            position = fields.get("position") if "position" in fields else current.get("position", "")
            notes = fields.get("notes") if "notes" in fields else current.get("notes", "")
            temp_pwd = fields.get("temp_password") if "temp_password" in fields else current.get("temp_password")
            pwd_hash = fields.get("password_hash") if "password_hash" in fields else current.get("password_hash", "")
            salt = fields.get("salt") if "salt" in fields else current.get("salt", "")
            account_id = fields.get("account_id") if "account_id" in fields else (student_num or current.get("account_id", ""))
            role = fields.get("role") if "role" in fields else current.get("role", "student")
            cred_sent = int(fields.get("credentials_sent")) if "credentials_sent" in fields else current.get("credentials_sent", 0)
            cred_sent_at = fields.get("credentials_sent_at") if "credentials_sent_at" in fields else current.get("credentials_sent_at")

            raw_yl = fields.get("year_level", current.get("year_level", 1))
            year_level = max(1, min(4, int(raw_yl or 1)))

            raw_dep = fields.get("is_deployed", current.get("is_deployed", 0))
            is_deployed = 1 if raw_dep else 0
            # Deployed toggle is only allowed for BSSW 4 students
            if department != "BSSW" or year_level != 4:
                is_deployed = 0

            conn.execute("""
                UPDATE users SET
                    student_number = ?,
                    employee_id = ?,
                    email = ?,
                    phone = ?,
                    department = ?,
                    position = ?,
                    notes = ?,
                    temp_password = ?,
                    password_hash = ?,
                    salt = ?,
                    account_id = ?,
                    role = ?,
                    credentials_sent = ?,
                    credentials_sent_at = ?,
                    year_level = ?,
                    is_deployed = ?,
                    last_academic_year = ?,
                    updated_at = ?
                WHERE name = ?
            """, (
                student_num, emp_id, email, phone, department, position, notes,
                temp_pwd, pwd_hash, salt, account_id, role, cred_sent, cred_sent_at,
                year_level, is_deployed, current_ay,
                now_str, clean_name
            ))
        else:
            student_num = fields.get("student_number", "") or fields.get("employee_id", "")
            emp_id = fields.get("employee_id", "") or student_num
            email = fields.get("email", "")
            phone = fields.get("phone", "")
            department = fields.get("department", "")
            position = fields.get("position", "")
            notes = fields.get("notes", "")
            temp_pwd = fields.get("temp_password")
            pwd_hash = fields.get("password_hash", "")
            salt = fields.get("salt", "")
            account_id = fields.get("account_id", "") or student_num or clean_name
            role = fields.get("role", "student")
            cred_sent = int(fields.get("credentials_sent", False))
            cred_sent_at = fields.get("credentials_sent_at")

            raw_yl = fields.get("year_level", 1)
            year_level = max(1, min(4, int(raw_yl or 1)))

            raw_dep = fields.get("is_deployed", 0)
            is_deployed = 1 if raw_dep else 0
            if department != "BSSW" or year_level != 4:
                is_deployed = 0

            conn.execute("""
                INSERT INTO users (
                    name, student_number, employee_id, email, phone, department,
                    position, notes, temp_password, password_hash, salt, account_id,
                    role, credentials_sent, credentials_sent_at, year_level, is_deployed,
                    last_academic_year, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                clean_name, student_num, emp_id, email, phone, department,
                position, notes, temp_pwd, pwd_hash, salt, account_id,
                role, cred_sent, cred_sent_at, year_level, is_deployed,
                current_ay, now_str, now_str
            ))

        updated_row = conn.execute("SELECT * FROM users WHERE name = ?", (clean_name,)).fetchone()
        return db_row_to_dict(updated_row) or {}


def delete_user_profile(name: str) -> bool:
    """Delete profile for `name` from database."""
    from src.utils import sanitize_name
    clean_name = sanitize_name(name)
    init_db()
    with get_db() as conn:
        cur = conn.execute("DELETE FROM users WHERE name = ?", (clean_name,))
        return cur.rowcount > 0


def verify_user_credentials(identifier: str, password: str) -> Optional[Dict[str, Any]]:
    """Verify student credentials against SQLite database."""
    from src.utils import _hash_password
    if not identifier or not password:
        return None

    clean_id = identifier.strip()
    init_db()
    with get_db() as conn:
        row = conn.execute("""
            SELECT * FROM users
            WHERE student_number = ? OR employee_id = ? OR email = ? OR account_id = ? OR name = ?
            LIMIT 1
        """, (clean_id, clean_id, clean_id.lower(), clean_id, clean_id)).fetchone()

        if not row:
            return None

        user = db_row_to_dict(row)
        if not user:
            return None

        salt = user.get("salt")
        pwd_hash = user.get("password_hash")
        temp_pwd = user.get("temp_password")

        if pwd_hash and salt:
            if _hash_password(password.strip(), salt) == pwd_hash:
                return user

        if temp_pwd and password.strip() == temp_pwd.strip():
            return user

    return None


def set_user_password(name: str, new_password: str) -> bool:
    """Update password for user in SQLite."""
    import secrets
    from src.utils import sanitize_name, _hash_password, get_pht_now
    clean_name = sanitize_name(name)
    salt = secrets.token_hex(16)
    pwd_hash = _hash_password(new_password.strip(), salt)
    now_str = get_pht_now().strftime("%Y-%m-%d %H:%M:%S")

    init_db()
    with get_db() as conn:
        cur = conn.execute("""
            UPDATE users SET
                salt = ?,
                password_hash = ?,
                temp_password = NULL,
                updated_at = ?
            WHERE name = ?
        """, (salt, pwd_hash, now_str, clean_name))
        return cur.rowcount > 0


def _infer_attendance_status(ts_str: str) -> str:
    """Infer attendance status from timestamp if column was previously null."""
    try:
        from datetime import datetime
        dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
        # Saturday (weekday 5): 2:00 - 6:30 clean, 6:31 - 7:30 late
        if dt.weekday() == 5:
            sec = dt.hour * 3600 + dt.minute * 60 + dt.second
            if sec <= 23400:  # 06:30:00
                return "ON_TIME"
            return "LATE"
        sec = dt.hour * 3600 + dt.minute * 60 + dt.second
        if sec < 18900:  # before 05:15:00
            return "ON_TIME"
        return "LATE"
    except Exception:
        return "ON_TIME"


def log_attendance_db(
    name: str,
    event_type: str = "IN",
    timestamp_str: Optional[str] = None,
    status: str = "ON_TIME",
) -> bool:
    """Log an attendance event to SQLite."""
    from src.utils import sanitize_name, get_pht_now
    clean_name = sanitize_name(name)
    if not clean_name:
        return False

    now = get_pht_now()
    ts = timestamp_str or now.strftime("%Y-%m-%d %H:%M:%S")
    date_str = ts.split(" ")[0] if " " in ts else now.strftime("%Y-%m-%d")

    init_db()
    with get_db() as conn:
        conn.execute("""
            INSERT INTO attendance (name, timestamp, event_type, date, status)
            VALUES (?, ?, ?, ?, ?)
        """, (clean_name, ts, event_type, date_str, status))
    return True


def has_logged_in_today_db(name: str, date_str: str) -> bool:
    """Check if `name` has already logged an IN event on `date_str` (YYYY-MM-DD)."""
    from src.utils import sanitize_name
    clean_name = sanitize_name(name)
    init_db()
    with get_db() as conn:
        row = conn.execute("""
            SELECT 1 FROM attendance
            WHERE name = ? AND date = ? AND event_type = 'IN'
            LIMIT 1
        """, (clean_name, date_str)).fetchone()
        return row is not None


def find_todays_event_db(name: str, date_str: str, event_type: str) -> Optional[str]:
    """Find first event timestamp for `name` on `date_str` for given event_type."""
    from src.utils import sanitize_name
    clean_name = sanitize_name(name)
    init_db()
    with get_db() as conn:
        row = conn.execute("""
            SELECT timestamp FROM attendance
            WHERE name = ? AND date = ? AND event_type = ?
            ORDER BY timestamp ASC
            LIMIT 1
        """, (clean_name, date_str, event_type)).fetchone()
        return row["timestamp"] if row else None


def get_all_attendance_records(name: Optional[str] = None, month: Optional[str] = None) -> List[Dict[str, Any]]:
    """Return attendance records from SQLite with status."""
    init_db()
    with get_db() as conn:
        query = "SELECT name, timestamp, event_type, status FROM attendance"
        params = []
        conditions = []

        if name:
            conditions.append("name = ?")
            params.append(name.strip())
        if month:
            conditions.append("date LIKE ?")
            params.append(f"{month.strip()}%")

        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY timestamp ASC"

        rows = conn.execute(query, params).fetchall()
        return [
            {
                "name": r["name"],
                "timestamp": r["timestamp"],
                "type": r["event_type"],
                "status": r["status"] or _infer_attendance_status(r["timestamp"]),
            }
            for r in rows
        ]


def wipe_db():
    """Wipe all rows from users and attendance tables."""
    init_db()
    with get_db() as conn:
        conn.execute("DELETE FROM attendance;")
        conn.execute("DELETE FROM users;")
    logger.info("SQLite database tables (attendance, users) wiped clean.")
