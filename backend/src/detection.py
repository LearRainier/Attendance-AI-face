"""
detection.py — the "is this actually a face, and is it close enough?" gate.

Everything that reaches the tracker (and therefore gets scanned, matched and
logged) comes from here. Two separate problems are solved:

1. **Only faces.** The Haar frontal-face cascade this replaced is a texture
   matcher, not a face model — it fires readily on hands, collars, chair
   backs, door frames and patterned walls, and every one of those false
   positives became a real track that got queued for an ArcFace scan. This
   module runs YuNet instead: the same small CNN detector DeepFace already
   uses to locate and align both registration captures and live face chips
   (``detector_backend="yunet"`` in ``src/utils.py``), so it adds no new
   dependency and no new model download. On top of YuNet's own confidence
   score, each candidate has to pass a landmark-geometry check — five
   landmarks (both eyes, nose tip, both mouth corners) sitting inside the
   box in the right vertical order. A hand or a coat pattern doesn't have
   those, so it never becomes a track.

2. **Only faces in range.** A face's width as a fraction of the frame width
   is a direct proxy for how far away the person is, and it's independent of
   the camera's resolution. Faces outside
   ``[MIN_FACE_WIDTH_RATIO, MAX_FACE_WIDTH_RATIO]`` are returned separately
   as *out-of-range hints* — the UI can say "step closer", but they never
   enter the tracker, so people walking past in the background are not
   scanned, not recognized, and never logged to attendance.

Both gates are pure geometry on top of the detector, so they cost nothing
per frame beyond the detection that was happening anyway.
"""

import logging
import os
import threading

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Detector confidence
# ---------------------------------------------------------------------------
# YuNet emits a score per detection. Measured on this project's own data —
# the false positives the old Haar path had already snapshotted into
# data/unknown_logs/ (a lanyard, a shoulder, a bare wall) plus synthetic
# noise/stripe patterns — the two populations separate cleanly:
#
#     non-faces .................. no candidate at all, or ≤ 0.29
#     ear / profile-only view .... ~0.65
#     partially cropped face ..... ~0.81
#     frontal face ............... 0.86 – 0.92
#
# 0.75 sits in the wide gap between them. DeepFace's own default of 0.90 is
# too tight here: real frontal faces routinely score 0.86–0.90 on webcam-grade
# frames, so 0.90 makes a legitimate face flicker in and out of tracking.
DETECTION_SCORE_THRESHOLD = 0.75
NMS_THRESHOLD = 0.30
TOP_K = 50

# Frames wider than this are downscaled for detection only (boxes are scaled
# back up). 480 costs ~23ms/frame versus ~47ms at 640 and ~57ms for the Haar
# cascade this replaced — so detection got *cheaper*, not more expensive —
# while scores stay within ~0.02 of the full-resolution ones for any face big
# enough to pass the range gate below.
DETECTOR_MAX_WIDTH = 480

# ---------------------------------------------------------------------------
# Range gate — how close someone must be to be scanned at all
# ---------------------------------------------------------------------------
# Measured as detected-face width ÷ frame width, so it holds at any camera
# resolution. For a typical ~60° horizontal-FOV webcam and a ~16cm-wide head,
# ratio ≈ 0.14 / distance_in_metres, which puts the defaults at roughly:
#
#     0.16  →  ~0.9 m   (arm's length — the person actually at the kiosk)
#     0.80  →  ~0.2 m   (face pressed against the lens)
#
# Someone standing 2 m back lands near 0.07 and is ignored. Raise
# MIN_FACE_WIDTH_RATIO to demand people stand closer, lower it to reach
# further into the room.
#
# This is a policy limit, not a detector limit — YuNet still finds faces well
# below it (it scores a 40px face at ~0.86), which is exactly why the gate has
# to be explicit: without it, everyone in the background of the room gets
# tracked, scanned and logged.
MIN_FACE_WIDTH_RATIO = 0.16
MAX_FACE_WIDTH_RATIO = 0.80

# Absolute floor, so a low-resolution frame can't satisfy the ratio gate with
# a face too small to embed usefully. Only binds on frames narrower than
# ~450px; above that MIN_FACE_WIDTH_RATIO is always the tighter constraint.
MIN_FACE_PIXELS = 72

# ---------------------------------------------------------------------------
# Shape sanity — YuNet boxes are consistently a bit taller than wide (~0.8).
# This is a loose backstop, not a tuning knob.
# ---------------------------------------------------------------------------
MIN_ASPECT_RATIO = 0.55
MAX_ASPECT_RATIO = 1.60

# How far outside its own box a landmark may sit before the candidate is
# rejected as not-face-shaped, as a fraction of the box's size.
LANDMARK_MARGIN = 0.25

YUNET_WEIGHTS_FILENAME = "face_detection_yunet_2023mar.onnx"


def _build_yunet():
    """Create the ``cv2.FaceDetectorYN`` behind this module.

    Goes through DeepFace's own YuNet client first, so the weights land in
    the same ``~/.deepface/weights/`` cache the recognition path already
    populates (and get downloaded here if this is the first run). If DeepFace
    can't be imported for some reason, fall back to opening that cached file
    directly — OpenCV is what actually runs the model either way.
    """
    try:
        from deepface.models.face_detection.YuNet import YuNetClient
        return YuNetClient().model
    except Exception as e:
        logger.warning("Could not build YuNet via DeepFace (%s); trying the cached weights file.", e)

    weights_path = os.path.join(os.path.expanduser("~"), ".deepface", "weights", YUNET_WEIGHTS_FILENAME)
    if not os.path.isfile(weights_path):
        raise RuntimeError(
            f"YuNet weights not found at {weights_path} and DeepFace could not "
            "download them. Check your internet connection and restart the server."
        )
    return cv2.FaceDetectorYN_create(weights_path, "", (0, 0))


