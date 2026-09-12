"""
utils.py — Utility functions used by server.py.

Provides:
    - load_registered_faces()    — scan the registered_faces directory for JSON embeddings
    - register_face_embedding()  — detect+align+embed a captured image and save it as a new template
    - verify_face_roi()          — compare a cropped face ROI against a prebuilt match index
    - log_attendance()           — write to attendance.csv with deduplication
"""

import logging
import os
import csv
import json
import hashlib
import secrets
import time
from datetime import datetime, timezone, timedelta
try:
    from zoneinfo import ZoneInfo
    PHT_TZ = ZoneInfo("Asia/Manila")
except Exception:
    PHT_TZ = timezone(timedelta(hours=8))
from typing import Dict, Tuple, Optional

import cv2

from src.recognition import (
    find_match,
    get_embedding,
    build_match_index,
    find_embedding_match_indexed,
)
from src.db import (
    init_db,
    load_user_profiles as db_load_user_profiles,
    save_user_profile as db_save_user_profile,
    delete_user_profile as db_delete_user_profile,
    verify_user_credentials as db_verify_user_credentials,
    set_user_password as db_set_user_password,
    log_attendance_db,
    has_logged_in_today_db,
    find_todays_event_db,
    get_all_attendance_records,
    wipe_db,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths (relative to the project root)
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTERED_FACES_DIR = os.path.join(BASE_DIR, "data", "registered_faces")
UNKNOWN_LOGS_DIR = os.path.join(BASE_DIR, "data", "unknown_logs")
SPOOF_LOGS_DIR = os.path.join(BASE_DIR, "data", "spoof_logs")
ATTENDANCE_CSV = os.path.join(BASE_DIR, "data", "attendance.csv")
USERS_JSON = os.path.join(BASE_DIR, "data", "users.json")
SETTINGS_JSON = os.path.join(BASE_DIR, "data", "settings.json")

# Deduplication: don't log the same track_id again within this cooldown (seconds).
DEDUP_TRACK_COOLDOWN_SECONDS = 10

# Single daily check-in mode: resets at 12:00 AM Philippine Standard Time (UTC+8).
# In production mode (dev_mode=False), each student can only log IN once per calendar day.
DEV_MODE_DEFAULT = False
DEV_LOGIN_COOLDOWN_SECONDS = 60

# In-memory caches of last successful log times
_logged_tracks = {}  # {track_id: datetime}
_logged_names = {}   # {name: datetime}


def get_pht_now() -> datetime:
    """Return the current datetime in Philippine Standard Time (PST/PHT: UTC+8)."""
    return datetime.now(PHT_TZ)


def sanitize_name(person_name):
    """Strip characters invalid in Windows folder names, plus trailing
    dots/spaces (also invalid on Windows). Shared by face registration and
    user-profile storage so a person's face folder and profile record key
    on the same sanitized name."""
    return "".join(c for c in person_name if c not in '<>:"/\\|?*').strip(". ")


def load_registered_faces(expected_dim=None):
    """
    Scan ``data/registered_faces/`` and return a dict mapping each person's
    name to a list of their loaded embedding vectors (list of float).

    Expected folder layout::

        data/registered_faces/
            Alice/
                embedding_001.json
            Bob/
                embedding_001.json

    Parameters
    ----------
    expected_dim : int, optional
        If given, embeddings whose vector length doesn't match are skipped
        with a warning instead of being loaded — guards against stale
        embeddings saved under a previous MODEL_NAME (e.g. leftover
        VGG-Face vectors after switching to ArcFace).

    Returns
    -------
    dict[str, list[list[float]]]
        ``{"Alice": [[0.1, 0.2, ...], ...], ...}``
        Returns an empty dict if the directory doesn't exist or is empty.
    """
    registered = {}

    if not os.path.isdir(REGISTERED_FACES_DIR):
        logger.warning("Directory not found: %s", REGISTERED_FACES_DIR)
        os.makedirs(REGISTERED_FACES_DIR, exist_ok=True)
        return registered

    for person_name in sorted(os.listdir(REGISTERED_FACES_DIR)):
        person_dir = os.path.join(REGISTERED_FACES_DIR, person_name)
        if not os.path.isdir(person_dir):
            continue  # skip stray files at the top level

        embeddings = []
        for filename in os.listdir(person_dir):
            if os.path.splitext(filename)[1].lower() != ".json":
                continue

            filepath = os.path.join(person_dir, filename)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as e:
                logger.warning("Error loading embedding file %s: %s", filename, e)
                continue

            if not isinstance(data, list) or len(data) == 0:
                continue

            if expected_dim is not None and len(data) != expected_dim:
                logger.warning(
                    "Skipping '%s' for '%s': %d-d vector doesn't match the "
                    "current model's %d-d output. Re-register this person.",
                    filename, person_name, len(data), expected_dim,
                )
                continue

            embeddings.append(data)

        if embeddings:
            registered[person_name] = embeddings
            logger.info("Loaded %d profile template(s) for '%s'", len(embeddings), person_name)
        else:
            logger.warning("No valid templates in '%s'", person_dir)

    return registered


def register_face_embedding(person_name, image_bgr, detector_backend="yunet"):
    """
    Detect, align, and embed a face from a captured image, then save it as
    a new template under ``data/registered_faces/<person_name>/``.

    This passes the raw captured frame straight to a real detector (rather
    than a pre-cropped chip) so the face is both located and aligned.
    ``verify_face_roi`` uses the same detector backend on its (already
    cropped) chip for the live match, so both sides of a comparison are
    aligned consistently.

    Parameters
    ----------
    person_name : str
        Raw name as entered by the user; sanitized for the filesystem here.
    image_bgr : numpy.ndarray
        Full BGR image containing the face to register (not pre-cropped).
    detector_backend : str
        DeepFace detector backend to use. Defaults to "yunet", which needs
        no extra pip package (unlike "retinaface"/"mtcnn") and still does
        real landmark-based alignment.

    Returns
    -------
    tuple[str, int]
        (sanitized_person_name, total_template_count_for_this_person)

    Raises
    ------
    ValueError
        If the name is empty after sanitization, or no face could be
        detected in the image.
    """
    clean_name = sanitize_name(person_name)
    if not clean_name:
        raise ValueError("Name cannot be empty (or contained only invalid characters).")

    try:
        embedding = get_embedding(image_bgr, detector_backend=detector_backend, enforce_detection=True)
    except ValueError:
        embedding = None

    if embedding is None:
        raise ValueError("No face could be detected in the captured image.")

    # Directory is created lazily so a failed capture doesn't leave an
    # empty ghost profile behind.
    person_dir = os.path.join(REGISTERED_FACES_DIR, clean_name)
    os.makedirs(person_dir, exist_ok=True)

    photo_index = 1
    while os.path.exists(os.path.join(person_dir, f"embedding_{photo_index:03d}.json")):
        photo_index += 1
    filepath = os.path.join(person_dir, f"embedding_{photo_index:03d}.json")

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(embedding, f)

    template_count = sum(1 for fn in os.listdir(person_dir) if fn.lower().endswith(".json"))
    return clean_name, template_count


def load_settings():
    """Load ``data/settings.json`` — preferences the user changes from the UI
    at runtime (currently just ``camera_index``) that should survive a
    restart. Returns an empty dict if the file doesn't exist yet or is
    corrupt, so callers always fall back to the code defaults."""
    if not os.path.isfile(SETTINGS_JSON):
        return {}
    try:
        with open(SETTINGS_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception as e:
        logger.warning("Error loading %s: %s", SETTINGS_JSON, e)
        return {}


def save_settings(updates):
    """Merge ``updates`` into ``data/settings.json`` and return the full
    saved dict. Merges rather than overwrites so one setting's endpoint
    can't wipe another's."""
    settings = load_settings()
    settings.update(updates)
    os.makedirs(os.path.dirname(SETTINGS_JSON), exist_ok=True)
    with open(SETTINGS_JSON, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)
    return settings


DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "admin123"

_ACTIVE_ADMIN_TOKENS: Dict[str, Tuple[str, float]] = {}
TOKEN_LIFETIME_SECONDS = 86400 * 7  # 7 days


def _hash_password(password: str, salt: str) -> str:
    return hashlib.sha256((salt + password).encode("utf-8")).hexdigest()


def get_admin_credentials() -> Tuple[str, str, str]:
    """Returns (username, password_hash, salt). Initializes defaults in settings.json if not set."""
    settings = load_settings()
    username = settings.get("admin_username")
    pwd_hash = settings.get("admin_password_hash")
    salt = settings.get("admin_salt")

    if not username or not pwd_hash or not salt:
        salt = secrets.token_hex(16)
        pwd_hash = _hash_password(DEFAULT_ADMIN_PASSWORD, salt)
        username = DEFAULT_ADMIN_USERNAME
        save_settings({
            "admin_username": username,
            "admin_password_hash": pwd_hash,
            "admin_salt": salt,
        })
    return username, pwd_hash, salt


def verify_admin_credentials(username: str, password: str) -> bool:
    cur_user, cur_hash, salt = get_admin_credentials()
    if username.strip() != cur_user:
        return False
    return _hash_password(password, salt) == cur_hash


def update_admin_credentials(new_username: Optional[str], new_password: Optional[str]) -> bool:
    cur_user, _, _ = get_admin_credentials()
    salt = secrets.token_hex(16)
    updates = {}
    if new_username and new_username.strip():
        updates["admin_username"] = new_username.strip()
    else:
        updates["admin_username"] = cur_user

    if new_password and new_password.strip():
        updates["admin_password_hash"] = _hash_password(new_password.strip(), salt)
        updates["admin_salt"] = salt

    save_settings(updates)
    return True


_ACTIVE_ADMIN_TOKENS = {}  # {token: (username, expiry)}
_ACTIVE_USER_TOKENS = {}   # {token: {"username": str, "role": str, "expiry": float, "user_info": dict}}


def create_admin_token(username: str) -> str:
    token = secrets.token_urlsafe(32)
    _ACTIVE_ADMIN_TOKENS[token] = (username, time.time() + TOKEN_LIFETIME_SECONDS)
    return token


def verify_admin_token(token: str) -> Optional[str]:
    if not token:
        return None
    entry = _ACTIVE_ADMIN_TOKENS.get(token)
    if not entry:
        return None
    username, expiry = entry
    if time.time() > expiry:
        _ACTIVE_ADMIN_TOKENS.pop(token, None)
        return None
    return username


def revoke_admin_token(token: str):
    _ACTIVE_ADMIN_TOKENS.pop(token, None)
    _ACTIVE_USER_TOKENS.pop(token, None)


def create_user_token(username: str, role: str = "student", user_info: Optional[dict] = None) -> str:
    token = secrets.token_urlsafe(32)
    _ACTIVE_USER_TOKENS[token] = {
        "username": username,
        "role": role,
        "expiry": time.time() + TOKEN_LIFETIME_SECONDS,
        "user_info": user_info or {},
    }
    return token


def verify_user_token(token: str) -> Optional[dict]:
    if not token:
        return None
    session = _ACTIVE_USER_TOKENS.get(token)
    if not session:
        return None
    if time.time() > session["expiry"]:
        _ACTIVE_USER_TOKENS.pop(token, None)
        return None
    return session


def verify_any_token(token: str) -> Optional[dict]:
    """Verify either an admin token or a user session token."""
    if not token:
        return None
    # 1. Check user/student session tokens
    user_session = verify_user_token(token)
    if user_session:
        return user_session
    # 2. Check admin tokens
    admin_user = verify_admin_token(token)
    if admin_user:
        return {"username": admin_user, "role": "admin", "user_info": {"name": admin_user}}
    return None


def verify_user_credentials(identifier: str, password: str) -> Optional[dict]:
    """Verify student/user credentials against SQLite database."""
    return db_verify_user_credentials(identifier, password)


def set_user_password(name: str, new_password: str) -> bool:
    """Update a user's password in SQLite, storing salt and SHA-256 hash."""
    return db_set_user_password(name, new_password)


PROFILE_FIELDS = (
    "email", "phone", "department", "position", "employee_id", "student_number", "notes",
    "temp_password", "password_hash", "salt", "account_id", "role", "credentials_sent", "credentials_sent_at",
)


def load_user_profiles():
    """Load user profiles from SQLite database."""
    return db_load_user_profiles()


def save_user_profile(name, fields):
    """Create or update user profile in SQLite database."""
    return db_save_user_profile(name, fields)


def ensure_user_profile_stub(name):
    """Create an empty personal-detail record for name if none exists yet."""
    clean_name = sanitize_name(name)
    if not clean_name:
        return
    profiles = db_load_user_profiles()
    if clean_name not in profiles:
        db_save_user_profile(clean_name, {"name": clean_name})


def delete_face_templates(name):
    """Delete all registered face embeddings and directory for ``name``.
    Returns True if templates were removed."""
    clean_name = sanitize_name(name)
    if not clean_name:
        return False
    person_dir = os.path.join(REGISTERED_FACES_DIR, clean_name)
    if os.path.isdir(person_dir):
        import shutil
        shutil.rmtree(person_dir)
        logger.info("Deleted face templates for '%s'", clean_name)
        return True
    return False


def delete_user_profile(name):
    """Remove the personal-detail record from SQLite and face embeddings for ``name``.
    Returns True if either a record or face templates were actually removed."""
    clean_name = sanitize_name(name)
    removed_profile = db_delete_user_profile(clean_name)
    removed_face = delete_face_templates(clean_name)
    return removed_profile or removed_face


def wipe_all_data():
    """Wipe all collected data: attendance, registered faces, users, snapshots, outbox."""
    import shutil
    wipe_db()
    # Reset attendance.csv if present
    if os.path.exists(ATTENDANCE_CSV):
        try:
            with open(ATTENDANCE_CSV, "w", encoding="utf-8") as f:
                f.write("Name,Timestamp,Type\n")
        except Exception:
            pass
    # Reset users.json if present
    if os.path.exists(USERS_JSON):
        try:
            with open(USERS_JSON, "w", encoding="utf-8") as f:
                f.write("{}")
        except Exception:
            pass
    # Clean registered_faces
    if os.path.exists(REGISTERED_FACES_DIR):
        shutil.rmtree(REGISTERED_FACES_DIR)
    os.makedirs(REGISTERED_FACES_DIR, exist_ok=True)
    # Clean spoof_logs
    if os.path.exists(SPOOF_LOGS_DIR):
        for fn in os.listdir(SPOOF_LOGS_DIR):
            try:
                os.remove(os.path.join(SPOOF_LOGS_DIR, fn))
            except Exception:
                pass
    # Clean unknown_logs
    if os.path.exists(UNKNOWN_LOGS_DIR):
        for fn in os.listdir(UNKNOWN_LOGS_DIR):
            try:
                os.remove(os.path.join(UNKNOWN_LOGS_DIR, fn))
            except Exception:
                pass
    # Clean outbox
    outbox_dir = os.path.join(BASE_DIR, "data", "outbox")
    if os.path.exists(outbox_dir):
        for fn in os.listdir(outbox_dir):
            try:
                os.remove(os.path.join(outbox_dir, fn))
            except Exception:
                pass
    _logged_tracks.clear()
    _logged_names.clear()
    logger.info("All collected attendance, face, and log data has been wiped clean.")


def verify_face(frame, registered_faces):
    """
    Compare the current webcam frame against all registered faces using
    the disk-scanning ``DeepFace.find()`` path. Not used by the live
    recognition loop (see :func:`verify_face_roi`); kept for standalone use.
    """
    if not registered_faces:
        return "No Registered Faces"

    name, distance = find_match(frame, REGISTERED_FACES_DIR)
    return name


def verify_face_roi(face_img, match_index):
    """
    Compare a cropped face region against a prebuilt in-memory match index.

    Parameters
    ----------
    face_img : numpy.ndarray
        BGR image containing only the face region.
    match_index : tuple[list[str], numpy.ndarray]
        Output of :func:`src.recognition.build_match_index` — precomputed
        once at load time (and after each new registration) rather than
        rebuilt on every recognition call.

    Returns
    -------
    tuple[str, float]
        (name, distance)
    """
    names, matrix = match_index
    if not names:
        return "No Registered Faces", -1.0

    try:
        # Re-detect+align with the same "yunet" backend used at registration
        # instead of "skip". ArcFace-style embeddings are sensitive to
        # alignment, so comparing an aligned registration template against
        # an unaligned (raw detector-crop) query systematically inflates the
        # distance — confirmed live: a just-registered person came back
        # "Unknown" under "skip" and matched correctly under "yunet". The
        # extra detection pass is cheap here since recognition already runs
        # in a low-rate background worker, not per frame.
        query_vector = get_embedding(face_img, detector_backend="yunet", enforce_detection=False)
    except Exception as e:
        logger.warning("Embedding extraction error: %s", e)
        return "Error", -1.0

    if query_vector is None:
        return "No Face Detected", -1.0

    return find_embedding_match_indexed(query_vector, names, matrix)


def crop_face_with_padding(frame, bbox, padding_percentage=0.25):
    """
    Crop a face from the frame using bbox (x, y, w, h) with some padding.
    Ensures boundaries do not go out of frame range.
    """
    h_frame, w_frame, _ = frame.shape
    x, y, w, h = bbox

    pad_w = int(w * padding_percentage)
    pad_h = int(h * padding_percentage)

    x1 = max(0, x - pad_w)
    y1 = max(0, y - pad_h)
    x2 = min(w_frame, x + w + pad_w)
    y2 = min(h_frame, y + h + pad_h)

    return frame[y1:y2, x1:x2]


def is_camera_allowed(pht_dt: datetime) -> Tuple[bool, Optional[str]]:
    """
    Evaluates whether the camera and face recognition login should be active
    based on schedule rules in Philippine Time (UTC+8):

    - Sundays (pht_dt.weekday() == 6):
        Camera disabled all day. "login is currently closed. Attendance is not active on Sundays."
    - Saturdays (pht_dt.weekday() == 5):
        Active from 2:00 AM up to 8:00 AM.
        Closed at and after 8:00 AM: "login is currently closed as 8:00 AM has passed."
        Closed before 2:00 AM: "login is currently closed as 6:30 AM has passed."
    - Monday through Friday (pht_dt.weekday() in [0, 1, 2, 3, 4]):
        Active from 02:00:00 AM to 06:30:00 AM.
        Closed after 06:30:00 AM and before 02:00:00 AM next day:
        "login is currently closed as 6:30 AM has passed."
    """
    weekday = pht_dt.weekday()  # 0=Mon, 4=Fri, 5=Sat, 6=Sun
    sec_of_day = pht_dt.hour * 3600 + pht_dt.minute * 60 + pht_dt.second
    START_SEC = 2 * 3600             # 02:00:00 AM = 7200 sec
    WEEKDAY_CUTOFF_SEC = 6 * 3600 + 30 * 60  # 06:30:00 AM = 23400 sec
    SATURDAY_CUTOFF_SEC = 8 * 3600   # 08:00:00 AM = 28800 sec

    # 1. Sunday rule: Camera disabled all day
    if weekday == 6:
        return False, "login is currently closed. Attendance is not active on Sundays."

    # 2. Saturday rule: Active between 2:00 AM and 8:00 AM
    if weekday == 5:
        if sec_of_day < START_SEC:
            return False, "login is currently closed as 6:30 AM has passed."
        elif sec_of_day > SATURDAY_CUTOFF_SEC:
            return False, "login is currently closed as 8:00 AM has passed."
        return True, None

    # 3. Monday through Friday: Active between 2:00 AM and 6:30 AM
    if sec_of_day < START_SEC or sec_of_day > WEEKDAY_CUTOFF_SEC:
        return False, "login is currently closed as 6:30 AM has passed."

    return True, None


def evaluate_checkin_time(pht_dt: datetime) -> Tuple[bool, str, str]:
    """
    Evaluates check-in time against daily attendance rules in Philippine Time.

    Rules:
    - Sundays (pht_dt.weekday() == 6): Attendance is not needed. No one can log on Sunday.
    - Saturdays (pht_dt.weekday() == 5): Active from 02:00 AM to 08:00 AM Clean ("ON_TIME").
      Beyond 08:00 AM: Rejected ("REJECTED").
    - Monday through Friday:
      - Before 02:00:00: Closed ("REJECTED")
      - 02:00:00 up to 05:14:59: Clean ("ON_TIME")
      - 05:15:00 up to 06:30:00 (inclusive): Late ("LATE")
      - Beyond 06:30:00: Rejected ("REJECTED") - check-in closed.

    Returns:
        (allowed: bool, status: str, message: str)
    """
    # 1. Sunday rule: Attendance is not active; logins are blocked
    if pht_dt.weekday() == 6:
        return False, "SUNDAY_CLOSED", "Attendance is not active on Sundays. Check-in closed."

    sec_of_day = pht_dt.hour * 3600 + pht_dt.minute * 60 + pht_dt.second
    START_SEC = 2 * 3600                  # 02:00:00 = 7200
    WEEKDAY_CUTOFF_SEC = 6 * 3600 + 30 * 60  # 06:30:00 = 23400
    LATE_START_SEC = 5 * 3600 + 15 * 60   # 05:15:00 = 18900
    SATURDAY_CUTOFF_SEC = 8 * 3600        # 08:00:00 = 28800

    # 2. Saturday rule: active between 2:00 AM and 8:00 AM (Clean/ON_TIME)
    if pht_dt.weekday() == 5:
        if sec_of_day < START_SEC:
            return False, "REJECTED", "Check-in closed. Attendance opens at 2:00 AM."
        elif sec_of_day > SATURDAY_CUTOFF_SEC:
            return False, "REJECTED", "Check-in closed. Attendance cutoff was 8:00 AM."
        return True, "ON_TIME", "Logged IN (Saturday Schedule)"

    # 3. Monday through Friday
    if sec_of_day < START_SEC:
        return False, "REJECTED", "Check-in closed. Attendance opens at 2:00 AM."
    elif sec_of_day > WEEKDAY_CUTOFF_SEC:
        return False, "REJECTED", "Check-in closed. Attendance cutoff was 6:30 AM."
    elif sec_of_day >= LATE_START_SEC:
        return True, "LATE", "Logged IN (Late)"
    else:
        return True, "ON_TIME", "Logged IN (On Time)"


def log_attendance(name, track_id=None, event_type="IN"):
    """
    Append an attendance record to SQLite and ``data/attendance.csv``.

    Returns:
        Tuple[bool, str, str]: (success, status_or_reason, message)
    """
    # Skip non-person labels
    skip_labels = {
        "Unknown", "No Registered Faces", "No Face Detected",
        "Error", "Scanning...", "Liveness Failed", "Spoof Detected",
    }
    if name in skip_labels:
        return False, "SKIPPED", "Non-person label"

    now = get_pht_now()
    status = "ON_TIME"
    status_msg = "Logged"

    if event_type == "IN":
        # Check settings for dev_mode (default False for single daily login)
        settings = load_settings()
        dev_mode = settings.get("dev_mode", DEV_MODE_DEFAULT)

        today_str = now.strftime("%Y-%m-%d")
        if not dev_mode and has_logged_in_today_db(name, today_str):
            logger.info("Skipping login for %s: already logged IN today (%s PHT).", name, today_str)
            return False, "ALREADY_LOGGED", f"{name} already logged in today."

        # Evaluate late cutoff rules
        allowed, status, status_msg = evaluate_checkin_time(now)
        if not allowed:
            logger.warning("Attendance rejected for %s: %s (%s PHT)", name, status_msg, now.strftime("%H:%M:%S"))
            return False, status, status_msg

        # ---------- Per-track deduplication ----------
        if track_id is not None and track_id in _logged_tracks:
            elapsed = (now - _logged_tracks[track_id]).total_seconds()
            if elapsed < DEDUP_TRACK_COOLDOWN_SECONDS:
                return False, "COOLDOWN", "Track cooldown active"

        # Prune expired entries
        for tid in [t for t, ts in _logged_tracks.items()
                    if (now - ts).total_seconds() >= DEDUP_TRACK_COOLDOWN_SECONDS]:
            del _logged_tracks[tid]
        for n in [n for n, ts in _logged_names.items()
                  if (now - ts).total_seconds() >= DEV_LOGIN_COOLDOWN_SECONDS]:
            del _logged_names[n]

    ts_str = now.strftime("%Y-%m-%d %H:%M:%S")

    # 1. Log to SQLite database
    log_attendance_db(name, event_type, ts_str, status=status)

    # 2. Also append to CSV as a backup / export file
    try:
        write_header = not os.path.isfile(ATTENDANCE_CSV) or os.path.getsize(ATTENDANCE_CSV) == 0
        with open(ATTENDANCE_CSV, "a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if write_header:
                writer.writerow(["Name", "Timestamp", "Type", "Status"])
            writer.writerow([name, ts_str, event_type, status])
    except Exception as e:
        logger.warning("Could not append to CSV backup: %s", e)

    if event_type == "IN":
        if track_id is not None:
            _logged_tracks[track_id] = now
        _logged_names[name] = now
    logger.info("Attendance logged to SQLite: %s %s (%s) at %s PHT", name, event_type, status, now.strftime("%H:%M:%S"))
    return True, status, status_msg


def _find_todays_event(name, date_str, event_type):
    """Find first event timestamp for `name` on `date_str` (YYYY-MM-DD) from SQLite."""
    return find_todays_event_db(name, date_str, event_type)


def has_logged_in_today(name: str) -> bool:
    """Return True if `name` has already logged an 'IN' event today in Philippine Time."""
    clean_name = sanitize_name(name)
    if not clean_name:
        return False

    settings = load_settings()
    if settings.get("dev_mode", DEV_MODE_DEFAULT):
        if clean_name in _logged_names:
            elapsed = (get_pht_now() - _logged_names[clean_name]).total_seconds()
            return elapsed < DEV_LOGIN_COOLDOWN_SECONDS
        return False

    today_pht = get_pht_now().strftime("%Y-%m-%d")
    return has_logged_in_today_db(clean_name, today_pht)


def manual_time_event(name, event_type):
    """Manually log time event to SQLite and CSV with late/cutoff enforcement."""
    clean_name = sanitize_name(name)
    if not clean_name:
        raise ValueError("Name cannot be empty (or contained only invalid characters).")
    if event_type not in ("IN", "OUT"):
        raise ValueError("event_type must be 'IN' or 'OUT'.")

    now = get_pht_now()
    today = now.strftime("%Y-%m-%d")

    existing = find_todays_event_db(clean_name, today, event_type)
    if existing:
        verb = "timed in" if event_type == "IN" else "timed out"
        existing_time = datetime.strptime(existing, "%Y-%m-%d %H:%M:%S").strftime("%I:%M %p").lstrip("0")
        raise ValueError(f"{clean_name} already {verb} today at {existing_time}.")

    if event_type == "OUT" and not find_todays_event_db(clean_name, today, "IN"):
        raise ValueError(f"{clean_name} hasn't timed in today yet — can't time out.")

    status = "ON_TIME"
    if event_type == "IN":
        allowed, status, msg = evaluate_checkin_time(now)
        if not allowed:
            raise ValueError(msg)

    ts_str = now.strftime("%Y-%m-%d %H:%M:%S")
    log_attendance_db(clean_name, event_type, ts_str, status=status)

    try:
        write_header = not os.path.isfile(ATTENDANCE_CSV) or os.path.getsize(ATTENDANCE_CSV) == 0
        with open(ATTENDANCE_CSV, "a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if write_header:
                writer.writerow(["Name", "Timestamp", "Type", "Status"])
            writer.writerow([clean_name, ts_str, event_type, status])
    except Exception:
        pass

    logger.info("Manual attendance logged to SQLite: %s %s (%s) at %s PHT", clean_name, event_type, status, now.strftime("%H:%M:%S"))
    return ts_str, status


def save_unknown_snapshot(frame):
    """
    Save a timestamped snapshot of an unknown face to ``data/unknown_logs/``.

    Parameters
    ----------
    frame : numpy.ndarray
        The webcam frame to save.

    Returns
    -------
    str or None
        The saved file path, or None on failure.
    """
    os.makedirs(UNKNOWN_LOGS_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"unknown_{timestamp}.jpg"
    filepath = os.path.join(UNKNOWN_LOGS_DIR, filename)

    try:
        cv2.imwrite(filepath, frame)
        logger.info("Unknown face saved: %s", filepath)
        return filepath
    except Exception as e:
        logger.error("Failed to save unknown face: %s", e)
        return None


def save_spoof_snapshot(frame):
    """
    Save a timestamped snapshot of a failed liveness or spoof attempt to ``data/spoof_logs/``.
    """
    os.makedirs(SPOOF_LOGS_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"spoof_{timestamp}.jpg"
    filepath = os.path.join(SPOOF_LOGS_DIR, filename)

    try:
        cv2.imwrite(filepath, frame)
        logger.info("Spoof snapshot saved: %s", filepath)
        return filepath
    except Exception as e:
        logger.error("Failed to save spoof snapshot: %s", e)
        return None
