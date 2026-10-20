"""
lighting.py — low-light / backlight correction for face crops.

Dim rooms and bright windows behind the subject leave the face itself very
dark. Both models suffer: ArcFace embeddings of a near-black face land far
from the person's own (well-lit) registration templates, so they come back
"Unknown", and MiniFASNet reads the dark, noisy, low-contrast skin as a
screen and flags a real person as a spoof.

Measured on this kiosk's own saved snapshots (data/unknown_logs): six dark
scans of a registered person (face brightness ~7-9 of 255) were 0.78-0.87
cosine distance from their templates (rejected); after this correction they
were 0.37-0.47 (accepted), while unrelated faces stayed above 0.73.

The correction only runs when the *face* region is dark, so well-lit faces
are passed through untouched and their behaviour does not change. A phone
held up as a presentation attack is self-lit, so its face region is bright
and it is never "helped" by this.
"""

import cv2
import numpy as np

# Mean face brightness (0-255) below which the correction is applied.
LOW_LIGHT_BRIGHTNESS = 60.0
# Brightness the gamma lift aims for (roughly a normally-lit face).
TARGET_BRIGHTNESS = 110.0
MAX_GAMMA = 3.0

_clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))


def face_brightness(image_bgr, face_box=None):
    """Mean luminance of the face (or the whole image if no box is given).

    Measuring the face rather than the whole crop matters for backlight: a
    bright window around a dark face would otherwise average out to
    "normal" and skip the correction.
    """
    if image_bgr is None or image_bgr.size == 0:
        return 0.0
    region = image_bgr
    if face_box is not None:
        h_img, w_img = image_bgr.shape[:2]
        x, y, w, h = [int(v) for v in face_box]
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(w_img, x + w), min(h_img, y + h)
        if x1 > x0 and y1 > y0:
            region = image_bgr[y0:y1, x0:x1]
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    return float(gray.mean())


def is_low_light(image_bgr, face_box=None):
    return face_brightness(image_bgr, face_box) < LOW_LIGHT_BRIGHTNESS


def enhance_low_light(image_bgr, face_box=None):
    """Return a brightened copy if the face is dark, else the image as-is.

    Gamma-lifts the luminance channel toward TARGET_BRIGHTNESS (based on the
    face's own brightness, so backlit faces get lifted properly), then
    applies CLAHE for local contrast. Colour channels are left alone.
    """
    if image_bgr is None or image_bgr.size == 0:
        return image_bgr
    mean = face_brightness(image_bgr, face_box)
    if mean >= LOW_LIGHT_BRIGHTNESS:
        return image_bgr

    gamma = float(np.clip(
        np.log(TARGET_BRIGHTNESS / 255.0) / np.log(max(mean, 1.0) / 255.0),
        1.0, MAX_GAMMA,
    ))
    lut = np.array([((i / 255.0) ** (1.0 / gamma)) * 255.0 for i in range(256)], dtype=np.uint8)

    lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB)
    l_chan, a_chan, b_chan = cv2.split(lab)
    l_chan = _clahe.apply(cv2.LUT(l_chan, lut))
    return cv2.cvtColor(cv2.merge([l_chan, a_chan, b_chan]), cv2.COLOR_LAB2BGR)


def inner_face_box(chip_shape, padding_percentage=0.25):
    """Face box inside a chip made by utils.crop_face_with_padding().

    That crop adds ``padding_percentage`` of the face size on every side,
    so the face is the centre 1 / (1 + 2 * padding) of the chip.
    """
    h, w = chip_shape[:2]
    scale = 1.0 + 2.0 * padding_percentage
    fw, fh = int(w / scale), int(h / scale)
    return ((w - fw) // 2, (h - fh) // 2, fw, fh)
