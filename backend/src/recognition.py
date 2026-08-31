"""
recognition.py — DeepFace wrapper module.

Provides clean, error-handled functions for face detection and matching.
All DeepFace-specific logic is isolated here so the rest of the app
doesn't need to know about the underlying library.
"""

import logging
import os
import cv2
import numpy as np

logger = logging.getLogger(__name__)

# DeepFace import is deferred to first use so the app can start even if
# the package isn't installed yet (gives a clear error message instead of
# an opaque ImportError on startup).
_deepface = None


def _get_deepface():
    """Lazy-load DeepFace on first call."""
    global _deepface
    if _deepface is None:
        try:
            from deepface import DeepFace
            _deepface = DeepFace
        except ImportError:
            raise ImportError(
                "DeepFace is not installed. Run: pip install deepface"
            )
    return _deepface


# ---------------------------------------------------------------------------
# Configuration — tweak these to trade accuracy vs. speed
# ---------------------------------------------------------------------------
MODEL_NAME = "ArcFace"            # Options: VGG-Face, Facenet, Facenet512, ArcFace, etc.
DETECTOR_BACKEND = "opencv"       # Options: opencv, ssd, mtcnn, retinaface, yunet
DISTANCE_METRIC = "cosine"        # Options: cosine, euclidean, euclidean_l2
VERIFY_THRESHOLD = None           # None = use DeepFace's pre-tuned threshold for MODEL_NAME


def _get_verify_threshold():
    """Resolve the active match threshold: an explicit override, or DeepFace's
    own pre-tuned value for (MODEL_NAME, DISTANCE_METRIC). Deriving it instead
    of hardcoding a number keeps this correct across model swaps."""
    if VERIFY_THRESHOLD is not None:
        return VERIFY_THRESHOLD
    from deepface.modules.verification import find_threshold
    return find_threshold(MODEL_NAME, DISTANCE_METRIC)


def find_match(frame, registered_db_path, model_name=None, detector_backend=None):
    """
    Search for a matching identity in the registered faces database.

    Parameters
    ----------
    frame : np.ndarray
        BGR image (OpenCV format) from the webcam.
    registered_db_path : str
        Path to the folder whose sub-folders are person names containing
        their reference photos.
    model_name : str, optional
        Override the default model.
    detector_backend : str, optional
        Override the default face detector.

    Returns
    -------
    tuple[str, float]
        (matched_name, distance)  — name of the matched person and the
        distance score.  Returns ("Unknown", -1.0) if no match is found.
    """
    DeepFace = _get_deepface()
    _model = model_name or MODEL_NAME
    _detector = detector_backend or DETECTOR_BACKEND

    try:
        # DeepFace.find() compares the input image against every image in
        # the db_path folder tree and returns a list of DataFrames (one per
        # face detected in the input image).
        results = DeepFace.find(
            img_path=frame,
            db_path=registered_db_path,
            model_name=_model,
            detector_backend=_detector,
            distance_metric=DISTANCE_METRIC,
            enforce_detection=False,   # don't crash if no face in frame
            silent=True,
        )

        # results is a list of DataFrames.  We want the first face's best
        # match (lowest distance).
        if results and len(results) > 0:
            df = results[0]
            if not df.empty:
                # The "identity" column holds the full file path of the match
                best = df.iloc[0]
                identity_path = str(best["identity"])

                # Extract the person's name from the folder structure:
                #   data/registered_faces/<Name>/photo.jpg  →  <Name>
                rel = os.path.relpath(identity_path, registered_db_path)
                person_name = rel.split(os.sep)[0]

                # Get distance value
                dist_col = [c for c in df.columns if "distance" in c.lower()]
                distance = float(best[dist_col[0]]) if dist_col else -1.0

                return person_name, distance

    except ValueError as e:
        # DeepFace raises ValueError when it can't detect a face
        if "Face could not be detected" in str(e):
            return "No Face Detected", -1.0
        # Re-raise unexpected ValueErrors
        raise
    except Exception as e:
        # Log but don't crash — the camera loop must keep running
        logger.warning("Recognition error: %s", e)
        return "Error", -1.0

    return "Unknown", -1.0


def extract_face(frame, detector_backend=None):
    """
    Detect and extract the largest face region from a frame.

    Parameters
    ----------
    frame : np.ndarray
        BGR image (OpenCV format).
    detector_backend : str, optional
        Override the default detector.

    Returns
    -------
    np.ndarray or None
        Cropped face image, or None if no face was found.
    """
    DeepFace = _get_deepface()
    _detector = detector_backend or DETECTOR_BACKEND

    try:
        faces = DeepFace.extract_faces(
            img_path=frame,
            detector_backend=_detector,
            enforce_detection=False,
        )
        if faces:
            # Return the first (largest-confidence) face
            face_obj = faces[0]
            facial_area = face_obj.get("facial_area", {})
            x = facial_area.get("x", 0)
            y = facial_area.get("y", 0)
            w = facial_area.get("w", frame.shape[1])
            h = facial_area.get("h", frame.shape[0])

            # Clamp to frame bounds
            x = max(0, x)
            y = max(0, y)
            w = min(w, frame.shape[1] - x)
            h = min(h, frame.shape[0] - y)

            if w > 0 and h > 0:
                return frame[y:y + h, x:x + w]

    except Exception as e:
        logger.warning("Face extraction error: %s", e)

    return None


