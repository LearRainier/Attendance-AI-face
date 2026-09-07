import sqlite3
import os

db_path = r"d:\DANDAN CODING\MG Attendance\Attendance-AI-face\backend\data\attendance.db"
conn = sqlite3.connect(db_path)
conn.execute("DELETE FROM attendance WHERE name LIKE 'TestPerson%'")
conn.commit()
conn.close()

csv_path = r"d:\DANDAN CODING\MG Attendance\Attendance-AI-face\backend\data\attendance.csv"
if os.path.exists(csv_path):
    with open(csv_path, "r", encoding="utf-8") as f:
        lines = [line for line in f if not line.startswith("TestPerson")]
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        f.writelines(lines)

print("Cleaned test entries successfully.")
