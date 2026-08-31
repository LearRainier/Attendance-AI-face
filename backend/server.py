"""
server.py — FastAPI backend for the web-based Face ID dashboard.

Owns the webcam and all CV work (YuNet face detection, IoU tracking,
DeepFace recognition) in background threads — the same split main.py used
between its main loop and FaceRecognitionWorker — and exposes the result to
the React frontend over a WebSocket, plus REST endpoints for registration.
The browser never touches the physical camera for the live feed; it only
renders what this process streams.
"""

import asyncio
import base64
import csv
import json
import logging
import queue
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# UTF-8 console + logging setup lives in src/__init__.py (runs on import)
from src.tracker import FaceTracker
from src.detection import FaceDetector, MAX_FACE_WIDTH_RATIO, MIN_FACE_WIDTH_RATIO
from src.recognition import build_match_index, get_embedding, MODEL_NAME
from src.utils import (
    load_registered_faces,
    verify_face_roi,
    crop_face_with_padding,
    log_attendance,
    manual_time_event,
    save_unknown_snapshot,
    register_face_embedding,
    load_user_profiles,
    save_user_profile,
    delete_user_profile,
    ensure_user_profile_stub,
    load_settings,
    save_settings,
    ATTENDANCE_CSV,
)

import os

logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIST = os.path.join(BASE_DIR, "frontend", "dist")

DEFAULT_CAMERA_INDEX = 0  # only the fallback: the camera actually in use is
                          # picked in the dashboard, kept in AppState.camera_index
                          # and persisted to data/settings.json. If the saved (or
                          # this default) index isn't among the cameras found at
                          # startup, the first working one is used instead.
CAMERA_PROBE_MAX_INDEX = 5      # highest device index _probe_cameras() tries
CAMERA_THUMBNAIL_WIDTH = 160    # preview shown next to each camera in the picker
CAMERA_WARMUP_ATTEMPTS = 20     # reads allowed before a camera counts as dead
CAMERA_WARMUP_INTERVAL = 0.1    # ...spaced this far apart (so ...~2s total)

# Requested capture resolution. Neither detection nor tracking benefits —
# FaceDetector downscales to DETECTOR_MAX_WIDTH regardless — but the face
# chip that actually gets embedded (crop_face_with_padding on the *native*
# frame, both at registration and live recognition) does: more source
# pixels per face is the single biggest lever on recognition accuracy,
# especially for someone standing near the far edge of the scanning range
# where a face is only a couple hundred pixels wide to begin with. Requested
# via CAP_PROP_FRAME_WIDTH/HEIGHT before the warm-up read; if the device
# doesn't support it the driver clamps to its nearest mode and the actually
# negotiated size is read back from the returned frame's own shape, so this
# never fails loudly — it just quietly gets whatever the hardware allows.
CAPTURE_REQUEST_WIDTH = 1920
CAPTURE_REQUEST_HEIGHT = 1080

# Capture backends to try, in order, for any device index. DirectShow first on
# Windows: OpenCV defaults to MSMF there, and on hardware like this project's
# HP TrueVision webcam MSMF *opens* the device happily and then fails every
# single read (`can't grab frame. Error: -1072875772`), which looks exactly
# like "the camera is broken" — DirectShow opens the same camera in ~0.5s and
# streams fine. MSMF is kept as a fallback because the reverse happens too on
# some UVC devices. This is why the checks below insist on an actual decoded
# frame rather than trusting isOpened().
CAMERA_BACKENDS = (
    ((cv2.CAP_DSHOW, "dshow"), (cv2.CAP_MSMF, "msmf"))
    if os.name == "nt" else ((cv2.CAP_ANY, "default"),)
)

# Where camera_loop gets its frames. "local" is a webcam plugged into this
# machine; "browser" is a device that can't be opened with VideoCapture at
# all — a phone on the same network — pushing JPEGs up /ws/ingest instead.
# Both feed the identical detect -> track -> recognize -> log pipeline.
SOURCE_LOCAL = "local"
SOURCE_BROWSER = "browser"
INGEST_FRAME_TIMEOUT = 3.0   # no pushed frame for this long = stream stalled
INGEST_MAX_FRAME_BYTES = 4_000_000  # reject absurd uploads before decoding
FRAME_JPEG_QUALITY = 80
STATE_BROADCAST_INTERVAL = 1 / 30  # ~30fps to connected WebSocket clients
FIRST_SCAN_DELAY_SECONDS = 1.5     # hold a track before its first recognition attempt
RETRY_COOLDOWN_SECONDS = 5.0       # retry Unknown/Error/No-Face tracks this often
UNKNOWN_SNAPSHOT_COOLDOWN_SECONDS = 20.0
TOAST_DURATION_SECONDS = 3.0
RECENT_CHECKINS_MAX = 8              # how many rows the dashboard's "Recent Check-ins" panel keeps

# The single gate deciding what counts as a scannable face — YuNet plus the
# face-shape and in-range checks in src/detection.py (see that module for the
# MIN/MAX_FACE_WIDTH_RATIO distance tuning). Shared by camera_loop() and the
# Register page's preview endpoint so both agree on what's in frame; it
# serializes its own detect() calls internally, since the underlying
# cv2.FaceDetectorYN holds mutable input-size state.
FACE_DETECTOR = FaceDetector()


# ---------------------------------------------------------------------------
# Shared, lock-protected application state
# ---------------------------------------------------------------------------

