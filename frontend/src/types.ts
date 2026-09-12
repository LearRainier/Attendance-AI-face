export type TrackStatus = "idle" | "processing" | "completed";
export type LivenessState = "none" | "challenge" | "passed" | "failed" | "already_logged";
export type ChallengeType = "smile" | "turn_left" | "turn_right";

export interface Track {
  track_id: number;
  bbox: [number, number, number, number]; // x, y, w, h in native frame pixels
  label: string;
  status: TrackStatus;
  distance: number;
  progress: number | null;
  challenge?: ChallengeType | null;
  challenge_text?: string | null;
  challenge_seconds_left?: number | null;
  liveness_state?: LivenessState | null;
  is_spoof?: boolean;
}

/** A real face the backend detected but deliberately refused to scan
 * because it's outside the configured distance range (see
 * src/detection.py). Rendered as a muted hint so someone standing too far
 * back can see why nothing is happening — it is never tracked or logged. */
export interface RangeHint {
  bbox: [number, number, number, number];
  reason: "too_far" | "too_close";
}

export type AttendanceStatus = "ON_TIME" | "LATE";

export interface ToastState {
  name: string;
  start_time: number;
  status?: AttendanceStatus;
}

export type RecentCheckin = [name: string, time: string];

export interface LiveState {
  frame: string | null;
  tracks: Track[];
  hints: RangeHint[];
  /** Pixel size of the frame `tracks`/`hints` were computed on. Needed to
   * place boxes when the picture on screen isn't that same frame — a phone
   * previews at full resolution while uploading a downscaled copy for
   * detection, so the two coordinate spaces differ by a constant factor. 0
   * when there's no current frame. */
  frame_width: number;
  frame_height: number;
  toast: ToastState | null;
  fps: number;
  registered_count: number;
  recent_checkins: RecentCheckin[];
  /** Device index the backend is set to use — the authoritative value for
   * the dashboard's camera picker, since a switch can also come from
   * another browser tab or a startup fallback. */
  camera_index: number | null;
  /** Whether the backend currently holds that camera open. False while it's
   * released for registration or a device scan, and while a switch is
   * in flight. */
  camera_active: boolean;
  /** Why the feed is black, when it is (camera unplugged, held by another
   * app, or delivering no frames). Null when the camera is fine. */
  camera_error: string | null;
  /** Where the backend is getting frames: "local" = a webcam on the server
   * machine, "browser" = a device (typically a phone) pushing its own camera
   * up /ws/ingest. */
  camera_source: "local" | "browser";
  /** Friendly name of the streaming device, when camera_source is "browser". */
  source_label: string | null;
  /** Whether check-in is currently closed based on daily schedule cutoff. */
  schedule_closed?: boolean;
  /** Closed notice message to output when attendance cutoff is reached. */
  schedule_message?: string | null;
}
