"""
tracker.py — Lightweight real-time face tracking.

Uses IoU (Intersection over Union) to match face bounding boxes across
consecutive frames, maintaining persistent identities (tracks) for faces
visible in the webcam feed.
"""

import logging
import time

logger = logging.getLogger(__name__)


class FaceTrack:
    """Represents a single tracked face."""
    def __init__(self, track_id, bbox, label="Scanning...", distance=-1.0):
        self.track_id = track_id
        self.bbox = bbox  # (x, y, w, h)
        self.label = label
        self.distance = distance
        self.first_seen = time.time()
        self.last_seen = time.time()
        
        # State:
        # "idle"       - ready to be recognized / waiting
        # "processing" - currently being processed in background thread
        # "completed"  - recognized successfully (either match or confirmed unknown)
        self.status = "idle"
        
        self.last_recognition_time = 0
        self.recognition_attempts = 0
        # Starts True so the toast only fires after a successful attendance
        # log arms it (worker sets it back to False on log).
        self.toast_triggered = True
        self.attendance_logged_in = False

        # Liveness challenge state
        self.liveness_state = "none"       # "none", "challenge", "passed", "failed", "already_logged"
        self.challenge = None              # "smile", "turn_left", "turn_right"
        self.challenge_text = None         # Instruction prompt for the user
        self.challenge_start_time = 0.0
        self.challenge_baseline = None
        self.challenge_seconds_left = 0.0
        self.candidate_name = None         # Recognized person name awaiting liveness verification
        self.latest_landmarks = None      # 5 facial landmark points from YuNet
        self.is_spoof = False
        self.spoof_reason = ""

    # Labels that should go back to "idle" so the main loop can retry them.
    RETRYABLE_LABELS = (
        "Scanning...", "Unknown", "Error", "No Face Detected",
        "Liveness Failed", "Spoof Detected",
    )

    def update_status(self, label, distance=-1.0):
        """Update label and state based on recognition results."""
        self.label = label
        self.distance = distance
        if label == "Spoof Detected":
            self.is_spoof = True
        elif label not in self.RETRYABLE_LABELS:
            self.is_spoof = False

        if label in self.RETRYABLE_LABELS:
            self.status = "idle"
        else:
            # Real person match or "No Registered Faces" (retrying is pointless)
            self.status = "completed"


def compute_iou(boxA, boxB):
    """
    Calculate the Intersection over Union (IoU) of two bounding boxes.
    Boxes are in (x, y, w, h) format.
    """
    # Convert boxes from (x, y, w, h) to (x1, y1, x2, y2)
    x1_A, y1_A, x2_A, y2_A = boxA[0], boxA[1], boxA[0] + boxA[2], boxA[1] + boxA[3]
    x1_B, y1_B, x2_B, y2_B = boxB[0], boxB[1], boxB[0] + boxB[2], boxB[1] + boxB[3]

    # Calculate coordinates of intersection area
    xA = max(x1_A, x1_B)
    yA = max(y1_A, y1_B)
    xB = min(x2_A, x2_B)
    yB = min(y2_A, y2_B)

    # Compute intersection area
    interArea = max(0, xB - xA) * max(0, yB - yA)
    if interArea == 0:
        return 0.0

    # Compute areas of both boxes
    boxAArea = boxA[2] * boxA[3]
    boxBArea = boxB[2] * boxB[3]

    # Compute IoU
    unionArea = float(boxAArea + boxBArea - interArea)
    if unionArea == 0:
        return 0.0

    return interArea / unionArea


class FaceTracker:
    """Tracks detected faces across consecutive frames using IoU mapping."""
    def __init__(self, iou_threshold=0.20, max_age_seconds=1.2):
        self.iou_threshold = iou_threshold
        self.max_age_seconds = max_age_seconds
        self.next_track_id = 1
        self.tracks = {}  # {track_id: FaceTrack}

    def update(self, detected_boxes, detected_landmarks=None):
        """
        Update tracks with a new set of detected face bounding boxes.

        Parameters
        ----------
        detected_boxes : list[tuple[int, int, int, int]]
            List of (x, y, w, h) bounding boxes from the detector.
        detected_landmarks : list[np.ndarray], optional
            Parallel list of 5-point YuNet landmarks.

        Returns
        -------
        tuple[dict[int, FaceTrack], list[FaceTrack]]
            (currently active tracks, tracks removed this call because they
            aged out — i.e. the face left frame).
        """
        current_time = time.time()
        
        # 1. Compute IoU between all active tracks and new detections
        matches = []
        unmatched_tracks = list(self.tracks.keys())
        unmatched_detections = list(range(len(detected_boxes)))

        for track_id, track in self.tracks.items():
            for det_idx, det_box in enumerate(detected_boxes):
                iou = compute_iou(track.bbox, det_box)
                if iou >= self.iou_threshold:
                    matches.append((iou, track_id, det_idx))

        # Sort matches by IoU score in descending order
        matches.sort(key=lambda x: x[0], reverse=True)

        matched_tracks = set()
        matched_detections = set()

        for iou, track_id, det_idx in matches:
            if track_id in matched_tracks or det_idx in matched_detections:
                continue
            
            # Map detection to this track
            track = self.tracks[track_id]
            track.bbox = detected_boxes[det_idx]
            if detected_landmarks and det_idx < len(detected_landmarks):
                track.latest_landmarks = detected_landmarks[det_idx]
            track.last_seen = current_time
            
            matched_tracks.add(track_id)
            matched_detections.add(det_idx)
            
            if track_id in unmatched_tracks:
                unmatched_tracks.remove(track_id)
            if det_idx in unmatched_detections:
                unmatched_detections.remove(det_idx)

        # 2. Age out old tracks that weren't matched
        removed_tracks = []
        for track_id in list(unmatched_tracks):
            track = self.tracks[track_id]
            if current_time - track.last_seen > self.max_age_seconds:
                logger.debug("Track %d lost (aged out).", track_id)
                removed_tracks.append(track)
                del self.tracks[track_id]

        # 3. Create new tracks for unmatched detections
        for det_idx in unmatched_detections:
            det_box = detected_boxes[det_idx]
            new_track = FaceTrack(self.next_track_id, det_box)
            if detected_landmarks and det_idx < len(detected_landmarks):
                new_track.latest_landmarks = detected_landmarks[det_idx]
            self.tracks[self.next_track_id] = new_track
            logger.debug("New track locked, assigned ID %d.", self.next_track_id)
            self.next_track_id += 1

        return self.tracks, removed_tracks