def verify_pair(img1, img2, model_name=None, detector_backend=None):
    """
    Verify whether two images contain the same person.

    Returns
    -------
    tuple[bool, float]
        (is_same_person, distance)
    """
    DeepFace = _get_deepface()
    _model = model_name or MODEL_NAME
    _detector = detector_backend or DETECTOR_BACKEND

    try:
        result = DeepFace.verify(
            img1_path=img1,
            img2_path=img2,
            model_name=_model,
            detector_backend=_detector,
            distance_metric=DISTANCE_METRIC,
            enforce_detection=False,
        )
        return result.get("verified", False), result.get("distance", -1.0)
    except Exception as e:
        logger.warning("Verification error: %s", e)
        return False, -1.0


def get_embedding(image_bgr, detector_backend=None, enforce_detection=False):
    """
    Extract a single face embedding vector from a BGR image using MODEL_NAME.

    Parameters
    ----------
    image_bgr : np.ndarray
        BGR image, ideally already a face chip (use detector_backend="skip"
        for pre-cropped chips).
    detector_backend : str, optional
        Override the default detector. Use "skip" for pre-cropped chips,
        or a real detector (e.g. "yunet") to both find and align a face
        in a full frame.
    enforce_detection : bool
        If True, raises when no face is found instead of returning None.
        Live-loop callers should leave this False; registration should
        set it True so a bad capture is rejected instead of silently saved.

    Returns
    -------
    list[float] or None
        The embedding vector, or None if no face was found.
    """
    DeepFace = _get_deepface()
    _detector = detector_backend or DETECTOR_BACKEND

    res = DeepFace.represent(
        img_path=image_bgr,
        model_name=MODEL_NAME,
        detector_backend=_detector,
        enforce_detection=enforce_detection,
    )
    if not res or len(res) == 0:
        return None
    return res[0].get("embedding")


def build_match_index(registered_embeddings):
    """
    Build a fast lookup structure from {name: [vector, ...]} for matching.

    Every row is L2-normalized once here so that at match time a cosine
    distance is just ``1 - dot(query, row)`` instead of a full norm
    computation per comparison — turns the whole registered database into
    a single matrix multiply per incoming face instead of a Python loop
    over every stored vector.

    Parameters
    ----------
    registered_embeddings : dict[str, list[list[float]]]
        Output of :func:`load_registered_faces` in ``src/utils.py``.

    Returns
    -------
    tuple[list[str], np.ndarray]
        ``(names, matrix)`` where ``matrix`` has shape ``(N, dim)`` and
        ``names[i]`` is the person the i-th row belongs to. Empty
        ``([], np.zeros((0, 0)))`` if there's nothing to index.
    """
    names = []
    rows = []

    for name, vectors in registered_embeddings.items():
        for vec in vectors:
            arr = np.asarray(vec, dtype=np.float64)
            norm = np.linalg.norm(arr)
            if norm == 0:
                continue
            rows.append(arr / norm)
            names.append(name)

    if not rows:
        return [], np.zeros((0, 0))

    return names, np.vstack(rows)


def find_embedding_match_indexed(query_vector, names, matrix, threshold=None):
    """
    Match a query embedding against a prebuilt (names, matrix) index
    from :func:`build_match_index`.

    Parameters
    ----------
    query_vector : list[float] or np.ndarray
        Embedding for the live face chip.
    names : list[str]
        Parallel to ``matrix`` rows.
    matrix : np.ndarray
        L2-normalized embedding matrix, shape (N, dim).
    threshold : float, optional
        Override the resolved verify threshold for this call.

    Returns
    -------
    tuple[str, float]
        (name, distance). ("Unknown", distance) if nothing is close enough,
        ("Unknown", 1.0) if the index is empty or the query has zero norm.
    """
    if not names or matrix.size == 0:
        return "Unknown", 1.0

    query_arr = np.asarray(query_vector, dtype=np.float64)
    norm = np.linalg.norm(query_arr)
    if norm == 0:
        return "Unknown", 1.0
    query_norm = query_arr / norm

    if matrix.shape[1] != query_norm.shape[0]:
        logger.warning(
            "Embedding dimension mismatch: index has %d-d rows but query is "
            "%d-d. Re-register faces after a MODEL_NAME change.",
            matrix.shape[1], query_norm.shape[0],
        )
        return "Unknown", 1.0

    _threshold = threshold if threshold is not None else _get_verify_threshold()

    # Rows are pre-normalized, so this dot product IS the cosine similarity.
    similarities = matrix @ query_norm
    best_idx = int(np.argmax(similarities))
    best_dist = 1.0 - float(similarities[best_idx])

    if best_dist < _threshold:
        return names[best_idx], best_dist
    return "Unknown", best_dist
