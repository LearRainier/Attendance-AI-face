import logging
import os
import sys

# Fix unicode output on Windows consoles (cp1252 can't encode every
# character DeepFace/OpenCV messages may contain). Lives here so every
# entry point (server.py) gets it.
if sys.platform == "win32":
    try:
        _reconf_out = getattr(sys.stdout, "reconfigure", None)
        if callable(_reconf_out):
            _reconf_out(encoding="utf-8", errors="replace")
        _reconf_err = getattr(sys.stderr, "reconfigure", None)
        if callable(_reconf_err):
            _reconf_err(encoding="utf-8", errors="replace")
    except Exception:
        pass  # Fallback: some environments don't support reconfigure

# One logging config for the whole app, so every module can just do
# `logger = logging.getLogger(__name__)` and get consistent formatting
# instead of scattering print() calls. Per-frame/per-track chatter (track
# locked/lost, scan queued/completed) logs at DEBUG so it's off by default
# instead of flooding the console on every camera tick — set LOG_LEVEL=DEBUG
# to see it. Skips reconfiguring if something upstream (e.g. uvicorn) has
# already added handlers, so running under `uvicorn server:app` doesn't
# duplicate every line.
if not logging.getLogger().handlers:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