def _landmarks_plausible(box, landmarks):
    """True if the five YuNet landmarks describe a real face inside ``box``.

    Order is (right eye, left eye, nose tip, right mouth corner, left mouth
    corner). Two things have to hold: every landmark sits in (or just outside)
    the box, and they stack vertically the way a face does — eyes above nose
    above mouth. A texture that happened to score highly won't satisfy both.
    """
    x, y, w, h = box
    margin_x = LANDMARK_MARGIN * w
    margin_y = LANDMARK_MARGIN * h

    xs, ys = landmarks[:, 0], landmarks[:, 1]
    if xs.min() < x - margin_x or xs.max() > x + w + margin_x:
        return False
    if ys.min() < y - margin_y or ys.max() > y + h + margin_y:
        return False

    eye_y = float(ys[0] + ys[1]) / 2.0
    nose_y = float(ys[2])
    mouth_y = float(ys[3] + ys[4]) / 2.0

    if eye_y >= mouth_y:
        return False

    # The nose tip belongs between the two, with a little slack so a tilted
    # head isn't rejected outright.
    slack = 0.05 * h
    return (eye_y - slack) <= nose_y <= (mouth_y + slack)


class FaceDetector:
    """YuNet detection plus the face-shape and in-range gates.

    One instance is shared by the camera thread and the Register page's
    preview endpoint. ``cv2.FaceDetectorYN`` carries mutable input-size state
    (unlike the stateless Haar cascade this replaced), so ``detect()``
    serializes itself — detection is a few milliseconds, and the Register
    page pauses the camera loop anyway, so the two never really contend.
    """

    def __init__(
        self,
        score_threshold=DETECTION_SCORE_THRESHOLD,
        min_width_ratio=MIN_FACE_WIDTH_RATIO,
        max_width_ratio=MAX_FACE_WIDTH_RATIO,
        min_width_pixels=MIN_FACE_PIXELS,
    ):
        self.score_threshold = score_threshold
        self.min_width_ratio = min_width_ratio
        self.max_width_ratio = max_width_ratio
        self.min_width_pixels = min_width_pixels

        self._lock = threading.Lock()
        self._model = None
        self._input_size = None

    def warm_up(self):
        """Build (and if needed download) the model up front, so a failure
        surfaces at startup rather than as a silently empty camera feed."""
        with self._lock:
            self._ensure_model()

    def _ensure_model(self):
        """Caller must hold ``self._lock``."""
        if self._model is None:
            model = _build_yunet()
            model.setScoreThreshold(self.score_threshold)
            model.setNMSThreshold(NMS_THRESHOLD)
            model.setTopK(TOP_K)
            self._model = model
            self._input_size = None
        return self._model

    def detect(self, frame_bgr):
        """Detect faces in a BGR frame and split them by range.

        Parameters
        ----------
        frame_bgr : numpy.ndarray
            Full BGR frame.

        Returns
        -------
        tuple[list[tuple[int, int, int, int]], list[dict]]
            ``(faces, out_of_range)``. ``faces`` are in-range, face-shaped
            detections as ``(x, y, w, h)`` in frame pixels — the only thing
            that should ever be handed to the tracker. ``out_of_range`` holds
            ``{"bbox": [x, y, w, h], "reason": "too_far" | "too_close"}`` for
            real faces that failed only the distance gate, so the UI can tell
            the person to step closer instead of appearing broken.
        """
        if frame_bgr is None or frame_bgr.size == 0:
            return [], []

        height, width = frame_bgr.shape[:2]
        if width == 0 or height == 0:
            return [], []

        scale = min(1.0, DETECTOR_MAX_WIDTH / float(width))
        if scale < 1.0:
            small = cv2.resize(frame_bgr, (int(round(width * scale)), int(round(height * scale))))
        else:
            small = frame_bgr

        with self._lock:
            model = self._ensure_model()
            size = (small.shape[1], small.shape[0])
            if self._input_size != size:
                model.setInputSize(size)
                self._input_size = size
            _, raw = model.detect(small)

        if raw is None:
            return [], []

        min_width = max(self.min_width_ratio * width, self.min_width_pixels)
        max_width = self.max_width_ratio * width

        faces = []
        out_of_range = []

        for row in raw:
            # Columns 0-3 are the box, 4-13 the five landmark (x, y) pairs,
            # 14 the score — all in the (possibly downscaled) detection
            # image's space, so undo the scale before anything else.
            coords = np.asarray(row[:14], dtype=np.float64) / scale
            x, y, w, h = coords[:4]
            landmarks = coords[4:14].reshape(5, 2)

            if w <= 0 or h <= 0:
                continue
            aspect = w / h
            if aspect < MIN_ASPECT_RATIO or aspect > MAX_ASPECT_RATIO:
                continue
            if not _landmarks_plausible((x, y, w, h), landmarks):
                continue

            # Clamp into the frame — YuNet can return a box that runs a few
            # pixels past the edge for a face at the border.
            x1 = max(0, int(round(x)))
            y1 = max(0, int(round(y)))
            x2 = min(width, int(round(x + w)))
            y2 = min(height, int(round(y + h)))
            if x2 <= x1 or y2 <= y1:
                continue
            box = (x1, y1, x2 - x1, y2 - y1)

            # Range gate uses the detector's own (unclamped) width so a face
            # half out of frame isn't mistaken for a distant one.
            if w < min_width:
                out_of_range.append({"bbox": list(box), "reason": "too_far"})
                continue
            if w > max_width:
                out_of_range.append({"bbox": list(box), "reason": "too_close"})
                continue

            faces.append(box)

        return faces, out_of_range