class AppState:
    def __init__(self):
        self.lock = threading.Lock()
        self.latest_jpeg = None
        # Size of the frame `tracks`/`hints` were computed on — see the note
        # in _refresh_broadcast_payload.
        self.frame_width = 0
        self.frame_height = 0
        self.tracks = []
        # Real faces that were detected but rejected by the range gate, so
        # the dashboard can show a "step closer" hint instead of just
        # ignoring someone silently. Never tracked, scanned, or logged.
        self.hints = []
        self.toast = None
        self.fps = 0.0
        self.registered_count = 0
        self.recent_checkins = []
        self.registered_faces = {}
        self.match_index = ([], np.zeros((0, 0)))
        self.camera_active = False
        # Which device index the dashboard asked for, which one camera_loop
        # actually has open right now (None while released/switching), the
        # cameras found by the last scan, and the last open/read failure so
        # the UI can say *why* the feed is black instead of just showing
        # "waiting for camera" forever.
        self.camera_index = DEFAULT_CAMERA_INDEX
        self.camera_open_index = None
        # "camera_loop owns the device, or is in the middle of acquiring it."
        # What /api/camera/pause and a camera scan wait to go False, rather
        # than waiting on camera_active: opening a camera can take seconds
        # (see _open_capture), and for all of that time camera_active is
        # still False even though the loop is about to take the device — so
        # pause would answer "released, go ahead" and then steal the webcam
        # back from the browser's getUserMedia a moment later.
        self.camera_held = False
        # SOURCE_LOCAL or SOURCE_BROWSER — see the constants above. Flipped by
        # a device connecting to /ws/ingest, and back when it disconnects.
        self.camera_source = SOURCE_LOCAL
        self.source_label = None  # e.g. "iPhone · front camera", for the UI
        self.cameras = []
        self.camera_error = None
        # Pre-serialized JSON for /ws/live, rebuilt once per camera-loop
        # tick (see _refresh_broadcast_payload) rather than once per
        # connected client — see that function's docstring for why.
        self.latest_payload = json.dumps({
            "frame": None,
            "tracks": [],
            "hints": [],
            "toast": None,
            "fps": 0.0,
            "registered_count": 0,
            "recent_checkins": [],
            "frame_width": 0,
            "frame_height": 0,
            "camera_index": DEFAULT_CAMERA_INDEX,
            "camera_active": False,
            "camera_error": None,
            "camera_source": SOURCE_LOCAL,
            "source_label": None,
        })
        # Same snapshot minus the (by far largest) "frame" field, for clients
        # that supply the video themselves — a phone streaming its own camera
        # shouldn't pay to download its own frames back. Built alongside the
        # full payload so the cost stays per-tick, not per-client.
        self.latest_payload_lite = self.latest_payload


class FrameIngest:
    """Hand-off point for frames pushed in from a browser (a phone's camera).

    Keeps only the newest frame on purpose: this is a live view, so if the
    camera thread is busy when two frames arrive, the right thing is to show
    the most recent one and drop the stale one rather than build a backlog
    that makes the feed drift further behind real time.

    Exactly one streaming device is allowed at a time — ``claim()`` is how a
    second phone is refused instead of the two of them interleaving frames
    from different rooms into one tracker.
    """

    def __init__(self):
        self._condition = threading.Condition()
        self._frame = None
        self._seq = 0            # bumped per submitted frame
        self._consumed_seq = 0   # last seq camera_loop actually took
        self._websocket = None   # the active streaming client, if any
        self._label = None

    # -- streaming client bookkeeping (event loop side) --------------------

    def claim(self, websocket, label=None):
        """Register ``websocket`` as *the* frame source. False if taken."""
        with self._condition:
            if self._websocket is not None:
                return False
            self._websocket = websocket
            self._label = label
            self._frame = None
            return True

    def release(self, websocket):
        """Give up the claim, if ``websocket`` still holds it."""
        with self._condition:
            if self._websocket is not websocket:
                return False
            self._websocket = None
            self._label = None
            self._frame = None
            self._condition.notify_all()
            return True

    @property
    def active_websocket(self):
        with self._condition:
            return self._websocket

    @property
    def label(self):
        with self._condition:
            return self._label

    def submit(self, frame):
        with self._condition:
            self._frame = frame
            self._seq += 1
            self._condition.notify_all()

    # -- consumer side (camera thread) ------------------------------------

    def wait_for_frame(self, timeout):
        """Block up to ``timeout`` for a frame newer than the last one taken.
        Returns None on timeout, so the caller stays responsive to shutdown
        and source changes instead of blocking forever on a dead stream."""
        with self._condition:
            if self._seq == self._consumed_seq:
                if self._websocket is None:
                    # Nothing is streaming, so no frame can arrive — returning
                    # at once instead of parking for the full timeout is what
                    # lets the camera loop notice the source has gone back to
                    # the local webcam promptly. Waiting here cost a visible
                    # ~3s of black feed after every phone disconnect.
                    return None
                self._condition.wait(timeout)
            if self._seq == self._consumed_seq:
                return None
            self._consumed_seq = self._seq
            return self._frame


_frame_ingest = FrameIngest()

state = AppState()
tracker = FaceTracker()
tracks_lock = threading.Lock()
_shutdown_event = threading.Event()
# Two independent reasons camera_loop has to let go of the device: the
# Register page needs it for the browser's getUserMedia, and a camera scan
# needs to open each index in turn. They're separate events so clearing one
# can't resume the loop while the other still needs the camera free.
_camera_paused = threading.Event()
_camera_scan_hold = threading.Event()
_camera_scan_lock = threading.Lock()
_worker = None
_camera_thread = None
_embedding_dim = None


# ---------------------------------------------------------------------------
# Background recognition worker (same design as the old main.py)
# ---------------------------------------------------------------------------

