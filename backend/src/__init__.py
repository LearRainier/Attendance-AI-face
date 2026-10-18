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

from logging.handlers import RotatingFileHandler

# Path to persistent audit log
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(_BACKEND_DIR, "data")
try:
    os.makedirs(DATA_DIR, exist_ok=True)
except Exception:
    pass

AUDIT_LOG_PATH = os.path.join(DATA_DIR, "audit.log")

# Unified audit formatter
_log_format = "%(asctime)s [%(levelname)-7s] [%(name)s] [%(threadName)s] %(message)s"
_date_format = "%Y-%m-%d %H:%M:%S"
_log_level_name = os.environ.get("LOG_LEVEL", "INFO").upper()
_log_level = getattr(logging, _log_level_name, logging.INFO)

root_logger = logging.getLogger()
root_logger.setLevel(_log_level)

# 1. Ensure console stream handler
_has_stream = any(isinstance(h, logging.StreamHandler) and not isinstance(h, RotatingFileHandler) for h in root_logger.handlers)
if not _has_stream:
    _console_handler = logging.StreamHandler(sys.stdout)
    _console_handler.setFormatter(logging.Formatter(_log_format, datefmt=_date_format))
    _console_handler.setLevel(_log_level)
    root_logger.addHandler(_console_handler)

# 2. Ensure persistent audit file handler (5MB rotation, 5 backups, UTF-8)
_has_file = any(isinstance(h, RotatingFileHandler) and getattr(h, "baseFilename", "") == os.path.abspath(AUDIT_LOG_PATH) for h in root_logger.handlers)
if not _has_file:
    try:
        _file_handler = RotatingFileHandler(
            AUDIT_LOG_PATH,
            maxBytes=5 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
            delay=False,
        )
        _file_handler.setFormatter(logging.Formatter(_log_format, datefmt=_date_format))
        _file_handler.setLevel(_log_level)
        root_logger.addHandler(_file_handler)
    except Exception as _e:
        sys.stderr.write(f"Failed to initialize audit file handler: {_e}\n")


# uvicorn's own "uvicorn.error" logger does not propagate to root, so its
# startup failures and request/websocket tracebacks would never reach
# audit.log. Attach the file handler there too (the per-request access
# logger is left out on purpose; audit_log_middleware covers /api calls).
for _h in root_logger.handlers:
    if isinstance(_h, RotatingFileHandler):
        _uv = logging.getLogger("uvicorn")
        if _h not in _uv.handlers:
            _uv.addHandler(_h)

# ---------------------------------------------------------------------------
# Crash capture.
#
# The kiosk console window closes the instant python.exe exits, taking any
# traceback with it. These hooks make sure the reason lands in audit.log:
#   - uncaught exceptions in the main thread and in background threads
#     (camera loop, recognition worker) are logged at CRITICAL;
#   - native crashes inside OpenCV / MSMF / TensorFlow (access violations,
#     which no Python handler can catch) dump a stack to crash_native.log.
# ---------------------------------------------------------------------------
import faulthandler
import threading

try:
    # Kept open for the whole process lifetime on purpose: faulthandler
    # writes to the raw file descriptor at crash time.
    _native_crash_file = open(os.path.join(DATA_DIR, "crash_native.log"), "a", encoding="utf-8")
    faulthandler.enable(file=_native_crash_file, all_threads=True)
except Exception as _e:
    sys.stderr.write(f"Failed to enable native crash log: {_e}\n")

_crash_logger = logging.getLogger("crash")


def _log_uncaught(exc_type, exc_value, exc_tb):
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_tb)
        return
    _crash_logger.critical("Uncaught exception - process is exiting",
                           exc_info=(exc_type, exc_value, exc_tb))


def _log_uncaught_thread(args):
    if args.exc_type is SystemExit:
        return
    name = args.thread.name if args.thread is not None else "unknown"
    _crash_logger.critical("Uncaught exception in thread %r - that thread has STOPPED",
                           name, exc_info=(args.exc_type, args.exc_value, args.exc_traceback))


sys.excepthook = _log_uncaught
threading.excepthook = _log_uncaught_thread
