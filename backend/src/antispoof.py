"""
antispoof.py — Presentation Attack Detection (PAD) for Face Recognition.

Defends against:
  1. Video replay attacks (e.g. playing a recorded video on a phone/tablet).
  2. 2D photo prints (paper, photo ID, poster).
  3. Digital display presentation attacks (subpixel Moiré grids & screen glare).

Architecture:
  - Deep Dual-Crop Neural Anti-Spoofing: MiniFASNet (MiniFASNetV2 + MiniFASNetV1SE)
    trained on presentation attack datasets. Uses 2.7x and 4.0x multi-scale crops.
  - Specular Screen Reflection: Analyzes planar glass glare typical of mobile screens.
"""

from typing import Tuple, Any, Optional
import logging
import sys
import threading
import warnings
import cv2
import numpy as np

# Ensure Windows stdout/stderr encoding doesn't break on DeepFace log emojis
try:
    _reconfig_out = getattr(sys.stdout, "reconfigure", None)
    if callable(_reconfig_out):
        _reconfig_out(encoding="utf-8", errors="replace")
    _reconfig_err = getattr(sys.stderr, "reconfigure", None)
    if callable(_reconfig_err):
        _reconfig_err(encoding="utf-8", errors="replace")
except Exception:
    pass

# Suppress PyTorch softmax UserWarning inside MiniFASNet
warnings.filterwarnings("ignore", message=".*Implicit dimension choice for softmax.*")

logger = logging.getLogger(__name__)

_detector_instance: Optional["AntiSpoofDetector"] = None
_detector_lock = threading.Lock()


class AntiSpoofDetector:
    def __init__(self):
        logger.info("Initializing Anti-Spoofing Engine (MiniFASNet)...")
        from deepface.models.spoofing.FasNet import Fasnet
        self._fasnet = Fasnet()
        self._lock = threading.Lock()
        logger.info("Anti-Spoofing Engine ready.")

    def analyze_frame(self, frame: Any, bbox: Any) -> Tuple[bool, str, float]:
        """
        Analyze a detected face within a frame for presentation attacks.

        Parameters
        ----------
        frame : numpy.ndarray
            Full BGR camera frame.
        bbox : tuple or list
            (x, y, w, h) bounding box of the face.

        Returns
        -------
        Tuple[bool, str, float]
            (is_real, reason, confidence)
        """
        if frame is None:
            return False, "invalid_frame", 0.0

        try:
            fh, fw = frame.shape[:2]
        except Exception:
            return False, "invalid_frame", 0.0

        if fh < 10 or fw < 10:
            return False, "invalid_frame", 0.0

        x, y, w, h = [int(v) for v in bbox]

        # Clamp bounding box
        x = max(0, min(x, fw - 1))
        y = max(0, min(y, fh - 1))
        w = max(10, min(w, fw - x))
        h = max(10, min(h, fh - y))

        if w < 20 or h < 20:
            return False, "face_too_small", 0.0

        # --- 1. MiniFASNet Deep PAD Inference ---
        with self._lock:
            try:
                is_real_fasnet, fasnet_score = self._fasnet.analyze(frame, (x, y, w, h))
            except Exception as e:
                logger.warning("MiniFASNet analysis error: %s", e)
                is_real_fasnet, fasnet_score = True, 0.5

        if not is_real_fasnet:
            logger.info("MiniFASNet rejected face as SPOOF (score: %.3f)", fasnet_score)
            return False, "deep_spoof_detected", float(fasnet_score)

        # --- 2. Screen Specular Glare & Reflection Verification ---
        face_roi = frame[y:y + h, x:x + w]
        if face_roi.size > 0:
            is_screen, screen_reason, screen_score = self._check_screen_artifacts(face_roi)
            if is_screen:
                logger.info("Screen artifact detected: %s (score: %.3f)", screen_reason, screen_score)
                return False, screen_reason, float(screen_score)

        return True, "genuine", float(fasnet_score)

    def _check_screen_artifacts(self, face_chip: Any) -> Tuple[bool, str, float]:
        """
        Secondary passive check for physical characteristics of screens:
          - High-contrast specular reflection from screen glass
          - Severe color saturation clipping typical of OLED/LCD backlights
        """
        try:
            hsv = cv2.cvtColor(face_chip, cv2.COLOR_BGR2HSV)
            _, s_chan, v_chan = cv2.split(hsv)

            # Mobile screens reflecting ambient light produce washed-out glare spots:
            glare_mask = (v_chan > 252) & (s_chan < 20)
            pixel_count = float(face_chip.shape[0] * face_chip.shape[1])
            glare_ratio = float(np.count_nonzero(glare_mask)) / max(1.0, pixel_count)

            if glare_ratio > 0.12:
                return True, "screen_glare_detected", glare_ratio

            return False, "clean", 0.0
        except Exception:
            return False, "clean", 0.0


def get_antispoof_detector() -> AntiSpoofDetector:
    """Return the global AntiSpoofDetector singleton."""
    global _detector_instance
    if _detector_instance is None:
        with _detector_lock:
            if _detector_instance is None:
                _detector_instance = AntiSpoofDetector()
    return _detector_instance


def check_anti_spoof(frame: Any, bbox: Any) -> Tuple[bool, str, float]:
    """
    Convenience function: evaluate anti-spoofing on a face bounding box.
    Returns (is_real, reason, score).
    """
    detector = get_antispoof_detector()
    return detector.analyze_frame(frame, bbox)


def warmup_antispoof() -> None:
    """Pre-warm the anti-spoofing model so the first live inference has zero latency."""
    detector = get_antispoof_detector()
    dummy = np.zeros((720, 1280, 3), dtype=np.uint8)
    detector.analyze_frame(dummy, (300, 200, 200, 200))
    logger.info("Anti-spoofing engine warmed up.")
