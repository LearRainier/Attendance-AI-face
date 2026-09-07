"""
test_late_rules.py — Unit test for late logic, 6:30 AM cutoff, and Saturday exemption.
"""
import sys
import os
from datetime import datetime

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.utils import evaluate_checkin_time

def test_rules():
    # 2026-09-04 was a Friday (weekday == 4)
    # 1. Clean check-in before 5:15 AM
    dt_clean = datetime(2026, 9, 4, 5, 14, 59)
    allowed, status, msg = evaluate_checkin_time(dt_clean)
    assert allowed is True, f"Expected allowed True, got {allowed}"
    assert status == "ON_TIME", f"Expected ON_TIME, got {status}"

    # 2. Exactly 5:15 AM -> LATE
    dt_late_start = datetime(2026, 9, 4, 5, 15, 0)
    allowed, status, msg = evaluate_checkin_time(dt_late_start)
    assert allowed is True, f"Expected allowed True, got {allowed}"
    assert status == "LATE", f"Expected LATE, got {status}"

    # 3. 6:00 AM -> LATE
    dt_mid_late = datetime(2026, 9, 4, 6, 0, 0)
    allowed, status, msg = evaluate_checkin_time(dt_mid_late)
    assert allowed is True, f"Expected allowed True, got {allowed}"
    assert status == "LATE", f"Expected LATE, got {status}"

    # 4. Exactly 6:30:00 AM -> LATE (inclusive cutoff boundary)
    dt_cutoff_edge = datetime(2026, 9, 4, 6, 30, 0)
    allowed, status, msg = evaluate_checkin_time(dt_cutoff_edge)
    assert allowed is True, f"Expected allowed True, got {allowed}"
    assert status == "LATE", f"Expected LATE, got {status}"

    # 5. Past 6:30 AM -> REJECTED
    dt_rejected = datetime(2026, 9, 4, 6, 30, 1)
    allowed, status, msg = evaluate_checkin_time(dt_rejected)
    assert allowed is False, f"Expected allowed False, got {allowed}"
    assert status == "REJECTED", f"Expected REJECTED, got {status}"
    assert "Check-in closed. Attendance cutoff was 6:30 AM." in msg, f"Expected specific msg without PHT, got {msg}"

    # 6. Saturday (2026-09-05 is Saturday, weekday == 5)
    # Should NOT be late and should NOT be rejected
    dt_sat_early = datetime(2026, 9, 5, 4, 30, 0)
    allowed, status, msg = evaluate_checkin_time(dt_sat_early)
    assert allowed is True and status == "ON_TIME"

    dt_sat_late_hour = datetime(2026, 9, 5, 5, 30, 0)
    allowed, status, msg = evaluate_checkin_time(dt_sat_late_hour)
    assert allowed is True and status == "ON_TIME", f"Saturday 5:30 should be ON_TIME, got {status}"

    dt_sat_past_cutoff = datetime(2026, 9, 5, 8, 0, 0)
    allowed, status, msg = evaluate_checkin_time(dt_sat_past_cutoff)
    assert allowed is True and status == "ON_TIME", f"Saturday 8:00 AM should be ON_TIME, got {status}"

    print("All late rule test cases passed successfully!")

if __name__ == "__main__":
    test_rules()
