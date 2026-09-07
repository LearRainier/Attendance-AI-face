import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.utils import evaluate_checkin_time

days = [
    ("Friday (Weekday)", 2026, 9, 4),
    ("Saturday (Exempt)", 2026, 9, 5),
    ("Sunday (Regular)", 2026, 9, 6),
    ("Monday (Regular)", 2026, 9, 7),
]

times = [
    (5, 14, 59, "05:14:59 AM (Before 5:15)"),
    (5, 15, 0,  "05:15:00 AM (Late Start)"),
    (5, 45, 0,  "05:45:00 AM (Mid-Late)"),
    (6, 30, 0,  "06:30:00 AM (Cutoff Limit)"),
    (6, 30, 1,  "06:30:01 AM (Past Cutoff)"),
    (8, 0, 0,   "08:00:00 AM (Morning)"),
]

print("| Day | Simulated Time | Accepted? | Status | Message |")
print("|---|---|---|---|---|")
for day_label, y, m, d in days:
    for hour, minute, second, time_str in times:
        dt = datetime(y, m, d, hour, minute, second)
        allowed, status, msg = evaluate_checkin_time(dt)
        acc_str = "YES" if allowed else "NO (REJECTED)"
        print(f"| {day_label} | {time_str} | {acc_str} | {status} | {msg} |")
