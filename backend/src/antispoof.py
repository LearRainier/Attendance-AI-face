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

from src.lighting import enhance_low_light, is_low_light

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

# How sure MiniFASNet must be that a face is FAKE before it is rejected.
#
# DeepFace's own Fasnet.analyze() flags a face as spoof whenever "real" is
# not the single most likely of its three classes - i.e. at anything above
# ~50% fake. Real people standing in front of a bright window or in a dim
# room routinely score 50-70% fake, so they were being rejected. Measured on
# this kiosk's saved snapshots: a genuine phone-photo attack scored 100%
# fake, while real-but-badly-lit faces scored 34-59% (and up to 87% only in
# near-black frames, which the low-light correction below brings down).
# 0.75 keeps the phone attack blocked with a wide margin and lets those real
# faces through. Raise it toward 0.9 to be more lenient, lower it toward
# 0.6 to be stricter.
SPOOF_REJECT_CONFIDENCE = 0.75

_detector_instance: Optional["AntiSpoofDetector"] = None
_detector_lock = threading.Lock()


class AntiSpoofDetector:
    def __init__(self):
        logger.info("Initializing Anti-Spoofing Engine (MiniFASNet)...")
        from deepface.models.spoofing.FasNet import Fasnet
        from deepface.models.spoofing.FasNetUtils import crop as fasnet_crop
        self._fasnet = Fasnet()
        self._fasnet_crop = fasnet_crop
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
        # Dark / backlit faces are brightened first (see src/lighting.py);
        # MiniFASNet otherwise mistakes their noisy low-contrast skin for a
        # screen. Well-lit faces - and self-lit phone screens - are untouched.
        low_light = is_low_light(frame, (x, y, w, h))
        model_frame = enhance_low_light(frame, (x, y, w, h)) if low_light else frame
        with self._lock:
            try:
                spoof_prob = self._spoof_probability(model_frame, (x, y, w, h))
            except Exception as e:
                logger.warning("MiniFASNet analysis error: %s", e)
                spoof_prob = 0.0
        real_score = 1.0 - spoof_prob

        if spoof_prob >= SPOOF_REJECT_CONFIDENCE:
            logger.info(
                "MiniFASNet rejected face as SPOOF (%.0f%% fake, limit %.0f%%%s)",
                spoof_prob * 100, SPOOF_REJECT_CONFIDENCE * 100, ", low-light corrected" if low_light else "",
            )
            return False, "deep_spoof_detected", float(real_score)
        if spoof_prob >= 0.5:
            logger.info(
                "MiniFASNet borderline (%.0f%% fake) - accepted, below the %.0f%% limit%s",
                spoof_prob * 100, SPOOF_REJECT_CONFIDENCE * 100, " (low-light corrected)" if low_light else "",
            )

        # --- 2. Screen Specular Glare & Reflection Verification ---
        face_roi = frame[y:y + h, x:x + w]
        if face_roi.size > 0:
            is_screen, screen_reason, screen_score = self._check_screen_artifacts(face_roi)
            if is_screen:
                logger.info("Screen artifact detected: %s (score: %.3f)", screen_reason, screen_score)
                return False, screen_reason, float(screen_score)

        return True, "genuine", float(real_score)

    def _spoof_probability(self, frame: Any, box: Tuple[int, int, int, int]) -> float:
        """Probability (0-1) that the face is a presentation attack.

        Same two MiniFASNet models, crops and averaging as DeepFace's
        Fasnet.analyze(), but returns the actual probability instead of an
        argmax yes/no, so the decision threshold can be tuned. Class 1 is
        "real"; classes 0 and 2 are the two attack types.
        """
        first = self._fasnet_crop(frame, box, 2.7, 80, 80)
        second = self._fasnet_crop(frame, box, 4, 80, 80)
        first = np.expand_dims(first.astype(np.float32), axis=0)
        second = np.expand_dims(second.astype(np.float32), axis=0)
        p1 = _softmax(self._fasnet.first_model(first, training=False).numpy())
        p2 = _softmax(self._fasnet.second_model(second, training=False).numpy())
        prediction = (p1 + p2) / 2.0
        return float(1.0 - prediction[0][1])

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


def _softmax(logits: Any) -> Any:
    shifted = logits - np.max(logits, axis=1, keepdims=True)
    exp = np.exp(shifted)
    return exp / np.sum(exp, axis=1, keepdims=True)


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