class FaceRecognitionWorker(threading.Thread):
    """Background worker thread that performs face recognition asynchronously
    to prevent the camera loop / GUI from lagging."""

    def __init__(self, tracks_dict, lock, app_state):
        super().__init__(daemon=True)
        self.tracks = tracks_dict  # Direct reference to tracker.tracks
        self.lock = lock           # Lock for tracks synchronization
        self.state = app_state
        self.task_queue = queue.Queue()
        self.running = True
        self.last_unknown_snapshot = 0.0
        self.unknown_snapshot_cooldown = UNKNOWN_SNAPSHOT_COOLDOWN_SECONDS

    def queue_recognition(self, track_id, face_chip):
        self.task_queue.put((track_id, face_chip))

    def run(self):
        while self.running:
            try:
                track_id, face_chip = self.task_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            with self.lock:
                track = self.tracks.get(track_id)
                if track is None:
                    self.task_queue.task_done()
                    continue
                track.status = "processing"

            with self.state.lock:
                match_index = self.state.match_index

            try:
                name, distance = verify_face_roi(face_chip, match_index)
            except Exception as e:
                logger.warning("Worker recognition error: %s", e)
                name, distance = "Error", -1.0

            with self.lock:
                track = self.tracks.get(track_id)
                if track is not None:
                    track.update_status(name, distance)
                    track.last_recognition_time = time.time()
                    track.recognition_attempts += 1
                    logger.debug("Scan completed for track %d: %s (dist: %.4f)", track_id, name, distance)

                    if name not in ("Scanning...", "No Face Detected", "Error", "Unknown"):
                        logged = log_attendance(name, track_id=track_id, event_type="IN")
                        if logged:
                            track.toast_triggered = False
                            track.attendance_logged_in = True

                    if name == "Unknown":
                        now = time.time()
                        if now - self.last_unknown_snapshot > self.unknown_snapshot_cooldown:
                            save_unknown_snapshot(face_chip)
                            self.last_unknown_snapshot = now

            self.task_queue.task_done()

    def stop(self):
        self.running = False


# ---------------------------------------------------------------------------
# Camera / tracking loop — runs in its own thread so it never blocks the
# FastAPI event loop that serves the WebSocket and REST endpoints.
# ---------------------------------------------------------------------------

def _refresh_broadcast_payload():
    """Rebuild ``state.latest_payload`` — the exact JSON string every
    connected ``/ws/live`` client is sent this tick.

    Caller must already hold ``state.lock``. This used to be inline in
    ``ws_live()``, run independently by *every* connected websocket on
    every tick: with N dashboards open, the base64 JPEG encode and JSON
    serialization ran N times per frame, all of it inside ``state.lock`` —
    so more simultaneous viewers directly meant more time the camera
    thread spent waiting for the lock, and lower FPS for everyone. Doing
    it once here (called from camera_loop, which already holds the lock to
    publish the frame) makes broadcast cost independent of viewer count.
    """
    jpeg = state.latest_jpeg
    payload = {
        "tracks": state.tracks,
        "hints": state.hints,
        # Pixel size of the frame those boxes were computed on. The overlay
        # needs it to turn them into percentages: a phone previews its camera
        # at full resolution while uploading a downscaled copy for detection,
        # so normalising by the *displayed* size would put every box at the
        # wrong scale. For the local webcam it equals the streamed frame's own
        # dimensions, which is why this only became wrong once frames could
        # come from somewhere else.
        "frame_width": state.frame_width,
        "frame_height": state.frame_height,
        "toast": state.toast,
        "fps": round(state.fps, 1),
        "registered_count": state.registered_count,
        "recent_checkins": state.recent_checkins,
        "camera_index": state.camera_index,
        "camera_active": state.camera_active,
        "camera_error": state.camera_error,
        "camera_source": state.camera_source,
        "source_label": state.source_label,
    }
    # The frameless variant first, then the same dict plus the frame — the
    # base64 encode still happens at most once per tick either way.
    state.latest_payload_lite = json.dumps({**payload, "frame": None})
    payload["frame"] = (
        "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")
        if jpeg is not None else None
    )
    state.latest_payload = json.dumps(payload)


def _encode_thumbnail(frame):
    """Small base64 JPEG preview of a frame, used to label cameras in the
    picker. OpenCV can't tell us a device's friendly name (only its index),
    so a still from each one is what actually lets someone tell "Camera 0"
    from "Camera 1"."""
    h, w = frame.shape[:2]
    if w > CAMERA_THUMBNAIL_WIDTH:
        scale = CAMERA_THUMBNAIL_WIDTH / float(w)
        frame = cv2.resize(frame, (CAMERA_THUMBNAIL_WIDTH, max(1, int(h * scale))))
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
    if not ok:
        return None
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


def _open_capture(index):
    """Open device ``index`` on the first backend that both opens it *and*
    hands back a real frame, giving the camera a moment to wake up.

    Returns ``(capture, backend_name, first_frame)``, or ``(None, None,
    None)`` if no backend could get a frame out of it. Callers get an
    already-warmed capture, so the first ``read()`` in the camera loop isn't
    the one that has to survive the driver's startup lag.

    Insisting on a decoded frame is the whole point: ``isOpened()`` returns
    True for cameras that never deliver anything (see CAMERA_BACKENDS), and
    treating those as working is what makes the live feed sit black forever
    with nothing in the log but grab-frame warnings.
    """
    for api, backend_name in CAMERA_BACKENDS:
        capture = cv2.VideoCapture(index, api)
        if not capture.isOpened():
            capture.release()
            continue

        # Best-effort — a device that doesn't support this mode just ignores
        # it and keeps its own default, which the post-warm-up frame shape
        # below reports honestly rather than trusting these back.
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, CAPTURE_REQUEST_WIDTH)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, CAPTURE_REQUEST_HEIGHT)

        for _ in range(CAMERA_WARMUP_ATTEMPTS):
            ok, frame = capture.read()
            if ok and frame is not None:
                return capture, backend_name, frame
            time.sleep(CAMERA_WARMUP_INTERVAL)

        logger.debug("Camera %d opened on %s but delivered no frames.", index, backend_name)
        capture.release()

    return None, None, None


def _probe_cameras():
    """Find the usable webcams by trying indices 0..CAMERA_PROBE_MAX_INDEX
    and keeping the ones that actually deliver a frame.

    Blocking (each attempt costs the driver a moment), and it needs the
    device free, so callers must make sure camera_loop has released it
    first: at startup it runs before the camera thread starts, and
    /api/cameras/scan holds _camera_scan_hold across the probe.
    """
    found = []
    for index in range(CAMERA_PROBE_MAX_INDEX + 1):
        capture, backend_name, frame = _open_capture(index)
        if capture is None:
            continue
        try:
            h, w = frame.shape[:2]
            found.append({
                "index": index,
                "width": int(w),
                "height": int(h),
                "backend": backend_name,
                "thumbnail": _encode_thumbnail(frame),
            })
        except Exception as e:
            logger.debug("Probe of camera %d failed: %s", index, e)
        finally:
            capture.release()
    return found


