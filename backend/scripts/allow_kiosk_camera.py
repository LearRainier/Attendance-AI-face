"""
allow_kiosk_camera.py - pre-approve the camera for the kiosk site.

start_kiosk.bat runs this right before it opens the kiosk browser. It adds
"Allow camera" for the kiosk's own address (localhost / 127.0.0.1 on the
kiosk port) to the kiosk browser profile, so Edge/Chrome never shows the
camera permission prompt - not on the first start, and not after a restart.

Only the kiosk's dedicated profile (--user-data-dir in start_kiosk.bat) is
touched, and only for the local kiosk address. The user's normal browser
profile and every other website are unaffected.

Usage:
    python scripts/allow_kiosk_camera.py <profile_dir> <port>
"""

import json
import os
import sys

CAMERA_KEY = "media_stream_camera"
ALLOW = 1  # Chromium content-setting value for "Allow"


def allow_camera(profile_dir: str, port: str) -> bool:
    prefs_path = os.path.join(profile_dir, "Default", "Preferences")
    prefs = {}
    if os.path.isfile(prefs_path):
        try:
            with open(prefs_path, "r", encoding="utf-8") as f:
                prefs = json.load(f)
            if not isinstance(prefs, dict):
                prefs = {}
        except (OSError, ValueError):
            # Corrupt or locked file: start from a clean slate rather than
            # failing; the browser fills in everything else on launch.
            prefs = {}

    exceptions = (
        prefs.setdefault("profile", {})
        .setdefault("content_settings", {})
        .setdefault("exceptions", {})
    )
    camera = exceptions.setdefault(CAMERA_KEY, {})

    changed = False
    for host in ("localhost", "127.0.0.1"):
        pattern = f"http://{host}:{port},*"
        entry = camera.get(pattern)
        if not isinstance(entry, dict) or entry.get("setting") != ALLOW:
            camera[pattern] = {"setting": ALLOW}
            changed = True

    if changed:
        os.makedirs(os.path.dirname(prefs_path), exist_ok=True)
        tmp_path = prefs_path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(prefs, f)
        os.replace(tmp_path, prefs_path)
    return changed


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    profile_dir, port = sys.argv[1], sys.argv[2]
    try:
        changed = allow_camera(profile_dir, port)
    except Exception as e:  # never block the kiosk from starting
        print(f"[WARN] Could not pre-approve the camera: {e}")
        return 1
    print("[OK] Camera pre-approved for the kiosk." if changed
          else "[OK] Camera already approved for the kiosk.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
