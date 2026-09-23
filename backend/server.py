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
import re
import secrets
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional, Any, Tuple, List, Dict

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Header, Depends, Query
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# UTF-8 console + logging setup lives in src/__init__.py (runs on import)
from src.tracker import FaceTracker
from src.detection import FaceDetector, MAX_FACE_WIDTH_RATIO, MIN_FACE_WIDTH_RATIO
from src.recognition import build_match_index, get_embedding, MODEL_NAME
from src.liveness import (
    pick_random_challenge,
    CHALLENGE_PROMPTS,
    CHALLENGE_TIMEOUT_SECONDS,
    evaluate_challenge,
)
from src.antispoof import check_anti_spoof, warmup_antispoof
from src.emailer import dispatch_student_credentials, generate_temporary_password
from src.utils import (
    load_registered_faces,
    verify_face_roi,
    crop_face_with_padding,
    log_attendance,
    manual_time_event,
    save_unknown_snapshot,
    save_spoof_snapshot,
    register_face_embedding,
    load_user_profiles,
    save_user_profile,
    delete_user_profile,
    delete_face_templates,
    wipe_all_data,
    ensure_user_profile_stub,
    load_settings,
    verify_admin_credentials,
    update_admin_credentials,
    create_admin_token,
    verify_admin_token,
    revoke_admin_token,
    has_logged_in_today,
    get_pht_now,
    verify_user_credentials,
    create_user_token,
    verify_user_token,
    verify_any_token,
    set_user_password,
    _hash_password,
    sanitize_name,
    is_camera_allowed,
    is_schedule_enabled,
    set_schedule_enabled,
    ATTENDANCE_CSV,
)
from src.db import init_db, get_all_attendance_records

import os

logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_sibling_dist = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend", "dist"))
_child_dist = os.path.abspath(os.path.join(BASE_DIR, "frontend", "dist"))
FRONTEND_DIST = _sibling_dist if os.path.isdir(_sibling_dist) else _child_dist

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
# Requested capture resolution: 720p (1280x720) with MJPG delivers smooth
# ~30fps while providing more than enough pixel density for face chips (DeepFace
# only requires 112x112). 1080p uncompressed YUY2 over USB 2.0 stalls webcams at ~5fps.
CAPTURE_REQUEST_WIDTH = 1280
CAPTURE_REQUEST_HEIGHT = 720

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
FRAME_JPEG_QUALITY = 65
STATE_BROADCAST_INTERVAL = 1 / 25  # ~25fps to connected WebSocket clients (smooth and bandwidth-efficient)
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
        self.latest_jpeg: Optional[bytes] = None
        # Size of the frame `tracks`/`hints` were computed on — see the note
        # in _refresh_broadcast_payload.
        self.frame_width: int = 0
        self.frame_height: int = 0
        self.tracks: List[Any] = []
        # Real faces that were detected but rejected by the range gate, so
        # the dashboard can show a "step closer" hint instead of just
        # ignoring someone silently. Never tracked, scanned, or logged.
        self.hints: List[Any] = []
        self.toast: Optional[Dict[str, Any]] = None
        self.fps: float = 0.0
        self.registered_count: int = 0
        self.recent_checkins: List[Any] = []
        self.registered_faces: Dict[str, Any] = {}
        self.match_index: Tuple[List[Any], np.ndarray] = ([], np.zeros((0, 0)))
        self.camera_active: bool = False
        # Which device index the dashboard asked for, which one camera_loop
        # actually has open right now (None while released/switching), the
        # cameras found by the last scan, and the last open/read failure so
        # the UI can say *why* the feed is black instead of just showing
        # "waiting for camera" forever.
        self.camera_index: int = DEFAULT_CAMERA_INDEX
        self.camera_open_index: Optional[int] = None
        # "camera_loop owns the device, or is in the middle of acquiring it."
        # What /api/camera/pause and a camera scan wait to go False, rather
        # than waiting on camera_active: opening a camera can take seconds
        # (see _open_capture), and for all of that time camera_active is
        # still False even though the loop is about to take the device — so
        # pause would answer "released, go ahead" and then steal the webcam
        # back from the browser's getUserMedia a moment later.
        self.camera_held: bool = False
        # SOURCE_LOCAL or SOURCE_BROWSER — see the constants above. Flipped by
        # a device connecting to /ws/ingest, and back when it disconnects.
        self.camera_source: str = SOURCE_LOCAL
        self.source_label: Optional[str] = None  # e.g. "iPhone · front camera", for the UI
        self.cameras: List[Any] = []
        self.camera_error: Optional[str] = None
        self.schedule_closed: bool = False
        self.schedule_message: Optional[str] = None
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
            "schedule_closed": False,
            "schedule_message": None,
            "schedule_enabled": is_schedule_enabled(),
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

    def queue_recognition(self, track_id, face_chip, frame=None, bbox=None):
        self.task_queue.put((track_id, face_chip, frame, bbox))

    def run(self):
        while self.running:
            try:
                item = self.task_queue.get(timeout=0.1)
                if len(item) == 4:
                    track_id, face_chip, frame_snapshot, bbox_snapshot = item
                else:
                    track_id, face_chip = item[:2]
                    frame_snapshot, bbox_snapshot = None, None
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
                    track.last_recognition_time = time.time()
                    track.recognition_attempts += 1
                    logger.debug("Scan completed for track %d: %s (dist: %.4f)", track_id, name, distance)

                    non_person_labels = (
                        "Scanning...", "No Face Detected", "Error", "Unknown",
                        "No Registered Faces", "Spoof Detected", "Liveness Failed",
                    )
                    if name not in non_person_labels:
                        # Gate 1: Passive Anti-Spoofing check (MiniFASNet + screen artifacts)
                        is_real, spoof_reason, spoof_score = True, "genuine", 1.0
                        if frame_snapshot is not None and bbox_snapshot is not None:
                            is_real, spoof_reason, spoof_score = check_anti_spoof(frame_snapshot, bbox_snapshot)

                        if not is_real:
                            track.is_spoof = True
                            track.spoof_reason = spoof_reason
                            track.update_status("Spoof Detected", distance)
                            track.liveness_state = "failed"
                            track.label = "Spoof Detected"
                            save_spoof_snapshot(face_chip)
                            logger.warning(
                                "REPLAY ATTACK BLOCKED: Track %d spoof detected (%s, score: %.3f) for candidate '%s'",
                                track_id, spoof_reason, spoof_score, name
                            )
                        else:
                            track.is_spoof = False
                            if has_logged_in_today(name):
                                track.candidate_name = name
                                track.liveness_state = "already_logged"
                                track.label = f"{name} (Already Logged Today)"
                                track.status = "completed"
                                track.attendance_logged_in = False
                                track.toast_triggered = True
                                logger.info("Track %d matched as %s — already logged in today.", track_id, name)
                            else:
                                if track.liveness_state in ("none", "failed"):
                                    track.candidate_name = name
                                    track.challenge = pick_random_challenge()
                                    track.challenge_text = CHALLENGE_PROMPTS.get(track.challenge, "Please follow prompt")
                                    track.challenge_start_time = time.time()
                                    track.challenge_seconds_left = CHALLENGE_TIMEOUT_SECONDS
                                    track.challenge_baseline = None
                                    track.liveness_state = "challenge"
                                    track.label = f"{name} - {track.challenge_text}"
                                    track.status = "idle"
                                    logger.info(
                                        "Track %d matched as %s (anti-spoof passed, score: %.2f); issuing active liveness challenge: %s",
                                        track_id, name, spoof_score, track.challenge
                                    )
                                elif track.liveness_state == "passed":
                                    track.update_status(name, distance)
                    else:
                        track.update_status(name, distance)

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
        "schedule_closed": state.schedule_closed,
        "schedule_message": state.schedule_message,
        "schedule_enabled": is_schedule_enabled(),
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

        # Request hardware MJPG compression and 30fps to avoid 5fps USB 2.0 uncompressed bottlenecks
        try:
            capture.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
        except Exception:
            pass
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, CAPTURE_REQUEST_WIDTH)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, CAPTURE_REQUEST_HEIGHT)
        try:
            capture.set(cv2.CAP_PROP_FPS, 30)
        except Exception:
            pass

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
        if capture is None or frame is None:
            if capture is not None:
                capture.release()
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
    toast_status = "ON_TIME"
    toast_start_time = 0.0

    fps = 0.0
    fps_timer = time.time()
    fps_frame_count = 0
    consecutive_read_failures = 0

    logger.info("Camera loop active.")

    try:
        while not _shutdown_event.is_set():
            frame: Any = None

            # Check camera schedule (Philippine Time UTC+8)
            now_pht = get_pht_now()
            cam_allowed, schedule_msg = is_camera_allowed(now_pht)
            if not cam_allowed:
                if video_capture is not None:
                    video_capture.release()
                    video_capture = None
                    open_index = None
                    logger.info("Camera released due to schedule: %s", schedule_msg)

                with tracks_lock:
                    tracker.tracks.clear()

                with state.lock:
                    state.camera_active = False
                    state.camera_held = False
                    state.camera_open_index = None
                    state.schedule_closed = True
                    state.schedule_message = schedule_msg
                    state.camera_error = schedule_msg
                    _clear_live_state()
                    _refresh_broadcast_payload()

                time.sleep(1.0)
                continue
            else:
                with state.lock:
                    if state.schedule_closed:
                        state.schedule_closed = False
                        state.schedule_message = None
                        if state.camera_error in (
                            "login is currently closed as 6:30 AM has passed.",
                            "login is currently closed as 8:00 AM has passed.",
                            "login is currently closed. Attendance is not active on Sundays.",
                        ):
                            state.camera_error = None

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
                if video_capture is None:
                    time.sleep(0.05)
                    continue
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

            if frame is None:
                time.sleep(0.03)
                continue

            # Force maximum 720p resolution (1280x720) preserving aspect ratio
            h, w = frame.shape[:2]
            if w > 1280 or h > 720:
                scale = min(1280.0 / w, 720.0 / h)
                new_w = max(1, int(w * scale))
                new_h = max(1, int(h * scale))
                frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)

            fps_frame_count += 1
            elapsed = time.time() - fps_timer
            if elapsed >= 1.0:
                fps = fps_frame_count / elapsed
                fps_frame_count = 0
                fps_timer = time.time()

            # 1. Local face detection with landmarks
            det_res = FACE_DETECTOR.detect(frame, return_landmarks=True)
            detected_boxes, detected_landmarks, out_of_range = det_res[0], det_res[1], det_res[2]

            # 2. Update tracking + queue recognition / liveness checks
            with tracks_lock:
                current_tracks, removed_tracks = tracker.update(detected_boxes, detected_landmarks)

                # Automatic logout is removed per specifications (single daily check-in IN only).
                # Removed tracks are allowed to age out cleanly without triggering OUT events.

                for track_id, track in list(current_tracks.items()):
                    now = time.time()

                    # Evaluate active liveness gesture in real time
                    if track.liveness_state == "challenge":
                        elapsed = now - track.challenge_start_time
                        status, seconds_left, metrics = evaluate_challenge(
                            track.challenge,
                            track.latest_landmarks,
                            track.challenge_baseline,
                            elapsed,
                            timeout=CHALLENGE_TIMEOUT_SECONDS,
                        )
                        track.challenge_seconds_left = seconds_left
                        if track.challenge_baseline is None and metrics:
                            track.challenge_baseline = metrics

                        if status == "passed":
                            # Gate 2: Final Anti-Spoof Confirmation Check
                            # Prevents any on-the-fly screen swap or video replay passing
                            is_real, spoof_reason, spoof_score = check_anti_spoof(frame, track.bbox)
                            if not is_real:
                                track.is_spoof = True
                                track.spoof_reason = spoof_reason
                                track.liveness_state = "failed"
                                track.update_status("Spoof Detected")
                                track.label = "Spoof Detected"
                                save_spoof_snapshot(crop_face_with_padding(frame, track.bbox))
                                logger.warning(
                                    "Active challenge passed but presentation attack caught by anti-spoof (%s, score: %.3f)",
                                    spoof_reason, spoof_score
                                )
                            else:
                                track.liveness_state = "passed"
                                confirmed_name = track.candidate_name or track.label.split(" - ")[0]
                                track.update_status(confirmed_name)
                                logged, att_status, att_msg = log_attendance(confirmed_name, track_id=track_id, event_type="IN")
                                if logged:
                                    track.toast_triggered = False
                                    track.attendance_logged_in = True
                                    track.attendance_status = att_status
                                    logger.info(
                                        "Active liveness & anti-spoof passed for %s (%s). Check-in logged IN (%s).",
                                        confirmed_name, track.challenge, att_status
                                    )
                                else:
                                    track.attendance_logged_in = False
                                    track.toast_triggered = True
                                    track.liveness_state = "already_logged"
                                    if att_status == "SUNDAY_CLOSED":
                                        track.label = f"{confirmed_name} (Closed on Sundays)"
                                    elif att_status == "REJECTED":
                                        track.label = f"{confirmed_name} (Closed: Past 6:30 AM)"
                                    else:
                                        track.label = f"{confirmed_name} (Already Logged Today)"
                        elif status == "failed":
                            track.liveness_state = "failed"
                            track.update_status("Liveness Failed")
                            save_spoof_snapshot(crop_face_with_padding(frame, track.bbox))
                            logger.warning("Active liveness challenge timed out for track %d (%s).", track_id, track.candidate_name)

                    need_recognition = False
                    track_duration = now - track.first_seen

                    if track.status == "idle" and track.liveness_state != "challenge":
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
                            if _worker is not None:
                                _worker.queue_recognition(track_id, face_chip, frame.copy(), track.bbox)

                    if track.attendance_logged_in and not track.toast_triggered:
                        toast_active = True
                        toast_name = track.label
                        toast_status = getattr(track, "attendance_status", "ON_TIME")
                        toast_start_time = time.time()
                        track.toast_triggered = True

                        with state.lock:
                            # Natural "4:13:46 PM" timestamp in Philippine Standard Time (PST/PHT: UTC+8)
                            checkin_time = get_pht_now().strftime("%I:%M:%S %p").lstrip("0")
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
                        "challenge": track.challenge,
                        "challenge_text": track.challenge_text,
                        "challenge_seconds_left": round(track.challenge_seconds_left, 1),
                        "liveness_state": track.liveness_state,
                        "is_spoof": getattr(track, "is_spoof", False),
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
                state.toast = {
                    "name": toast_name,
                    "status": toast_status,
                    "start_time": toast_start_time,
                } if toast_active else None
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

    logger.info("Warming up the anti-spoofing engine (MiniFASNet)...")
    try:
        warmup_antispoof()
    except Exception as e:
        logger.warning("Anti-spoofing warmup warning: %s", e)

    logger.info("Initializing SQLite database...")
    init_db()

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

    cam_allowed, sched_msg = is_camera_allowed(get_pht_now())
    if not cam_allowed:
        await websocket.send_text(json.dumps({
            "ok": False,
            "error": sched_msg or "Camera is currently closed.",
        }))
        await websocket.close()
        return

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
    student_number: str = ""
    email: str = ""
    department: str = ""
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
    student_num = payload.student_number.strip().upper()
    if student_num and not re.match(r"^\d{2}-\d{5}$", student_num):
        raise HTTPException(
            status_code=400,
            detail="Student number must follow the YY-NNNNN format (e.g. 26-00123).",
        )

    email = payload.email.strip()
    if email and ("@" not in email or "." not in email):
        raise HTTPException(status_code=400, detail="Please enter a valid domain email address.")

    image = _decode_image_b64(payload.image_b64)
    if image is None:
        raise HTTPException(status_code=400, detail="Could not decode the captured image.")

    try:
        name, template_count = register_face_embedding(payload.name, image)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    clean_name = sanitize_name(name)
    profiles = load_user_profiles()
    existing_profile = profiles.get(clean_name, {})

    # Check if student already has saved credentials
    existing_password = existing_profile.get("temp_password") or existing_profile.get("password_hash")
    existing_sent = existing_profile.get("credentials_sent", False)

    if existing_password:
        # Preserve existing credentials! Do not regenerate a new password.
        temp_password = existing_profile.get("temp_password")
        salt = existing_profile.get("salt") or secrets.token_hex(16)
        pwd_hash = existing_profile.get("password_hash") or (_hash_password(temp_password, salt) if temp_password else "")
        email_status = "already_sent"
    else:
        # First template for this student: generate initial credentials
        temp_password = generate_temporary_password()
        salt = secrets.token_hex(16)
        pwd_hash = _hash_password(temp_password, salt)
        email_status = "pending"

    profile_updates = {
        "student_number": student_num or existing_profile.get("student_number", ""),
        "employee_id": student_num or existing_profile.get("employee_id", ""),
        "email": email or existing_profile.get("email", ""),
        "department": payload.department.strip() or existing_profile.get("department", ""),
        "account_id": student_num or clean_name,
        "salt": salt,
        "password_hash": pwd_hash,
        "role": "student",
    }
    if temp_password:
        profile_updates["temp_password"] = temp_password

    # Only dispatch email if credentials haven't been dispatched yet (first template)
    if email and not existing_sent:
        dispatch_result = dispatch_student_credentials(
            name, student_num or "N/A", email, temp_password, settings=load_settings()
        )
        email_status = dispatch_result.get("status", "sent")
        profile_updates["credentials_sent"] = True
        profile_updates["credentials_sent_at"] = get_pht_now().isoformat()
    elif existing_sent:
        profile_updates["credentials_sent"] = True
        email_status = "already_sent"
    else:
        email_status = "skipped"

    save_user_profile(clean_name, profile_updates)
    _reload_registered_faces()

    return {
        "success": True,
        "name": name,
        "student_number": student_num,
        "template_count": template_count,
        "email_status": email_status,
    }


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
    student_number: str = ""
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
        student_num = profile.get("student_number") or profile.get("employee_id") or ""
        users.append({
            "name": name,
            "template_count": len(registered_faces.get(name, [])),
            "email": profile.get("email", ""),
            "phone": profile.get("phone", ""),
            "department": profile.get("department", ""),
            "position": profile.get("position", ""),
            "student_number": student_num,
            "employee_id": student_num,
            "notes": profile.get("notes", ""),
            "updated_at": profile.get("updated_at"),
        })
    return {"users": users}