def _cameras_response():
    with state.lock:
        return {
            "cameras": list(state.cameras),
            "selected": state.camera_index,
            "active": state.camera_active,
            "error": state.camera_error,
            "source": state.camera_source,
            "source_label": state.source_label,
        }


def _reload_registered_faces():
    """(Re)load embeddings from disk and rebuild the fast match index.
    Called at startup and after every successful /api/register call.

    Also backfills a users.json stub for anyone found in registered_faces/
    without one — see ensure_user_profile_stub() — so a face registered
    through the Register page always has a corresponding profile record
    instead of only existing as a face folder invisible to anything that
    reads data/users.json. Cheap: a no-op for names that already have one."""
    registered_faces = load_registered_faces(expected_dim=_embedding_dim)
    for name in registered_faces:
        ensure_user_profile_stub(name)
    match_index = build_match_index(registered_faces)
    with state.lock:
        state.registered_faces = registered_faces
        state.registered_count = len(registered_faces)
        state.match_index = match_index


def _clear_live_state():
    """Blank the live view (frame, tracks, hints, toast). Caller holds
    state.lock. Used whenever the frame source goes away, so the dashboard
    doesn't keep showing a frozen last frame with stale boxes on it."""
    state.latest_jpeg = None
    state.frame_width = 0
    state.frame_height = 0
    state.tracks = []
    state.hints = []
    state.toast = None


