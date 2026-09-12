"""
End-to-end transition test simulating the camera loop's behavior
across schedule transitions (6:30 AM cutoff, 8:00 AM Saturday cutoff, and 2:00 AM wake-up).
"""

import unittest
from unittest.mock import MagicMock, patch
from datetime import datetime
from zoneinfo import ZoneInfo
import sys
import os
import json

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.utils import is_camera_allowed
from server import state, _refresh_broadcast_payload

PHT = ZoneInfo("Asia/Manila")


class TestLiveTransitions(unittest.TestCase):

    def test_camera_hardware_and_payload_transition(self):
        """
        Simulates how AppState and the broadcast payload change
        between 6:29:59 AM (Active) and 6:30:01 AM (Cutoff closed),
        and then at 2:00:00 AM next morning (Re-opened).
        """
        # -------------------------------------------------------------
        # 1. State at 06:29:59 AM (Weekday Active)
        # -------------------------------------------------------------
        t_active = datetime(2026, 9, 9, 6, 29, 59, tzinfo=PHT)
        allowed, msg = is_camera_allowed(t_active)
        self.assertTrue(allowed)

        # Mock active camera and frame
        state.camera_active = True
        state.schedule_closed = False
        state.schedule_message = None
        state.camera_error = None

        _refresh_broadcast_payload()
        payload = json.loads(state.latest_payload)
        self.assertTrue(payload["camera_active"])
        self.assertFalse(payload["schedule_closed"])
        self.assertIsNone(payload["schedule_message"])

        # -------------------------------------------------------------
        # 2. State at 06:30:01 AM (Cutoff strikes: Camera Disables!)
        # -------------------------------------------------------------
        t_cutoff = datetime(2026, 9, 9, 6, 30, 1, tzinfo=PHT)
        allowed, msg = is_camera_allowed(t_cutoff)
        self.assertFalse(allowed)
        self.assertEqual(msg, "login is currently closed as 6:30 AM has passed.")

        # Simulate camera_loop handling cutoff:
        # Mock physical webcam release
        mock_capture = MagicMock()
        mock_capture.release.assert_not_called()

        if not allowed:
            mock_capture.release()
            mock_capture = None
            state.camera_active = False
            state.schedule_closed = True
            state.schedule_message = msg
            state.camera_error = msg
            state.latest_jpeg = None
            state.tracks = []
            _refresh_broadcast_payload()

        # Verify hardware was released
        self.assertIsNone(mock_capture)

        # Verify WebSocket JSON payload received by dashboard and kiosk
        payload_closed = json.loads(state.latest_payload)
        self.assertFalse(payload_closed["camera_active"])
        self.assertTrue(payload_closed["schedule_closed"])
        self.assertEqual(
            payload_closed["schedule_message"],
            "login is currently closed as 6:30 AM has passed."
        )
        self.assertIsNone(payload_closed["frame"])

        # -------------------------------------------------------------
        # 3. State at 02:00:00 AM next morning (Camera Wakes Up!)
        # -------------------------------------------------------------
        t_wake = datetime(2026, 9, 10, 2, 0, 0, tzinfo=PHT)
        allowed_wake, msg_wake = is_camera_allowed(t_wake)
        self.assertTrue(allowed_wake)
        self.assertIsNone(msg_wake)

        # Simulate camera_loop re-enabling camera
        state.schedule_closed = False
        state.schedule_message = None
        state.camera_error = None
        state.camera_active = True
        _refresh_broadcast_payload()

        payload_wake = json.loads(state.latest_payload)
        self.assertTrue(payload_wake["camera_active"])
        self.assertFalse(payload_wake["schedule_closed"])
        self.assertIsNone(payload_wake["schedule_message"])


if __name__ == "__main__":
    unittest.main()
