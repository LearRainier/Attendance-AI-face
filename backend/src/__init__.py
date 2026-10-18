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

# ---------------------------------------------------------------------------
# Persistent crash diagnostics.
#
# The kiosk launcher runs the backend in a minimized console window that
# closes the instant python.exe exits, taking every log line and traceback
# with it. Everything below makes sure the *next* failure leaves a record on
# disk in backend/logs/:
#   - server.log       every log line (rotated, ~5 MB x 5 files)
#   - crash_native.log stack dump if OpenCV / MSMF / TensorFlow crashes the
#                      interpreter itself (access violation etc.), which no
#                      Python handler can ever see
# Uncaught exceptions in the main thread *and* in background threads (the
# camera loop and the recognition worker) are logged at CRITICAL with the
# full traceback instead of only being printed to the vanishing console.
# ---------------------------------------------------------------------------
import faulthandler
import threading
import logging.handlers

LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs")
try:
    os.makedirs(LOG_DIR, exist_ok=True)

    _root_logger = logging.getLogger()
    if not any(getattr(h, "_mg_file_handler", False) for h in _root_logger.handlers):
        _file_handler = logging.handlers.RotatingFileHandler(
            os.path.join(LOG_DIR, "server.log"),
            maxBytes=5 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
        )
        _file_handler._mg_file_handler = True
        _file_handler.setFormatter(logging.Formatter(
            "%(asctime)s %(levelname)-8s %(threadName)s %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        ))
        _root_logger.addHandler(_file_handler)
        # uvicorn's error logger doesn't propagate to root, so attach the
        # file handler there too (startup failures, websocket/request
        # tracebacks). The per-request access logger is left out on purpose.
        logging.getLogger("uvicorn").addHandler(_file_handler)
        if _root_logger.level == logging.NOTSET or _root_logger.level > logging.INFO:
            _root_logger.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())

    # Kept open for the whole process lifetime on purpose: faulthandler
    # writes to the raw file descriptor at crash time.
    _native_crash_file = open(os.path.join(LOG_DIR, "crash_native.log"), "a", encoding="utf-8")
    faulthandler.enable(file=_native_crash_file, all_threads=True)
except Exception as _e:  # never let diagnostics stop the server starting
    logging.getLogger(__name__).warning("Could not set up file logging: %s", _e)

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