def camera_loop():
    video_capture = None
    open_index = None
    last_source = None  # so a source change is handled once, not every tick
    toast_active = False
    toast_name = ""
    toast_start_time = 0.0

    fps = 0.0
    fps_timer = time.time()
    fps_frame_count = 0
    consecutive_read_failures = 0

    logger.info("Camera loop active.")

    try:
        while not _shutdown_event.is_set():
            # Reasons to hand the local device back: registration (browser
            # getUserMedia needs exclusive access on some drivers, so the
            # Register page calls /api/camera/pause), a camera scan, which has
            # to open every index itself, and a phone having taken over as the
            # frame source. A fourth case releases it only to immediately
            # reopen: the dashboard picked a different camera.
            release_requested = _camera_paused.is_set() or _camera_scan_hold.is_set()
            with state.lock:
                desired_index = state.camera_index
                source = state.camera_source

            # Handle a source change *once*, as a transition. Doing this
            # per-tick instead was a real bug: with a phone streaming, the
            # "not the local camera" branch ran on every iteration, blanking
            # the frame and tracks and re-publishing them microseconds before
            # the newly processed frame replaced them — so every viewer saw
            # the feed and its boxes flicker several times a second, and
            # camera_active read False about half the time it was sampled.
            if last_source is not None and source != last_source:
                logger.info("Frame source changed: %s -> %s.", last_source, source)
                with tracks_lock:
                    tracker.tracks.clear()
                with state.lock:
                    state.camera_active = False
                    _clear_live_state()
                    _refresh_broadcast_payload()
            last_source = source

            local_wanted = source == SOURCE_LOCAL and not release_requested

            # Let go of the physical webcam when something else needs it, when
            # a phone has taken over as the source, or when a different camera
            # was picked.
            if video_capture is not None and (not local_wanted or desired_index != open_index):
                video_capture.release()
                video_capture = None
                # Drop every in-progress track when we give up the camera.
                # Without this, a track that already reached "completed"
                # (or just has a stale bbox) sits frozen in tracker.tracks
                # while the Register page is open, then gets IOU-matched
                # onto whichever real face reappears in roughly the same
                # screen position once the camera resumes — showing that
                # person the previous occupant's name/status instead of
                # going through a fresh scan. Switching cameras is the
                # same situation, only more so: the tracks belong to a
                # completely different view.
                if release_requested:
                    release_reason = "registration/scan in progress"
                elif source == SOURCE_BROWSER:
                    release_reason = "a browser device is now streaming the video"
                else:
                    release_reason = f"switching to camera {desired_index}"
                logger.info("Camera %s released (%s).", open_index, release_reason)
                with tracks_lock:
                    tracker.tracks.clear()
                open_index = None
                with state.lock:
                    state.camera_active = False
                    state.camera_held = False
                    state.camera_open_index = None
                    _clear_live_state()
                    _refresh_broadcast_payload()

            if source == SOURCE_LOCAL and release_requested:
                # Paused for registration or a device scan. Keep the view
                # blank, but only publish that once — see the flicker note.
                with state.lock:
                    if state.camera_active or state.latest_jpeg is not None:
                        state.camera_active = False
                        state.camera_held = False
                        _clear_live_state()
                        _refresh_broadcast_payload()
                time.sleep(0.2)
                continue

            if source == SOURCE_BROWSER:
                # A phone (or any browser that can't be opened with
                # VideoCapture) is pushing JPEGs up /ws/ingest. Everything
                # past this point is identical to the local-webcam path —
                # same detector, tracker, worker and attendance logging.
                frame = _frame_ingest.wait_for_frame(INGEST_FRAME_TIMEOUT)
                if frame is None and _frame_ingest.active_websocket is None:
                    # The device just disconnected: releasing its claim wakes
                    # our wait immediately, so this isn't a stall. The source
                    # flips back to the local webcam on the next iteration —
                    # reporting an error here would flash a bogus "no video
                    # from the streaming device" on every normal disconnect.
                    # The short sleep keeps this from spinning during the few
                    # milliseconds between the socket's claim being released
                    # and camera_source flipping back.
                    time.sleep(0.05)
                    continue
                if frame is None:
                    # Still connected but nothing arriving: phone backgrounded,
                    # screen locked, or the network dropped. Say so rather than
                    # leaving the last frame frozen on screen.
                    with state.lock:
                        if state.camera_active:
                            logger.warning("Streaming device stopped sending frames.")
                        state.camera_active = False
                        state.camera_error = (
                            "No video from the streaming device — make sure its screen is on "
                            "and the dashboard tab is in the foreground."
                        )
                        _clear_live_state()
                        _refresh_broadcast_payload()
                    with tracks_lock:
                        tracker.tracks.clear()
                    continue

                with state.lock:
                    if not state.camera_active:
                        logger.info("Receiving frames from streaming device (%s).",
                                    _frame_ingest.label or "unnamed device")
                    state.camera_active = True
                    state.camera_error = None
            elif video_capture is None:
                # Claim the device *before* opening it, so a pause/scan
                # request that arrives mid-acquisition waits for us instead
                # of being told the camera is already free.
                with state.lock:
                    state.camera_held = True
                # The warm-up frame _open_capture already pulled is discarded:
                # the read below is a fresh one a few milliseconds later.
                video_capture, backend_name, _ = _open_capture(desired_index)
                if video_capture is None:
                    logger.error("Camera %d cannot be accessed. Retrying...", desired_index)
                    with state.lock:
                        state.camera_held = False
                        state.camera_error = (
                            f"Camera {desired_index} isn't delivering video — it may be "
                            "unplugged, disabled, or in use by another app. Try picking a "
                            "different camera."
                        )
                        _refresh_broadcast_payload()
                    time.sleep(1.0)
                    continue
                open_index = desired_index
                logger.info("Camera %d (re)acquired via %s.", desired_index, backend_name)
                consecutive_read_failures = 0
                with state.lock:
                    state.camera_active = True
                    state.camera_held = True
                    state.camera_open_index = desired_index
                    state.camera_error = None

            if source == SOURCE_LOCAL:
                ret, frame = video_capture.read()
                if not ret or frame is None:
                    consecutive_read_failures += 1
                    if consecutive_read_failures > 90:
                        logger.error("Camera %d stopped delivering frames. Releasing and retrying.", open_index)
                        video_capture.release()
                        video_capture = None
                        open_index = None
                        with state.lock:
                            state.camera_active = False
                            state.camera_held = False
                            state.camera_open_index = None
                            state.camera_error = f"Camera {desired_index} stopped delivering frames. Reconnecting…"
                            _refresh_broadcast_payload()
                        time.sleep(1.0)
                        continue
                    time.sleep(0.03)
                    continue
                consecutive_read_failures = 0

            fps_frame_count += 1
            elapsed = time.time() - fps_timer
            if elapsed >= 1.0:
                fps = fps_frame_count / elapsed
                fps_frame_count = 0
                fps_timer = time.time()

            # 1. Local face detection. Only detections that are actually
            #    face-shaped AND inside the configured distance range reach
            #    the tracker — out_of_range holds real faces that are too
            #    far (or too close) to scan, which are shown to the user as
            #    a hint but never tracked, so someone standing in the
            #    background is never recognized or logged.
            detected_boxes, out_of_range = FACE_DETECTOR.detect(frame)

            # 2. Update tracking + queue recognition / toast triggers
            with tracks_lock:
                current_tracks, removed_tracks = tracker.update(detected_boxes)

                # A track that already logged a successful time-in
                # (attendance_logged_in went True when that happened — see
                # the worker below) just left frame for good: log its
                # time-out now, at the moment it's actually gone, not some
                # later inferred guess.
                for removed in removed_tracks:
                    if removed.attendance_logged_in:
                        log_attendance(removed.label, track_id=removed.track_id, event_type="OUT")

                for track_id, track in list(current_tracks.items()):
                    now = time.time()
                    need_recognition = False
                    track_duration = now - track.first_seen

                    if track.status == "idle":
                        if track.recognition_attempts == 0:
                            if track_duration >= FIRST_SCAN_DELAY_SECONDS:
                                need_recognition = True
                        elif now - track.last_recognition_time > RETRY_COOLDOWN_SECONDS:
                            need_recognition = True

                    if need_recognition:
                        face_chip = crop_face_with_padding(frame, track.bbox)
                        if face_chip.size > 0:
                            track.status = "processing"
                            logger.debug("Scan duration reached, queueing track %d for recognition.", track_id)
                            _worker.queue_recognition(track_id, face_chip)

                    if track.status == "completed" and not track.toast_triggered:
                        toast_active = True
                        toast_name = track.label
                        toast_start_time = time.time()
                        track.toast_triggered = True

                        with state.lock:
                            # %I is zero-padded (e.g. "04:13:46 PM"); lstrip
                            # drops that one leading zero for a natural
                            # "4:13:46 PM" — safe here since %I always
                            # produces exactly two digits, so there's at
                            # most one to strip.
                            checkin_time = datetime.now().strftime("%I:%M:%S %p").lstrip("0")
                            state.recent_checkins.append((track.label, checkin_time))
                            if len(state.recent_checkins) > RECENT_CHECKINS_MAX:
                                state.recent_checkins = state.recent_checkins[-RECENT_CHECKINS_MAX:]

                # Build a JSON-safe snapshot while still holding tracks_lock
                tracks_snapshot = []
                for track_id, track in current_tracks.items():
                    progress = None
                    if track.label == "Scanning...":
                        track_duration = time.time() - track.first_seen
                        progress = min(100, int((track_duration / FIRST_SCAN_DELAY_SECONDS) * 100))
                    tracks_snapshot.append({
                        "track_id": track_id,
                        "bbox": [int(v) for v in track.bbox],
                        "label": track.label,
                        "status": track.status,
                        "distance": float(track.distance),
                        "progress": progress,
                    })

            if toast_active and time.time() - toast_start_time > TOAST_DURATION_SECONDS:
                toast_active = False

            # 3. Encode frame for streaming
            ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), FRAME_JPEG_QUALITY])
            jpeg_bytes = buf.tobytes() if ok else None

            with state.lock:
                if jpeg_bytes is not None:
                    state.latest_jpeg = jpeg_bytes
                frame_h, frame_w = frame.shape[:2]
                state.frame_width = int(frame_w)
                state.frame_height = int(frame_h)
                state.tracks = tracks_snapshot
                state.hints = out_of_range
                state.toast = {"name": toast_name, "start_time": toast_start_time} if toast_active else None
                state.fps = fps
                _refresh_broadcast_payload()
    finally:
        if video_capture is not None:
            video_capture.release()
        logger.info("Camera loop stopped.")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _worker, _camera_thread, _embedding_dim

    logger.info("=" * 60)
    logger.info("AI Face ID -- Web Backend")
    logger.info("=" * 60)
    logger.info("Warming up %s model...", MODEL_NAME)
    dummy = np.zeros((160, 160, 3), dtype=np.uint8)
    last_error = None
    for attempt in range(2):
        try:
            warm_vector = get_embedding(dummy, detector_backend="skip", enforce_detection=False)
            _embedding_dim = len(warm_vector) if warm_vector else None
            if _embedding_dim:
                break
        except Exception as e:
            last_error = e
            logger.warning("Model warm-up attempt %d failed: %s", attempt + 1, e)

    if not _embedding_dim:
        # Without a known embedding dimension the dimension guard in
        # load_registered_faces() can't tell a stale (wrong-model) template
        # from a real one — starting up "successfully" here would silently
        # let old embeddings through instead of catching a model/data
        # mismatch. Fail loudly instead (this is almost always a network
        # hiccup on the first-ever weights download; just retry the server).
        raise RuntimeError(
            f"Could not warm up {MODEL_NAME} after 2 attempts"
            + (f": {last_error}" if last_error else "")
            + ". DeepFace downloads model weights on first use, so check your "
              "internet connection and restart the server."
        )

    # Build the detector now rather than on the camera thread's first frame:
    # the same "fail loudly instead of running degraded" reasoning as the
    # warm-up above applies — without a detector there is nothing to track,
    # and that would otherwise show up as a live feed where no face is ever
    # noticed instead of an error.
    logger.info("Warming up the YuNet face detector...")
    FACE_DETECTOR.warm_up()
    logger.info(
        "Detection range: face width %.0f%%-%.0f%% of frame width (faces outside it are ignored).",
        MIN_FACE_WIDTH_RATIO * 100, MAX_FACE_WIDTH_RATIO * 100,
    )

    logger.info("Loading registered templates...")
    _reload_registered_faces()
    logger.info("Database loaded. (%d user(s) registered)", state.registered_count)

    # Enumerate cameras before the camera thread starts, so probing never
    # fights the live feed for the device. The dashboard's picker uses this
    # list; /api/cameras/scan refreshes it later (pausing the feed) if a
    # camera is plugged in while the server is running.
    logger.info("Scanning for cameras (indices 0-%d)...", CAMERA_PROBE_MAX_INDEX)
    cameras = _probe_cameras()
    available = [camera["index"] for camera in cameras]

    saved_index = load_settings().get("camera_index")
    selected_index = saved_index if isinstance(saved_index, int) else DEFAULT_CAMERA_INDEX
    if available and selected_index not in available:
        # Don't persist this fallback — if the preferred camera comes back on
        # a later run, we should go back to using it.
        logger.warning(
            "Camera %d isn't available; falling back to camera %d for this run.",
            selected_index, available[0],
        )
        selected_index = available[0]

    with state.lock:
        state.cameras = cameras
        state.camera_index = selected_index
    logger.info(
        "Cameras found: %s. Using camera %d.",
        ", ".join(f"{c['index']} ({c['width']}x{c['height']}, {c['backend']})" for c in cameras)
        if cameras else "none", selected_index,
    )

    _worker = FaceRecognitionWorker(tracker.tracks, tracks_lock, state)
    _worker.start()

    _camera_thread = threading.Thread(target=camera_loop, daemon=True)
    _camera_thread.start()

    yield

    logger.info("Shutting down...")
    _shutdown_event.set()
    _worker.stop()
    if _camera_thread is not None:
        _camera_thread.join(timeout=3.0)


