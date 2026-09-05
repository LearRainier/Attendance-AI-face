"""
liveness.py — Active Challenge-Response Liveness Detection.

Evaluates real-time facial landmarks (5 points from YuNet) to confirm that
a tracked face is an active, living human responding to a prompt, rather than
a static photo, screen replay, or video loop.

Challenges supported:
  - 'smile': mouth corners widen relative to interpupillary distance
  - 'turn_left': head turns towards the person's left (yaw shift)
  - 'turn_right': head turns towards the person's right (yaw shift)

Countdown timeout: 3.0 seconds per challenge attempt.
"""

import math
import random
import time
import numpy as np

CHALLENGE_TIMEOUT_SECONDS = 3.0

CHALLENGES = ("smile", "turn_left", "turn_right")

CHALLENGE_PROMPTS = {
    "smile": "Please smile to confirm",
    "turn_left": "Please turn your head left",
    "turn_right": "Please turn your head right",
}


def pick_random_challenge():
    """Select a random liveness challenge."""
    return random.choice(CHALLENGES)


def extract_challenge_metrics(landmarks):
    """
    Compute invariant geometric ratios from YuNet's 5 facial landmarks:
      0: right eye (person's right)
      1: left eye (person's left)
      2: nose tip
      3: right mouth corner
      4: left mouth corner

    Returns
    -------
    dict
      {
        'smile_ratio': mouth_width / eye_distance,
        'yaw_ratio': distance(right_eye_x, nose_x) / eye_distance_x,
      }
    """
    if landmarks is None or len(landmarks) < 5:
        return None

    pts = np.asarray(landmarks, dtype=np.float32)
    r_eye = pts[0]
    l_eye = pts[1]
    nose = pts[2]
    r_mouth = pts[3]
    l_mouth = pts[4]

    # Interpupillary Euclidean distance
    eye_dist = math.hypot(l_eye[0] - r_eye[0], l_eye[1] - r_eye[1])
    if eye_dist <= 1.0:
        return None

    # Mouth width
    mouth_width = math.hypot(l_mouth[0] - r_mouth[0], l_mouth[1] - r_mouth[1])
    smile_ratio = mouth_width / eye_dist

    # Horizontal yaw ratio (0.5 ≈ front-facing; >0.65 ≈ turned left; <0.35 ≈ turned right)
    # Ensure ordering is based on horizontal coordinates
    x_min_eye = min(r_eye[0], l_eye[0])
    x_max_eye = max(r_eye[0], l_eye[0])
    eye_span_x = x_max_eye - x_min_eye

    if eye_span_x > 1.0:
        # Ratio of nose position within horizontal eye span
        yaw_ratio = (nose[0] - x_min_eye) / eye_span_x
    else:
        yaw_ratio = 0.5

    return {
        "smile_ratio": smile_ratio,
        "yaw_ratio": yaw_ratio,
    }


def evaluate_challenge(challenge, landmarks, baseline_metrics, elapsed_time, timeout=CHALLENGE_TIMEOUT_SECONDS):
    """
    Evaluate whether the current frame satisfies the active challenge.

    Parameters
    ----------
    challenge : str
        'smile', 'turn_left', or 'turn_right'
    landmarks : np.ndarray
        The 5 facial landmarks for this track.
    baseline_metrics : dict or None
        Metrics captured at challenge start to measure relative change.
    elapsed_time : float
        Seconds elapsed since challenge was issued.
    timeout : float
        Maximum seconds allowed before failing.

    Returns
    -------
    tuple (status, seconds_left, metrics)
        status: 'pending', 'passed', or 'failed'
        seconds_left: float
        metrics: dict
    """
    seconds_left = max(0.0, timeout - elapsed_time)
    current_metrics = extract_challenge_metrics(landmarks)

    if current_metrics is None:
        if elapsed_time >= timeout:
            return "failed", 0.0, None
        return "pending", seconds_left, None

    if baseline_metrics is None:
        baseline_metrics = current_metrics

    passed = False

    if challenge == "smile":
        # Check either a significant relative widening over baseline or absolute threshold
        delta_smile = current_metrics["smile_ratio"] - baseline_metrics.get("smile_ratio", 0.70)
        if delta_smile >= 0.10 or current_metrics["smile_ratio"] >= 0.86:
            passed = True

    elif challenge == "turn_left":
        # Turning left moves the nose relative to the eyes
        delta_yaw = current_metrics["yaw_ratio"] - baseline_metrics.get("yaw_ratio", 0.50)
        if delta_yaw >= 0.14 or current_metrics["yaw_ratio"] >= 0.66:
            passed = True

    elif challenge == "turn_right":
        # Turning right moves the nose in the opposite direction
        delta_yaw = current_metrics["yaw_ratio"] - baseline_metrics.get("yaw_ratio", 0.50)
        if delta_yaw <= -0.14 or current_metrics["yaw_ratio"] <= 0.34:
            passed = True

    if passed:
        return "passed", seconds_left, current_metrics

    if elapsed_time >= timeout:
        return "failed", 0.0, current_metrics

    return "pending", seconds_left, current_metrics
