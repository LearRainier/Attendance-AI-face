"""
Unit tests for camera schedule and attendance cutoff rules in Philippine Time (UTC+8).
"""

import unittest
from datetime import datetime
from zoneinfo import ZoneInfo
import sys
import os

# Add backend directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import src.utils as utils_module
from src.utils import is_camera_allowed, evaluate_checkin_time

PHT = ZoneInfo("Asia/Manila")


class ScheduleOnTestCase(unittest.TestCase):
    """Base for cases that describe the rules while the schedule master
    switch is ON. Pins the switch for the duration so the suite still passes
    on a machine where an admin has turned the schedule off."""

    def setUp(self):
        self._saved_schedule = utils_module._schedule_enabled
        utils_module._schedule_enabled = True

    def tearDown(self):
        utils_module._schedule_enabled = self._saved_schedule


class TestCameraSchedule(ScheduleOnTestCase):

    def test_weekday_schedule(self):
        # Wednesday (weekday 2)
        # 1. 01:59:59 AM -> Closed (before 2:00 AM)
        dt_early = datetime(2026, 9, 9, 1, 59, 59, tzinfo=PHT)
        allowed, msg = is_camera_allowed(dt_early)
        self.assertFalse(allowed)
        self.assertIn("6:30 AM has passed", msg)

        chk_allowed, status, chk_msg = evaluate_checkin_time(dt_early)
        self.assertFalse(chk_allowed)
        self.assertEqual(status, "REJECTED")

        # 2. 02:00:00 AM -> Open (camera turns on)
        dt_start = datetime(2026, 9, 9, 2, 0, 0, tzinfo=PHT)
        allowed, msg = is_camera_allowed(dt_start)
        self.assertTrue(allowed)
        self.assertIsNone(msg)

        chk_allowed, status, chk_msg = evaluate_checkin_time(dt_start)
        self.assertTrue(chk_allowed)
        self.assertEqual(status, "ON_TIME")

        # 3. 05:14:59 AM -> Open, Clean
        dt_clean_edge = datetime(2026, 9, 9, 5, 14, 59, tzinfo=PHT)
        allowed, msg = is_camera_allowed(dt_clean_edge)
        self.assertTrue(allowed)
        chk_allowed, status, _ = evaluate_checkin_time(dt_clean_edge)
        self.assertTrue(chk_allowed)
        self.assertEqual(status, "ON_TIME")

        # 4. 05:15:00 AM -> Open, Late
        dt_late_start = datetime(2026, 9, 9, 5, 15, 0, tzinfo=PHT)
        allowed, msg = is_camera_allowed(dt_late_start)
        self.assertTrue(allowed)
        chk_allowed, status, _ = evaluate_checkin_time(dt_late_start)
        self.assertTrue(chk_allowed)
        self.assertEqual(status, "LATE")

        # 5. 06:30:00 AM -> Open, Late edge
        dt_late_edge = datetime(2026, 9, 9, 6, 30, 0, tzinfo=PHT)
        allowed, msg = is_camera_allowed(dt_late_edge)
        self.assertTrue(allowed)
        chk_allowed, status, _ = evaluate_checkin_time(dt_late_edge)
        self.assertTrue(chk_allowed)
        self.assertEqual(status, "LATE")

        # 6. 06:30:01 AM -> Closed! Camera disabled!
        dt_cutoff = datetime(2026, 9, 9, 6, 30, 1, tzinfo=PHT)
        allowed, msg = is_camera_allowed(dt_cutoff)
        self.assertFalse(allowed)
        self.assertIn("6:30 AM has passed", msg)
        chk_allowed, status, _ = evaluate_checkin_time(dt_cutoff)
        self.assertFalse(chk_allowed)
        self.assertEqual(status, "REJECTED")

        # 7. 12:00:00 PM (Noon) -> Closed!
        dt_noon = datetime(2026, 9, 9, 12, 0, 0, tzinfo=PHT)
        allowed, msg = is_camera_allowed(dt_noon)
        self.assertFalse(allowed)
        self.assertIn("6:30 AM has passed", msg)

    def test_saturday_schedule(self):
        # Saturday (weekday 5) - Sept 12, 2026
        # 1. 01:59:59 AM -> Closed (before 2:00 AM)
        dt_sat_early = datetime(2026, 9, 12, 1, 59, 59, tzinfo=PHT)
        allowed, msg = is_camera_allowed(dt_sat_early)
        self.assertFalse(allowed)

        chk_allowed, status, _ = evaluate_checkin_time(dt_sat_early)
        self.assertFalse(chk_allowed)
        self.assertEqual(status, "REJECTED")

        # 2. 02:00:00 AM -> Open (camera turns on)
        dt_sat_open = datetime(2026, 9, 12, 2, 0, 0, tzinfo=PHT)
        allowed, msg = is_camera_allowed(dt_sat_open)
        self.assertTrue(allowed)
        self.assertIsNone(msg)

        chk_allowed, status, _ = evaluate_checkin_time(dt_sat_open)
        self.assertTrue(chk_allowed)
        self.assertEqual(status, "ON_TIME")

        # 3. 07:00:00 AM (past weekday 6:30 AM cutoff) -> Open on Saturday!
        dt_sat_mid = datetime(2026, 9, 12, 7, 0, 0, tzinfo=PHT)
        allowed, msg = is_camera_allowed(dt_sat_mid)
        self.assertTrue(allowed)
        self.assertIsNone(msg)

        chk_allowed, status, _ = evaluate_checkin_time(dt_sat_mid)
        self.assertTrue(chk_allowed)
        self.assertEqual(status, "ON_TIME")

        # 4. 08:00:00 AM -> Saturday cutoff edge
        dt_sat_edge = datetime(2026, 9, 12, 8, 0, 0, tzinfo=PHT)
        allowed, msg = is_camera_allowed(dt_sat_edge)
        self.assertTrue(allowed)

        # 5. 08:00:01 AM -> Closed on Saturday! Camera disabled!
        dt_sat_closed = datetime(2026, 9, 12, 8, 0, 1, tzinfo=PHT)
        allowed, msg = is_camera_allowed(dt_sat_closed)
        self.assertFalse(allowed)
        self.assertIn("8:00 AM has passed", msg)

        chk_allowed, status, _ = evaluate_checkin_time(dt_sat_closed)
        self.assertFalse(chk_allowed)
        self.assertEqual(status, "REJECTED")

    def test_sunday_schedule(self):
        # Sunday (weekday 6) - Sept 13, 2026
        # Entire day is disabled
        for hour in [0, 2, 5, 6, 8, 12, 18, 23]:
            dt_sun = datetime(2026, 9, 13, hour, 30, 0, tzinfo=PHT)
            allowed, msg = is_camera_allowed(dt_sun)
            self.assertFalse(allowed, f"Sunday {hour}:30 should be closed")
            self.assertIn("Sundays", msg)

            chk_allowed, status, _ = evaluate_checkin_time(dt_sun)
            self.assertFalse(chk_allowed)
            self.assertEqual(status, "SUNDAY_CLOSED")

    def test_monday_reopening(self):
        # Monday (weekday 0) - Sept 14, 2026
        # 1. 01:59:59 AM -> Closed
        dt_mon_early = datetime(2026, 9, 14, 1, 59, 59, tzinfo=PHT)
        allowed, msg = is_camera_allowed(dt_mon_early)
        self.assertFalse(allowed)

        # 2. 02:00:00 AM -> Camera turns on!
        dt_mon_reopen = datetime(2026, 9, 14, 2, 0, 0, tzinfo=PHT)
        allowed, msg = is_camera_allowed(dt_mon_reopen)
        self.assertTrue(allowed)
        self.assertIsNone(msg)