app = FastAPI(lifespan=lifespan)


@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket):
    """Streams the shared, pre-serialized AppState snapshot (built once per
    camera-loop tick by _refresh_broadcast_payload) to this client. Every
    connected dashboard receives the identical JSON string, so opening more
    dashboards doesn't cost the camera thread any extra per-client encode
    or serialize work — see _refresh_broadcast_payload's docstring.

    ``?frames=0`` sends the same snapshot without the JPEG. A phone streaming
    its own camera renders its local video element directly, so shipping the
    frames back to it would double its bandwidth for a picture it already
    has (and add a round trip of lag to the preview).
    """
    await websocket.accept()
    include_frames = websocket.query_params.get("frames") != "0"
    try:
        while True:
            with state.lock:
                payload = state.latest_payload if include_frames else state.latest_payload_lite
            await websocket.send_text(payload)
            await asyncio.sleep(STATE_BROADCAST_INTERVAL)
    except WebSocketDisconnect:
        pass  # normal: the client closed the tab or navigated away
    except (RuntimeError, ConnectionResetError):
        # Also normal: the client disappeared mid-send (tab close, refresh,
        # or a dev-mode React StrictMode double-mount opening and instantly
        # closing a socket) before a clean WebSocketDisconnect surfaced.
        # Not a server error — not worth logging on every page load.
        pass
    except Exception:
        logger.exception("Unexpected error in /ws/live")


