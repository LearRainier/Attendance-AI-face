"""
utils.py — Utility functions used by server.py.

Provides:
    - load_registered_faces()    — scan the registered_faces directory for JSON embeddings
    - register_face_embedding()  — detect+align+embed a captured image and save it as a new template
    - verify_face_roi()          — compare a cropped face ROI against a prebuilt match index
    - log_attendance()           — write to attendance.csv with deduplication
"""

import logging
import os
import csv
import json
from datetime import datetime

from src.recognition import (
    find_match,
    get_embedding,
    build_match_index,
    find_embedding_match_indexed,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths (relative to the project root)
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTERED_FACES_DIR = os.path.join(BASE_DIR, "data", "registered_faces")
UNKNOWN_LOGS_DIR = os.path.join(BASE_DIR, "data", "unknown_logs")
ATTENDANCE_CSV = os.path.join(BASE_DIR, "data", "attendance.csv")
USERS_JSON = os.path.join(BASE_DIR, "data", "users.json")
SETTINGS_JSON = os.path.join(BASE_DIR, "data", "settings.json")

# Deduplication: don't log the same track_id again within this cooldown (seconds).
# Each new track ID (assigned when a face re-enters the frame) is treated as a
# fresh visit, so leaving and returning will always create a new log entry.
DEDUP_TRACK_COOLDOWN_SECONDS = 10

# Also dedup per person name: brief tracking dropouts (head turn, occlusion)
# spawn a new track_id for the same person, which would otherwise log a
# duplicate row seconds after the first one.
DEDUP_NAME_COOLDOWN_SECONDS = 60

# In-memory caches of last successful log times
_logged_tracks = {}  # {track_id: datetime}
_logged_names = {}   # {name: datetime}


def sanitize_name(person_name):
    """Strip characters invalid in Windows folder names, plus trailing
    dots/spaces (also invalid on Windows). Shared by face registration and
    user-profile storage so a person's face folder and profile record key
    on the same sanitized name."""
    return "".join(c for c in person_name if c not in '<>:"/\\|?*').strip(". ")


def load_registered_faces(expected_dim=None):
    """
    Scan ``data/registered_faces/`` and return a dict mapping each person's
    name to a list of their loaded embedding vectors (list of float).

    Expected folder layout::

        data/registered_faces/
            Alice/
                embedding_001.json
            Bob/
                embedding_001.json

    Parameters
    ----------
    expected_dim : int, optional
        If given, embeddings whose vector length doesn't match are skipped
        with a warning instead of being loaded — guards against stale
        embeddings saved under a previous MODEL_NAME (e.g. leftover
        VGG-Face vectors after switching to ArcFace).

    Returns
    -------
    dict[str, list[list[float]]]
        ``{"Alice": [[0.1, 0.2, ...], ...], ...}``
        Returns an empty dict if the directory doesn't exist or is empty.
    """
    registered = {}

    if not os.path.isdir(REGISTERED_FACES_DIR):
        logger.warning("Directory not found: %s", REGISTERED_FACES_DIR)
        os.makedirs(REGISTERED_FACES_DIR, exist_ok=True)
        return registered

    for person_name in sorted(os.listdir(REGISTERED_FACES_DIR)):
        person_dir = os.path.join(REGISTERED_FACES_DIR, person_name)
        if not os.path.isdir(person_dir):
            continue  # skip stray files at the top level

        embeddings = []
        for filename in os.listdir(person_dir):
            if os.path.splitext(filename)[1].lower() != ".json":
                continue

            filepath = os.path.join(person_dir, filename)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as e:
                logger.warning("Error loading embedding file %s: %s", filename, e)
                continue

            if not isinstance(data, list) or len(data) == 0:
                continue

            if expected_dim is not None and len(data) != expected_dim:
                logger.warning(
                    "Skipping '%s' for '%s': %d-d vector doesn't match the "
                    "current model's %d-d output. Re-register this person.",
                    filename, person_name, len(data), expected_dim,
                )
                continue

            embeddings.append(data)

        if embeddings:
            registered[person_name] = embeddings
            logger.info("Loaded %d profile template(s) for '%s'", len(embeddings), person_name)
        else:
            logger.warning("No valid templates in '%s'", person_dir)

    return registered


def register_face_embedding(person_name, image_bgr, detector_backend="yunet"):
    """
    Detect, align, and embed a face from a captured image, then save it as
    a new template under ``data/registered_faces/<person_name>/``.

    This passes the raw captured frame straight to a real detector (rather
    than a pre-cropped chip) so the face is both located and aligned.
    ``verify_face_roi`` uses the same detector backend on its (already
    cropped) chip for the live match, so both sides of a comparison are
    aligned consistently.

    Parameters
    ----------
    person_name : str
        Raw name as entered by the user; sanitized for the filesystem here.
    image_bgr : numpy.ndarray
        Full BGR image containing the face to register (not pre-cropped).
    detector_backend : str
        DeepFace detector backend to use. Defaults to "yunet", which needs
        no extra pip package (unlike "retinaface"/"mtcnn") and still does
        real landmark-based alignment.

    Returns
    -------
    tuple[str, int]
        (sanitized_person_name, total_template_count_for_this_person)

    Raises
    ------
    ValueError
        If the name is empty after sanitization, or no face could be
        detected in the image.
    """
    clean_name = sanitize_name(person_name)
    if not clean_name:
        raise ValueError("Name cannot be empty (or contained only invalid characters).")

    try:
        embedding = get_embedding(image_bgr, detector_backend=detector_backend, enforce_detection=True)
    except ValueError:
        embedding = None

    if embedding is None:
        raise ValueError("No face could be detected in the captured image.")

    # Directory is created lazily so a failed capture doesn't leave an
    # empty ghost profile behind.
    person_dir = os.path.join(REGISTERED_FACES_DIR, clean_name)
    os.makedirs(person_dir, exist_ok=True)

    photo_index = 1
    while os.path.exists(os.path.join(person_dir, f"embedding_{photo_index:03d}.json")):
        photo_index += 1
    filepath = os.path.join(person_dir, f"embedding_{photo_index:03d}.json")

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(embedding, f)

    template_count = sum(1 for fn in os.listdir(person_dir) if fn.lower().endswith(".json"))
    return clean_name, template_count


def load_settings():
    """Load ``data/settings.json`` — preferences the user changes from the UI
    at runtime (currently just ``camera_index``) that should survive a
    restart. Returns an empty dict if the file doesn't exist yet or is
    corrupt, so callers always fall back to the code defaults."""
    if not os.path.isfile(SETTINGS_JSON):
        return {}
    try:
        with open(SETTINGS_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception as e:
        logger.warning("Error loading %s: %s", SETTINGS_JSON, e)
        return {}


def save_settings(updates):
    """Merge ``updates`` into ``data/settings.json`` and return the full
    saved dict. Merges rather than overwrites so one setting's endpoint
    can't wipe another's."""
    settings = load_settings()
    settings.update(updates)
    os.makedirs(os.path.dirname(SETTINGS_JSON), exist_ok=True)
    with open(SETTINGS_JSON, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)
    return settings


PROFILE_FIELDS = ("email", "phone", "department", "position", "employee_id", "notes")


def load_user_profiles():
    """Load ``data/users.json`` — personal-detail records keyed by sanitized
    name. Returns an empty dict if the file doesn't exist yet or is corrupt."""
    if not os.path.isfile(USERS_JSON):
        return {}
    try:
        with open(USERS_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception as e:
        logger.warning("Error loading %s: %s", USERS_JSON, e)
        return {}


def save_user_profile(name, fields):
    """Create or update the personal-detail record for ``name``. Unknown
    keys in ``fields`` are ignored; missing ones keep their previous value.

    Returns the saved profile dict.
    """
    clean_name = sanitize_name(name)
    if not clean_name:
        raise ValueError("Name cannot be empty (or contained only invalid characters).")

    profiles = load_user_profiles()
    profile = dict(profiles.get(clean_name, {}))
    for key in PROFILE_FIELDS:
        if key in fields:
            profile[key] = fields[key]
    profile["name"] = clean_name
    profile["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    profiles[clean_name] = profile

    os.makedirs(os.path.dirname(USERS_JSON), exist_ok=True)
    with open(USERS_JSON, "w", encoding="utf-8") as f:
        json.dump(profiles, f, indent=2)

    return profile


def ensure_user_profile_stub(name):
    """Create an empty personal-detail record for ``name`` if none exists yet.

    Called after every face registration (and at reload, for anyone already
    sitting in ``registered_faces/`` without one) so a registered face and a
    ``users.json`` record can't drift apart — before this, registering a face
    from the Register page never touched ``users.json`` at all, so anyone
    enrolled that way was invisible to anything that only read the profile
    store, and looked "unsynced" on the Users page.

    Deliberately leaves ``updated_at`` as ``None`` rather than stamping it:
    that field means "someone filled in personal details," and a stub with
    nothing but a name shouldn't count towards that.  No-op if a profile
    already exists — never overwrites real data.
    """
    clean_name = sanitize_name(name)
    if not clean_name:
        return

    profiles = load_user_profiles()
    if clean_name in profiles:
        return

    profiles[clean_name] = {
        "name": clean_name,
        "email": "",
        "phone": "",
        "department": "",
        "position": "",
        "employee_id": "",
        "notes": "",
        "updated_at": None,
    }
    os.makedirs(os.path.dirname(USERS_JSON), exist_ok=True)
    with open(USERS_JSON, "w", encoding="utf-8") as f:
        json.dump(profiles, f, indent=2)


def delete_user_profile(name):
    """Remove the personal-detail record for ``name`` (does not touch their
    face embeddings). Returns True if a record was actually removed."""
    clean_name = sanitize_name(name)
    profiles = load_user_profiles()
    if clean_name not in profiles:
        return False
    del profiles[clean_name]
    with open(USERS_JSON, "w", encoding="utf-8") as f:
        json.dump(profiles, f, indent=2)
    return True


def verify_face(frame, registered_faces):
    """
    Compare the current webcam frame against all registered faces using
    the disk-scanning ``DeepFace.find()`` path. Not used by the live
    recognition loop (see :func:`verify_face_roi`); kept for standalone use.
    """
    if not registered_faces:
        return "No Registered Faces"

    name, distance = find_match(frame, REGISTERED_FACES_DIR)
    return name


def verify_face_roi(face_img, match_index):
    """
    Compare a cropped face region against a prebuilt in-memory match index.

    Parameters
    ----------
    face_img : numpy.ndarray
        BGR image containing only the face region.
    match_index : tuple[list[str], numpy.ndarray]
        Output of :func:`src.recognition.build_match_index` — precomputed
        once at load time (and after each new registration) rather than
        rebuilt on every recognition call.

    Returns
    -------
    tuple[str, float]
        (name, distance)
    """
    names, matrix = match_index
    if not names:
        return "No Registered Faces", -1.0

    try:
        # Re-detect+align with the same "yunet" backend used at registration
        # instead of "skip". ArcFace-style embeddings are sensitive to
        # alignment, so comparing an aligned registration template against
        # an unaligned (raw detector-crop) query systematically inflates the
        # distance — confirmed live: a just-registered person came back
        # "Unknown" under "skip" and matched correctly under "yunet". The
        # extra detection pass is cheap here since recognition already runs
        # in a low-rate background worker, not per frame.
        query_vector = get_embedding(face_img, detector_backend="yunet", enforce_detection=False)
    except Exception as e:
        logger.warning("Embedding extraction error: %s", e)
        return "Error", -1.0

    if query_vector is None:
        return "No Face Detected", -1.0

    return find_embedding_match_indexed(query_vector, names, matrix)


def crop_face_with_padding(frame, bbox, padding_percentage=0.25):
    """
    Crop a face from the frame using bbox (x, y, w, h) with some padding.
    Ensures boundaries do not go out of frame range.
    """
    h_frame, w_frame, _ = frame.shape
    x, y, w, h = bbox

    pad_w = int(w * padding_percentage)
    pad_h = int(h * padding_percentage)

    x1 = max(0, x - pad_w)
    y1 = max(0, y - pad_h)
    x2 = min(w_frame, x + w + pad_w)
    y2 = min(h_frame, y + h + pad_h)

    return frame[y1:y2, x1:x2]


def log_attendance(name, track_id=None, event_type="IN"):
    """
    Append an attendance record to ``data/attendance.csv``.

    Each row now carries an event ``Type`` — ``"IN"`` (a track's first
    successful recognition) or ``"OUT"`` (logged by camera_loop when that
    same track's face leaves frame — see the ``FaceTracker.update()``
    removed-tracks return value). The DTR report pairs a day's earliest IN
    with its latest OUT to compute hours rendered.

    **IN** events use the existing per-track/per-name deduplication: each
    track ID can only log once within a short cooldown, and the same name
    can't log again within a longer cooldown (guards against tracking
    flicker spawning a new track_id for someone already logged in). When a
    face leaves the frame and comes back, the tracker assigns a *new* track
    ID, so the return visit is treated as a fresh log entry.

    **OUT** events skip that dedup entirely — they're only ever called once
    per track, at the exact moment ``FaceTracker`` reports that track as
    aged-out (removed), so there's no flicker to guard against and reusing
    the IN-oriented per-name cooldown would just make a same-day OUT
    immediately after an IN get silently dropped.

    Records with names like ``"Unknown"``, ``"No Registered Faces"``,
    ``"No Face Detected"``, ``"Error"``, or ``"Scanning..."`` are silently
    skipped — only real person names are logged.

    Parameters
    ----------
    name : str
        The detected person's name.
    track_id : int, optional
        The tracker-assigned ID for this face appearance. Used for
        per-track deduplication on IN events. If None, that check is skipped.
    event_type : str
        ``"IN"`` or ``"OUT"``.

    Returns
    -------
    bool
        True if the record was successfully logged, False if skipped or errored.
    """
    # Skip non-person labels
    skip_labels = {
        "Unknown", "No Registered Faces", "No Face Detected",
        "Error", "Scanning...",
    }
    if name in skip_labels:
        return False

    now = datetime.now()

    if event_type == "IN":
        # ---------- Per-track deduplication ----------
        if track_id is not None and track_id in _logged_tracks:
            elapsed = (now - _logged_tracks[track_id]).total_seconds()
            if elapsed < DEDUP_TRACK_COOLDOWN_SECONDS:
                return False  # already logged for this track appearance — skip

        # ---------- Per-name deduplication ----------
        if name in _logged_names:
            elapsed = (now - _logged_names[name]).total_seconds()
            if elapsed < DEDUP_NAME_COOLDOWN_SECONDS:
                return False  # same person logged moments ago (track flicker) — skip

        # Prune expired entries so the caches don't grow forever in long sessions
        for tid in [t for t, ts in _logged_tracks.items()
                    if (now - ts).total_seconds() >= DEDUP_TRACK_COOLDOWN_SECONDS]:
            del _logged_tracks[tid]
        for n in [n for n, ts in _logged_names.items()
                  if (now - ts).total_seconds() >= DEDUP_NAME_COOLDOWN_SECONDS]:
            del _logged_names[n]

    # ---------- Ensure CSV has a header ----------
    write_header = False
    if not os.path.isfile(ATTENDANCE_CSV) or os.path.getsize(ATTENDANCE_CSV) == 0:
        write_header = True

    try:
        with open(ATTENDANCE_CSV, "a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if write_header:
                writer.writerow(["Name", "Timestamp", "Type"])
            writer.writerow([name, now.strftime("%Y-%m-%d %H:%M:%S"), event_type])

        if event_type == "IN":
            if track_id is not None:
                _logged_tracks[track_id] = now
            _logged_names[name] = now
        logger.info("Attendance logged: %s %s at %s", name, event_type, now.strftime("%H:%M:%S"))
        return True

    except OSError as e:
        logger.error("Failed to write attendance: %s", e)
        return False


def _find_todays_event(name, date_str, event_type):
    """Scan attendance.csv for `name`'s first `event_type` row on `date_str`
    (YYYY-MM-DD). Returns that row's full timestamp, or None."""
    if not os.path.isfile(ATTENDANCE_CSV):
        return None
    with open(ATTENDANCE_CSV, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader, None)  # header row
        for row in reader:
            if len(row) < 2 or row[0] != name or not row[1].startswith(date_str):
                continue
            row_type = row[2] if len(row) >= 3 and row[2] in ("IN", "OUT") else "IN"
            if row_type == event_type:
                return row[1]
    return None


def manual_time_event(name, event_type):
    """
    Manually log a time-in or time-out for `name`, bypassing the tracker
    entirely — a fallback for when face recognition isn't practical
    (camera trouble, someone forgot their badge photo, etc.).

    Unlike ``log_attendance()`` (which dedups a *tracker-driven* IN on
    short per-track/per-name cooldowns so tracking flicker doesn't spam
    duplicate rows), a manual entry is a deliberate one-shot action, so the
    constraint here is **at most one IN and one OUT per person per calendar
    day** — checked against every existing row for that name today
    regardless of whether it came from the camera or a prior manual entry.

    Parameters
    ----------
    name : str
        The person's name (sanitized the same way as face registration).
    event_type : str
        ``"IN"`` or ``"OUT"``.

    Returns
    -------
    str
        The logged timestamp (``"YYYY-MM-DD HH:MM:SS"``).

    Raises
    ------
    ValueError
        If the name is empty, `event_type` is invalid, the person already
        has that event type logged today, or (for "OUT") they haven't
        timed in yet today.
    """
    clean_name = sanitize_name(name)
    if not clean_name:
        raise ValueError("Name cannot be empty (or contained only invalid characters).")
    if event_type not in ("IN", "OUT"):
        raise ValueError("event_type must be 'IN' or 'OUT'.")

    now = datetime.now()
    today = now.strftime("%Y-%m-%d")

    existing = _find_todays_event(clean_name, today, event_type)
    if existing:
        verb = "timed in" if event_type == "IN" else "timed out"
        existing_time = datetime.strptime(existing, "%Y-%m-%d %H:%M:%S").strftime("%I:%M %p").lstrip("0")
        raise ValueError(f"{clean_name} already {verb} today at {existing_time}.")

    if event_type == "OUT" and not _find_todays_event(clean_name, today, "IN"):
        raise ValueError(f"{clean_name} hasn't timed in today yet — can't time out.")

    write_header = not os.path.isfile(ATTENDANCE_CSV) or os.path.getsize(ATTENDANCE_CSV) == 0
    timestamp = now.strftime("%Y-%m-%d %H:%M:%S")
    with open(ATTENDANCE_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if write_header:
            writer.writerow(["Name", "Timestamp", "Type"])
        writer.writerow([clean_name, timestamp, event_type])

    logger.info("Manual attendance logged: %s %s at %s", clean_name, event_type, now.strftime("%H:%M:%S"))
    return timestamp


def save_unknown_snapshot(frame):
    """
    Save a timestamped snapshot of an unknown face to ``data/unknown_logs/``.

    Parameters
    ----------
    frame : numpy.ndarray
        The webcam frame to save.

    Returns
    -------
    str or None
        The saved file path, or None on failure.
    """
    import cv2

    os.makedirs(UNKNOWN_LOGS_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"unknown_{timestamp}.jpg"
    filepath = os.path.join(UNKNOWN_LOGS_DIR, filename)

    try:
        cv2.imwrite(filepath, frame)
        logger.info("Unknown face saved: %s", filepath)
        return filepath
    except Exception as e:
        logger.error("Failed to save unknown snapshot: %s", e)
        return None
