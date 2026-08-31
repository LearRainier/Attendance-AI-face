export interface RegisterResponse {
  success: boolean;
  name: string;
  template_count: number;
}

export interface StatusResponse {
  registered_count: number;
  people: { name: string; template_count: number }[];
}

export interface AttendanceRecord {
  name: string;
  timestamp: string; // "YYYY-MM-DD HH:MM:SS"
  type: "IN" | "OUT";
}

export interface DetectResponse {
  width: number;
  height: number;
  faces: [number, number, number, number][]; // [x, y, w, h] in the sent image's pixel space
  /** Faces that were detected but fall outside the backend's scanning
   * distance range — reported separately so the guide can say "step closer"
   * rather than "no face detected". */
  out_of_range: { bbox: [number, number, number, number]; reason: "too_far" | "too_close" }[];
}

export interface UserProfile {
  name: string;
  template_count: number;
  email: string;
  phone: string;
  department: string;
  position: string;
  employee_id: string;
  notes: string;
  updated_at: string | null;
}

export interface UserProfileInput {
  name: string;
  email?: string;
  phone?: string;
  department?: string;
  position?: string;
  employee_id?: string;
  notes?: string;
}

export async function registerFace(name: string, imageB64: string): Promise<RegisterResponse> {
  const res = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, image_b64: imageB64 }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || "Registration failed.");
  }
  return data as RegisterResponse;
}

/** Lightweight face-count/box preview for the Register page's live guide —
 * runs the same detection gate as the live dashboard on a single frame, no
 * embedding/DeepFace work. */
export async function detectFaces(imageB64: string): Promise<DetectResponse> {
  const res = await fetch("/api/register/detect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_b64: imageB64 }),
  });
  if (!res.ok) {
    throw new Error("Face detection preview failed.");
  }
  return (await res.json()) as DetectResponse;
}

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch("/api/status");
  if (!res.ok) {
    throw new Error("Failed to load registered-people status.");
  }
  return (await res.json()) as StatusResponse;
}

export async function fetchAttendance(): Promise<AttendanceRecord[]> {
  const res = await fetch("/api/attendance");
  if (!res.ok) {
    throw new Error("Failed to load attendance records.");
  }
  const data = await res.json();
  return data.records as AttendanceRecord[];
}

/** Logs a time-in/time-out without going through face recognition — a
 * fallback for when the camera can't be used. The backend enforces at
 * most one IN and one OUT per person per calendar day and throws (with a
 * message like "X already timed in today at HH:MM") if that's violated. */
export async function logManualAttendance(
  name: string,
  eventType: "IN" | "OUT"
): Promise<{ name: string; type: "IN" | "OUT"; timestamp: string }> {
  const res = await fetch("/api/attendance/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, event_type: eventType }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || "Failed to log attendance.");
  }
  return data;
}

export async function fetchUsers(): Promise<UserProfile[]> {
  const res = await fetch("/api/users");
  if (!res.ok) {
    throw new Error("Failed to load users.");
  }
  const data = await res.json();
  return data.users as UserProfile[];
}

export async function saveUserProfile(profile: UserProfileInput): Promise<UserProfile> {
  const res = await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || "Failed to save user.");
  }
  return data.user as UserProfile;
}

export async function deleteUserProfile(name: string): Promise<void> {
  const res = await fetch(`/api/users/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to delete user.");
  }
}

export interface CameraDevice {
  index: number;
  width: number;
  height: number;
  /** Capture backend that worked for this device ("dshow"/"msmf" on Windows). */
  backend: string;
  /** Base64 data-URL still captured while probing. OpenCV can't report a
   * device's friendly name, so this is what lets someone tell one camera
   * from another. Null if the frame couldn't be encoded. */
  thumbnail: string | null;
}

export interface CamerasResponse {
  cameras: CameraDevice[];
  selected: number | null;
  active: boolean;
  error: string | null;
}

/** Cameras found by the backend's last scan (it probes at startup), plus
 * which one is selected. Cheap — it doesn't touch the devices. */
export async function fetchCameras(): Promise<CamerasResponse> {
  const res = await fetch("/api/cameras");
  if (!res.ok) {
    throw new Error("Failed to load the camera list.");
  }
  return (await res.json()) as CamerasResponse;
}

/** Re-probes the device indices, for a camera plugged in after startup.
 * Takes a few seconds and blanks the live feed while it runs, because the
 * backend has to release the webcam for the probe. */
export async function scanCameras(): Promise<CamerasResponse> {
  const res = await fetch("/api/cameras/scan", { method: "POST" });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || "Camera scan failed.");
  }
  return data as CamerasResponse;
}

/** Points the live feed at a different camera. The choice is persisted
 * backend-side, so it survives a restart. Resolves once the backend has
 * actually opened the new device (or failed to). */
export async function selectCamera(index: number): Promise<CamerasResponse> {
  const res = await fetch("/api/camera/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || "Failed to switch camera.");
  }
  return data as CamerasResponse;
}

/** Tells the backend to release the webcam it holds for the live dashboard
 * feed, so the browser's own getUserMedia can acquire it for registration.
 * Resolves once the backend confirms the camera is actually released. */
export async function pauseBackendCamera(): Promise<void> {
  await fetch("/api/camera/pause", { method: "POST" });
}

/** Tells the backend it can reacquire the webcam for the live dashboard feed. */
export async function resumeBackendCamera(): Promise<void> {
  await fetch("/api/camera/resume", { method: "POST" });
}