@app.post("/api/users")
def api_save_user(payload: UserProfileRequest):
    try:
        data = payload.model_dump(exclude={"name"})
        if data.get("student_number") and not data.get("employee_id"):
            data["employee_id"] = data["student_number"]
        elif data.get("employee_id") and not data.get("student_number"):
            data["student_number"] = data["employee_id"]
        profile = save_user_profile(payload.name, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "user": profile}


@app.delete("/api/users/{name}")
def api_delete_user(name: str):
    if not delete_user_profile(name):
        raise HTTPException(status_code=404, detail="No profile or face templates found for that name.")
    _reload_registered_faces()
    return {"success": True}


@app.post("/api/admin/wipe-data")
def api_wipe_data():
    """Wipe all collected attendance records, registered faces, user profiles, outbox, and logs."""
    wipe_all_data()
    _reload_registered_faces()
    with state.lock:
        state.recent_checkins = []
    logger.info("Admin triggered complete data wipe.")
    return {"success": True, "message": "All data wiped clean."}


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_username: Optional[str] = None
    new_password: str


def get_current_user_session(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid Authorization header format")
    token = parts[1]
    session = verify_any_token(token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session token")
    return session


def get_current_admin(authorization: Optional[str] = Header(None)) -> str:
    session = get_current_user_session(authorization)
    if session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Administrator privileges required.")
    return session["username"]


@app.post("/api/auth/login")
def api_login(payload: LoginRequest):
    """Administrator login endpoint strictly for the web dashboard."""
    username = payload.username.strip()
    password = payload.password

    if verify_admin_credentials(username, password):
        token = create_admin_token(username)
        return {
            "success": True,
            "token": token,
            "username": username,
            "role": "admin",
        }

    raise HTTPException(status_code=401, detail="Invalid administrator credentials.")


@app.post("/api/student/login")
@app.post("/api/user/login")
def api_student_login(payload: LoginRequest):
    """Dedicated login endpoint for student mobile apps."""
    user = verify_user_credentials(payload.username.strip(), payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid student number, email, or password.")
    role = user.get("role", "student")
    token = create_user_token(user["name"], role=role, user_info=user)
    return {
        "success": True,
        "token": token,
        "username": user["name"],
        "student_number": user.get("student_number") or user.get("employee_id") or "",
        "email": user.get("email", ""),
        "role": role,
    }


@app.get("/api/student/me")
@app.get("/api/user/me")
def api_student_me(
    month: Optional[str] = Query(None),
    session: dict = Depends(get_current_user_session),
):
    """Fetch current student details and their personal attendance records."""
    username = session["username"]
    profiles = load_user_profiles()
    clean_name = sanitize_name(username)
    profile = profiles.get(clean_name, {})

    # Pull personal attendance records from SQLite
    records = get_all_attendance_records(name=clean_name, month=month)

    return {
        "success": True,
        "name": username,
        "student_number": profile.get("student_number") or profile.get("employee_id") or "",
        "email": profile.get("email", ""),
        "role": session.get("role", "student"),
        "profile": {k: v for k, v in profile.items() if k not in ("password_hash", "salt")},
        "attendance": records,
    }


@app.get("/api/download/student-app.apk")
def download_student_apk():
    """Serve the compiled Android APK for student direct installation."""
    downloads_dir = os.path.join(BASE_DIR, "downloads")
    os.makedirs(downloads_dir, exist_ok=True)
    apk_path = os.path.join(downloads_dir, "MG-Attendance-Student.apk")

    mobile_apk = os.path.abspath(os.path.join(BASE_DIR, "..", "mobile", "MG-Attendance-Student.apk"))
    if os.path.isfile(mobile_apk):
        apk_path = mobile_apk

    if not os.path.isfile(apk_path):
        return HTMLResponse(
            status_code=200,
            content="""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MG Attendance - Student App</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; box-sizing: border-box; text-align: center; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 32px 24px; max-width: 440px; width: 100%; box-shadow: 0 16px 32px rgba(0,0,0,0.6); }
    .badge { display: inline-block; background: rgba(37,99,235,0.15); color: #3b82f6; border: 1px solid rgba(37,99,235,0.3); border-radius: 999px; font-size: 11px; font-weight: 700; padding: 4px 12px; margin-bottom: 16px; letter-spacing: 0.5px; }
    h1 { font-size: 20px; margin: 0 0 10px; font-weight: 700; color: #f4f4f5; }
    p { font-size: 13px; color: #a1a1aa; line-height: 1.5; margin: 0 0 20px; }
    .box { background: #121215; border: 1px solid #27272a; border-radius: 10px; padding: 14px; text-align: left; margin-bottom: 12px; font-size: 13px; color: #d4d4d8; line-height: 1.5; }
    .box strong { color: #ffffff; }
    code { background: #27272a; padding: 2px 6px; border-radius: 4px; font-size: 12px; font-family: monospace; color: #93c5fd; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">STUDENT MOBILE APP</div>
    <h1>Direct APK Download</h1>
    <p>The standalone Android package (.apk) file is ready to be compiled or placed in <code>backend/downloads/MG-Attendance-Student.apk</code>.</p>
    <div class="box">
      <strong>⚡ Instant Testing on Your Phone:</strong><br/>
      1. On PC, run: <code>cd mobile && npx expo start</code><br/>
      2. Open <strong>Expo Go</strong> on your phone and scan the QR code.<br/>
      3. The app opens immediately with full native features!
    </div>
  </div>
</body>
</html>""",
        )

    return FileResponse(
        path=apk_path,
        filename="MG-Attendance-Student.apk",
        media_type="application/vnd.android.package-archive",
    )


@app.get("/api/auth/verify")
def api_verify_auth(session: dict = Depends(get_current_user_session)):
    return {
        "authenticated": True,
        "username": session["username"],
        "role": session.get("role", "admin"),
        "user_info": session.get("user_info", {}),
    }


@app.post("/api/auth/logout")
def api_logout(authorization: Optional[str] = Header(None)):
    if authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            revoke_admin_token(parts[1])
    return {"success": True}


@app.post("/api/auth/change-password")
def api_change_password(payload: ChangePasswordRequest, admin_user: str = Depends(get_current_admin)):
    if not verify_admin_credentials(admin_user, payload.current_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    if not payload.new_password or len(payload.new_password.strip()) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters.")
    new_user = payload.new_username.strip() if payload.new_username else admin_user
    update_admin_credentials(new_user, payload.new_password.strip())
    new_token = create_admin_token(new_user)
    return {
        "success": True,
        "username": new_user,
        "token": new_token,
        "message": "Credentials updated successfully.",
    }


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
        timestamp, status = manual_time_event(payload.name, payload.event_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "success": True,
        "name": payload.name,
        "type": payload.event_type,
        "timestamp": timestamp,
        "status": status,
    }


@app.get("/api/attendance")
def api_attendance():
    """Raw attendance records from SQLite database."""
    return {"records": get_all_attendance_records()}


@app.get("/api/analytics/summary")
def api_analytics_summary(
    period: str = Query("month", description="'month' or 'week'"),
    value: Optional[str] = Query(None, description="Month 'YYYY-MM' or date 'YYYY-MM-DD'")
):
    """Return aggregated analytics data for month or week, including daily heatmap density,
    top 15 logins, top 15 low logins (vs all registered users), top 15 lates, and punctuality stats."""
    import calendar
    from datetime import datetime, timedelta, date as dt_date
    from src.db import load_user_profiles

    users = load_user_profiles()
    registered_names = sorted(list(users.keys()))
    registered_count = len(registered_names)

    now = get_pht_now()
    if period == "week":
        # Determine week start (Monday) and end (Sunday)
        if value and "-W" in value:
            year, week_num = value.split("-W")
            first_day_of_year = dt_date(int(year), 1, 4)
            start_date = first_day_of_year + timedelta(weeks=int(week_num) - 1)
            start_date = start_date - timedelta(days=start_date.weekday())
        elif value and len(value) == 10:
            pivot = datetime.strptime(value, "%Y-%m-%d").date()
            start_date = pivot - timedelta(days=pivot.weekday())
        else:
            pivot = now.date()
            start_date = pivot - timedelta(days=pivot.weekday())
        end_date = start_date + timedelta(days=6)
        date_range = [start_date + timedelta(days=i) for i in range(7)]
        filter_label = f"Week of {start_date.strftime('%b %d, %Y')} – {end_date.strftime('%b %d, %Y')}"
    else:
        # Month period
        if not value or len(value) < 7:
            month_str = now.strftime("%Y-%m")
        else:
            month_str = value[:7]
        y, m = map(int, month_str.split("-"))
        _, last_day = calendar.monthrange(y, m)
        start_date = dt_date(y, m, 1)
        end_date = dt_date(y, m, last_day)
        date_range = [dt_date(y, m, d) for d in range(1, last_day + 1)]
        filter_label = start_date.strftime("%B %Y")

    all_records = get_all_attendance_records()
    records_in_range = []
    for r in all_records:
        rec_date_str = r["timestamp"].split(" ")[0]
        try:
            rec_date = datetime.strptime(rec_date_str, "%Y-%m-%d").date()
            if start_date <= rec_date <= end_date:
                records_in_range.append(r)
        except Exception:
            continue

    # 1. Daily Heatmap density
    in_records = [r for r in records_in_range if r.get("type") == "IN"]
    daily_map: Dict[str, List[Dict[str, Any]]] = {}
    for r in in_records:
        d_str = r["timestamp"].split(" ")[0]
        daily_map.setdefault(d_str, []).append(r)

    heatmap_days = []
    total_clean_all = 0
    total_late_all = 0

    for d in date_range:
        d_str = d.strftime("%Y-%m-%d")
        day_recs = daily_map.get(d_str, [])
        unique_users = set(r["name"] for r in day_recs)
        clean_count = sum(1 for r in day_recs if r.get("status") == "ON_TIME")
        late_count = sum(1 for r in day_recs if r.get("status") == "LATE")
        total_clean_all += clean_count
        total_late_all += late_count

        attendee_count = len(unique_users)
        rate = round((attendee_count / registered_count * 100), 1) if registered_count > 0 else 0.0

        heatmap_days.append({
            "date": d_str,
            "day": d.day,
            "weekday": d.strftime("%a"),
            "weekday_num": d.weekday(),
            "attendees_count": attendee_count,
            "clean_count": clean_count,
            "late_count": late_count,
            "attendance_rate": rate,
            "attendee_names": sorted(list(unique_users)),
        })

    # 2. User aggregations for rankings
    user_logins: Dict[str, int] = {u: 0 for u in registered_names}
    user_lates: Dict[str, int] = {u: 0 for u in registered_names}
    user_clean: Dict[str, int] = {u: 0 for u in registered_names}

    for r in in_records:
        uname = r["name"]
        user_logins[uname] = user_logins.get(uname, 0) + 1
        if r.get("status") == "LATE":
            user_lates[uname] = user_lates.get(uname, 0) + 1
        else:
            user_clean[uname] = user_clean.get(uname, 0) + 1

    # Top 15 users with most logins
    top_most_logins = [
        {
            "name": u,
            "count": user_logins.get(u, 0),
            "lates": user_lates.get(u, 0),
            "clean": user_clean.get(u, 0),
        }
        for u in sorted(user_logins.keys(), key=lambda x: (-user_logins.get(x, 0), x))
    ][:15]

    # Top 15 users with lowest logins (includes 0-login registered users)
    top_lowest_logins = [
        {
            "name": u,
            "count": user_logins.get(u, 0),
            "lates": user_lates.get(u, 0),
            "clean": user_clean.get(u, 0),
        }
        for u in sorted(user_logins.keys(), key=lambda x: (user_logins.get(x, 0), x))
    ][:15]

    # Top 15 users with most lates
    top_most_lates = [
        {
            "name": u,
            "lates": user_lates.get(u, 0),
            "clean": user_clean.get(u, 0),
            "total": user_logins.get(u, 0),
        }
        for u in sorted(user_lates.keys(), key=lambda x: (-user_lates.get(x, 0), -user_logins.get(x, 0), x))
        if user_lates.get(u, 0) > 0
    ][:15]

    total_sessions = len(in_records)
    unique_active = len(set(r["name"] for r in in_records))
    active_days = [d for d in heatmap_days if d["attendees_count"] > 0]
    avg_daily_rate = round(sum(d["attendance_rate"] for d in active_days) / len(active_days), 1) if active_days else 0.0
    punctuality_rate = round((total_clean_all / total_sessions * 100), 1) if total_sessions > 0 else 100.0

    return {
        "period": period,
        "filter_label": filter_label,
        "start_date": start_date.strftime("%Y-%m-%d"),
        "end_date": end_date.strftime("%Y-%m-%d"),
        "registered_count": registered_count,
        "total_sessions": total_sessions,
        "unique_active": unique_active,
        "total_clean": total_clean_all,
        "total_late": total_late_all,
        "punctuality_rate": punctuality_rate,
        "avg_daily_rate": avg_daily_rate,
        "heatmap": heatmap_days,
        "top_most_logins": top_most_logins,
        "top_lowest_logins": top_lowest_logins,
        "top_most_lates": top_most_lates,
    }


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


class ScheduleSettingRequest(BaseModel):
    enabled: bool


def _schedule_setting_response() -> dict:
    enabled = is_schedule_enabled()
    with state.lock:
        closed = state.schedule_closed
        message = state.schedule_message
    return {
        "enabled": enabled,
        "schedule_closed": closed if enabled else False,
        "schedule_message": message if enabled else None,
    }


@app.get("/api/settings/schedule")
def api_get_schedule_setting():
    """Current state of the attendance-schedule master switch. Unauthenticated
    so the kiosk display can show why it is running outside the usual hours."""
    return _schedule_setting_response()


@app.post("/api/settings/schedule")
async def api_set_schedule_setting(
    payload: ScheduleSettingRequest,
    admin_user: str = Depends(get_current_admin),
):
    """Turn every time-of-day rule on or off: the camera's operating hours,
    the 6:30 AM / 8:00 AM check-in cutoffs and the Sunday closure. With it
    off the kiosk scans around the clock and no check-in is refused for
    being outside the schedule (arrivals from 5:15 AM on are still marked
    late). The choice survives restarts."""
    set_schedule_enabled(payload.enabled)
    logger.info(
        "Attendance schedule %s by admin '%s'.",
        "enabled" if payload.enabled else "disabled",
        admin_user,
    )

    # Re-opening is immediate for the client: camera_loop picks the flag up on
    # its next tick (~1s) and reacquires the camera, but the dashboard
    # shouldn't keep showing a "closed" banner while that happens.
    if not payload.enabled:
        with state.lock:
            if state.schedule_closed:
                state.schedule_closed = False
                state.schedule_message = None
                state.camera_error = None

    return _schedule_setting_response()


# Serve the built React app. Falls back to a helpful message if the
# frontend hasn't been built yet (npm run build in frontend/), so the
# backend still starts standalone during development.
if os.path.isdir(FRONTEND_DIST):
    assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="static_assets")

    @app.get("/{full_path:path}")
    async def serve_spa_app(full_path: str):
        """Catch-all route that serves index.html for SPA routes like /kiosk, /dtr, etc."""
        # 1. Exact static file inside dist/ (e.g. favicon.ico, logo.png)
        target_path = os.path.join(FRONTEND_DIST, full_path)
        if full_path and os.path.isfile(target_path):
            return FileResponse(target_path)

        # 2. SPA fallback to index.html
        index_path = os.path.join(FRONTEND_DIST, "index.html")
        if os.path.isfile(index_path):
            return FileResponse(index_path)

        raise HTTPException(status_code=404, detail="Page not found")
else:
    @app.get("/")
    def frontend_not_built():
        return {
            "detail": (
                "Frontend not built yet. Run `npm run build` in frontend/ for production, "
                "or `npm run dev` there for local development (it proxies /api and /ws here)."
            )
        }