def _decode_jpeg_bytes(raw):
    if not raw or len(raw) > INGEST_MAX_FRAME_BYTES:
        return None
    arr = np.frombuffer(raw, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def _set_camera_source(source, label=None):
    """Switch which frame source camera_loop consumes. The loop picks this up
    on its next iteration (releasing the local webcam if it's moving away
    from it), so this only has to set the state."""
    with state.lock:
        changed = state.camera_source != source
        state.camera_source = source
        state.source_label = label
        state.camera_error = None
        if changed:
            state.camera_active = False
            _clear_live_state()
            _refresh_broadcast_payload()
    if changed:
        logger.info("Frame source is now %s%s.", source, f" ({label})" if label else "")


@app.websocket("/ws/ingest")
async def ws_ingest(websocket: WebSocket):
    """Accepts camera frames pushed *up* from a browser — the phone case.

    A phone's camera can't be opened with cv2.VideoCapture from this process
    at all, so instead of the backend pulling frames from a device, the phone
    grabs them with getUserMedia, JPEG-encodes them and sends them here as
    binary frames. camera_loop then treats them exactly like webcam frames:
    same YuNet gate, same tracker, same recognition worker, same attendance
    logging — nothing downstream knows or cares where the pixels came from.

    Connecting *is* the request to become the video source (and disconnecting
    hands it back to the local webcam), because the phone can't stream
    without its page being open anyway. Only one streaming device at a time:
    two phones pushing into the same tracker would interleave faces from two
    different rooms into one set of tracks.
    """
    await websocket.accept()
    label = websocket.query_params.get("label") or "browser device"

    if not _frame_ingest.claim(websocket, label):
        await websocket.send_text(json.dumps({
            "ok": False,
            "error": "Another device is already streaming to this dashboard.",
        }))
        await websocket.close()
        return

    logger.info("Streaming device connected: %s", label)
    _set_camera_source(SOURCE_BROWSER, label)
    await websocket.send_text(json.dumps({"ok": True}))

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            raw = message.get("bytes")
            if raw is None:
                # Text frames are only used for the odd control message; a
                # client that sends its video as base64 still works.
                text = message.get("text") or ""
                raw = base64.b64decode(text.split(",", 1)[-1]) if text.startswith("data:") else None
                if raw is None:
                    continue
            frame = _decode_jpeg_bytes(raw)
            if frame is not None:
                _frame_ingest.submit(frame)
    except WebSocketDisconnect:
        pass  # normal: the phone closed the tab, locked the screen, or roamed
    except (RuntimeError, ConnectionResetError):
        pass  # client vanished mid-receive — same as /ws/live
    except Exception:
        logger.exception("Unexpected error in /ws/ingest")
    finally:
        if _frame_ingest.release(websocket):
            logger.info("Streaming device disconnected: %s", label)
            # Back to the local webcam, which the loop reopens by itself.
            _set_camera_source(SOURCE_LOCAL)


async def _stop_browser_source():
    """Disconnect the streaming device, if any, so the local webcam can take
    over. Used when someone explicitly picks a local camera — an explicit
    choice should win over whatever connected earlier."""
    websocket = _frame_ingest.active_websocket
    if websocket is None:
        return False
    try:
        await websocket.close()
    except Exception:
        pass  # already gone; its own finally block does the cleanup
    # Don't wait for the socket's handler to run its finally — set the source
    # here so the caller can rely on it having taken effect.
    _frame_ingest.release(websocket)
    _set_camera_source(SOURCE_LOCAL)
    return True


class RegisterRequest(BaseModel):
    name: str
    image_b64: str  # raw base64 or a data: URL from a <canvas>.toDataURL()


def _decode_image_b64(image_b64: str):
    if image_b64.strip().startswith("data:") and "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(image_b64)
    except Exception:
        return None
    arr = np.frombuffer(raw, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


@app.post("/api/register")
def api_register(payload: RegisterRequest):
    image = _decode_image_b64(payload.image_b64)
    if image is None:
        raise HTTPException(status_code=400, detail="Could not decode the captured image.")

    try:
        name, template_count = register_face_embedding(payload.name, image)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    _reload_registered_faces()
    return {"success": True, "name": name, "template_count": template_count}


class DetectRequest(BaseModel):
    image_b64: str


@app.post("/api/register/detect")
def api_register_detect(payload: DetectRequest):
    """Lightweight face-count/box preview for the Register page — runs the
    same detection gate as the live dashboard on a single posted frame (no
    DeepFace/embedding work), so the browser can show a live "face detected"
    box and block capture unless exactly one face is in frame. Sharing the
    gate matters: a template captured at a distance the live loop refuses to
    scan would be registered and then never usable. Doesn't touch the
    physical camera, so it's safe to call while camera_loop is paused for
    registration."""
    image = _decode_image_b64(payload.image_b64)
    if image is None:
        raise HTTPException(status_code=400, detail="Could not decode the captured image.")

    h, w = image.shape[:2]
    faces, out_of_range = FACE_DETECTOR.detect(image)
    return {
        "width": w,
        "height": h,
        "faces": [list(box) for box in faces],
        "out_of_range": out_of_range,
    }


@app.get("/api/status")
def api_status():
    with state.lock:
        registered_faces = dict(state.registered_faces)
    return {
        "registered_count": len(registered_faces),
        "people": [
            {"name": name, "template_count": len(vectors)}
            for name, vectors in sorted(registered_faces.items())
        ],
    }


class UserProfileRequest(BaseModel):
    name: str
    email: str = ""
    phone: str = ""
    department: str = ""
    position: str = ""
    employee_id: str = ""
    notes: str = ""


@app.get("/api/users")
def api_list_users():
    """Personal-detail profiles merged with face-registration status, for
    the User Management page. Includes anyone who has either a face
    template or a saved profile (someone may have one without the other)."""
    with state.lock:
        registered_faces = dict(state.registered_faces)
    profiles = load_user_profiles()

    names = sorted(set(registered_faces) | set(profiles))
    users = []
    for name in names:
        profile = profiles.get(name, {})
        users.append({
            "name": name,
            "template_count": len(registered_faces.get(name, [])),
            "email": profile.get("email", ""),
            "phone": profile.get("phone", ""),
            "department": profile.get("department", ""),
            "position": profile.get("position", ""),
            "employee_id": profile.get("employee_id", ""),
            "notes": profile.get("notes", ""),
            "updated_at": profile.get("updated_at"),
        })
    return {"users": users}


@app.post("/api/users")
def api_save_user(payload: UserProfileRequest):
    try:
        profile = save_user_profile(payload.name, payload.model_dump(exclude={"name"}))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "user": profile}


@app.delete("/api/users/{name}")
def api_delete_user(name: str):
    if not delete_user_profile(name):
        raise HTTPException(status_code=404, detail="No profile found for that name.")
    return {"success": True}


class ManualAttendanceRequest(BaseModel):
    name: str
    event_type: str  # "IN" or "OUT"


@app.post("/api/attendance/manual")
def api_manual_attendance(payload: ManualAttendanceRequest):
    """Log a time-in/time-out without going through face recognition —
    a fallback for when the camera can't be used. Enforces at most one IN
    and one OUT per person per calendar day (see manual_time_event())."""
    if payload.event_type not in ("IN", "OUT"):
        raise HTTPException(status_code=400, detail="event_type must be 'IN' or 'OUT'.")
    try:
        timestamp = manual_time_event(payload.name, payload.event_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "name": payload.name, "type": payload.event_type, "timestamp": timestamp}


@app.get("/api/attendance")
def api_attendance():
    """Raw attendance.csv rows (Name, Timestamp, Type) for the Analytics and
    DTR pages. Aggregation (per-day, per-person, IN/OUT pairing) happens
    client-side since the log is small; this just hands back parsed rows,
    oldest first. Rows written before the Type column existed only have 2
    columns — treated as "IN" (every row logged under the old system was an
    arrival)."""
    if not os.path.isfile(ATTENDANCE_CSV):
        return {"records": []}

    records = []
    with open(ATTENDANCE_CSV, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader, None)  # header row
        for row in reader:
            if len(row) >= 2:
                records.append({
                    "name": row[0],
                    "timestamp": row[1],
                    "type": row[2] if len(row) >= 3 and row[2] in ("IN", "OUT") else "IN",
                })
    return {"records": records}


@app.get("/api/cameras")
def api_list_cameras():
    """The cameras found by the last scan (startup, or the last
    /api/cameras/scan) plus which one is selected and whether it's live.
    Cached deliberately — actually probing devices means taking the webcam
    away from the live feed for a couple of seconds, which shouldn't happen
    just because someone opened the dashboard."""
    return _cameras_response()


@app.post("/api/cameras/scan")
async def api_scan_cameras():
    """Re-probe the device indices — for when a camera is plugged in (or
    unplugged) while the server is running. Briefly interrupts the live feed:
    the probe needs each device free, so camera_loop releases its handle for
    the duration and the dashboard shows no frames until it's done."""
    if not _camera_scan_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="A camera scan is already in progress.")
    try:
        _camera_scan_hold.set()
        for _ in range(40):  # up to ~2s for camera_loop to confirm the release
            with state.lock:
                if not state.camera_held:
                    break
            await asyncio.sleep(0.05)
        # Off the event loop: probing blocks for a second or more per index,
        # which would otherwise stall every WebSocket broadcast with it.
        cameras = await asyncio.to_thread(_probe_cameras)
    finally:
        _camera_scan_hold.clear()
        _camera_scan_lock.release()

    with state.lock:
        state.cameras = cameras
    logger.info("Camera scan found %d camera(s).", len(cameras))
    return _cameras_response()