class TestScheduleDisabled(unittest.TestCase):
    """With the master switch off, every time-of-day rule is bypassed: the
    camera never closes and no check-in is refused. Only the LATE label
    survives, from 05:15 AM onwards, so the DTR stays meaningful."""

    def test_camera_always_allowed(self):
        for dt in (
            datetime(2026, 9, 9, 9, 0, 0, tzinfo=PHT),    # Wednesday, past the 6:30 cutoff
            datetime(2026, 9, 9, 1, 0, 0, tzinfo=PHT),    # Wednesday, before the 2:00 opening
            datetime(2026, 9, 12, 15, 0, 0, tzinfo=PHT),  # Saturday, past the 8:00 cutoff
            datetime(2026, 9, 13, 10, 0, 0, tzinfo=PHT),  # Sunday
            datetime(2026, 9, 13, 23, 59, 59, tzinfo=PHT),
        ):
            allowed, msg = is_camera_allowed(dt, schedule_enabled=False)
            self.assertTrue(allowed, f"camera should stay open at {dt}")
            self.assertIsNone(msg)

    def test_checkin_never_rejected(self):
        for dt in (
            datetime(2026, 9, 9, 9, 0, 0, tzinfo=PHT),    # Wednesday morning, past cutoff
            datetime(2026, 9, 9, 22, 30, 0, tzinfo=PHT),  # Wednesday night
            datetime(2026, 9, 12, 15, 0, 0, tzinfo=PHT),  # Saturday afternoon
            datetime(2026, 9, 13, 10, 0, 0, tzinfo=PHT),  # Sunday
        ):
            allowed, status, _ = evaluate_checkin_time(dt, schedule_enabled=False)
            self.assertTrue(allowed, f"check-in should be accepted at {dt}")
            self.assertEqual(status, "LATE")

    def test_late_boundary_still_applies(self):
        # 05:14:59 -> on time, 05:15:00 -> late, on every day of the week.
        for day in range(7):
            date = datetime(2026, 9, 7 + day, 5, 14, 59, tzinfo=PHT)
            allowed, status, _ = evaluate_checkin_time(date, schedule_enabled=False)
            self.assertTrue(allowed)
            self.assertEqual(status, "ON_TIME", f"05:14:59 should be on time (weekday {date.weekday()})")

            date = date.replace(second=0, minute=15)
            allowed, status, _ = evaluate_checkin_time(date, schedule_enabled=False)
            self.assertTrue(allowed)
            self.assertEqual(status, "LATE", f"05:15:00 should be late (weekday {date.weekday()})")

    def test_before_opening_hour_counts_as_on_time(self):
        # 01:00 AM is outside the 2:00-6:30 window but earlier than the late
        # boundary, so it is accepted as on time rather than late.
        allowed, status, _ = evaluate_checkin_time(
            datetime(2026, 9, 9, 1, 0, 0, tzinfo=PHT), schedule_enabled=False
        )
        self.assertTrue(allowed)
        self.assertEqual(status, "ON_TIME")


if __name__ == "__main__":
    unittest.main()