class CameraSelectRequest(BaseModel):
    index: int


@app.post("/api/camera/select")
async def api_select_camera(payload: CameraSelectRequest):
    """Switch the live feed to a different camera. camera_loop notices the
    new index on its next iteration, releases the old device and opens this
    one; we wait briefly for that to actually happen so the response can
    report a failed switch (bad index, camera in use) instead of leaving the
    dashboard staring at a black frame."""
    if not 0 <= payload.index <= CAMERA_PROBE_MAX_INDEX:
        raise HTTPException(
            status_code=400,
            detail=f"Camera index must be between 0 and {CAMERA_PROBE_MAX_INDEX}.",
        )

    # Picking a local camera is an explicit choice, so it takes the video back
    # from a phone that connected earlier rather than being silently ignored
    # while the browser source stays in charge.
    await _stop_browser_source()

    with state.lock:
        state.camera_index = payload.index
        state.camera_error = None
    save_settings({"camera_index": payload.index})
    logger.info("Camera selection changed to %d.", payload.index)

    # The Register page holds the camera via getUserMedia, so a switch made
    # while paused can't be confirmed now — it takes effect on resume.
    if not _camera_paused.is_set():
        for _ in range(60):  # up to ~3s
            with state.lock:
                settled = state.camera_open_index == payload.index or state.camera_error
            if settled:
                break
            await asyncio.sleep(0.05)

    return _cameras_response()


@app.post("/api/camera/pause")
async def api_camera_pause():
    """Release the backend's hold on the webcam so the browser's own
    getUserMedia (used by the Register page) can acquire it. Waits briefly
    for camera_loop to actually confirm the release before responding, so
    the frontend doesn't race ahead and try to open the camera too early."""
    _camera_paused.set()
    for _ in range(40):  # up to ~2s
        with state.lock:
            if not state.camera_held:
                break
        await asyncio.sleep(0.05)
    return {"paused": True}


@app.post("/api/camera/resume")
async def api_camera_resume():
    """Let the backend reacquire the webcam for the live dashboard feed."""
    _camera_paused.clear()
    return {"paused": False}


# Serve the built React app. Falls back to a helpful message if the
# frontend hasn't been built yet (npm run build in frontend/), so the
# backend still starts standalone during development.
if os.path.isdir(FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
else:
    @app.get("/")
    def frontend_not_built():
        return {
            "detail": (
                "Frontend not built yet. Run `npm run build` in frontend/ for production, "
                "or `npm run dev` there for local development (it proxies /api and /ws here)."
            )
        }
