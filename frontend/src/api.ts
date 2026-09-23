export interface RegisterResponse {
  success: boolean;
  name: string;
  student_number?: string;
  template_count: number;
  email_status?: string;
}

export interface StatusResponse {
  registered_count: number;
  people: { name: string; template_count: number }[];
}

export type AttendanceStatus = "ON_TIME" | "LATE";

export interface AttendanceRecord {
  name: string;
  timestamp: string; // "YYYY-MM-DD HH:MM:SS"
  type: "IN" | "OUT";
  status?: AttendanceStatus;
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
  student_number?: string;
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
  student_number?: string;
  email?: string;
  phone?: string;
  department?: string;
  position?: string;
  employee_id?: string;
  notes?: string;
}

async function safeParseJson<T = any>(res: Response, fallbackError: string): Promise<T> {
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const errorMsg = (data && (data.detail || data.message)) || (text && text.length < 200 ? text : fallbackError);
    throw new Error(errorMsg);
  }
  return data as T;
}

export async function registerFace(
  name: string,
  imageB64: string,
  studentNumber: string = "",
  email: string = "",
  department: string = ""
): Promise<RegisterResponse> {
  const res = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      student_number: studentNumber,
      email,
      department,
      image_b64: imageB64,
    }),
  });
  return safeParseJson<RegisterResponse>(res, "Registration failed.");
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
): Promise<{ name: string; type: "IN" | "OUT"; timestamp: string; status?: AttendanceStatus }> {
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

export interface HeatmapDay {
  date: string;
  day: number;
  weekday: string;
  weekday_num: number;
  attendees_count: number;
  clean_count: number;
  late_count: number;
  attendance_rate: number;
  attendee_names: string[];
}

export interface UserRankingItem {
  name: string;
  count: number;
  lates: number;
  clean: number;
}

export interface UserLateRankingItem {
  name: string;
  lates: number;
  clean: number;
  total: number;
}

export interface AnalyticsSummary {
  period: "month" | "week";
  filter_label: string;
  start_date: string;
  end_date: string;
  registered_count: number;
  total_sessions: number;
  unique_active: number;
  total_clean: number;
  total_late: number;
  punctuality_rate: number;
  avg_daily_rate: number;
  heatmap: HeatmapDay[];
  top_most_logins: UserRankingItem[];
  top_lowest_logins: UserRankingItem[];
  top_most_lates: UserLateRankingItem[];
}

export async function fetchAnalyticsSummary(
  period: "month" | "week" = "month",
  value?: string
): Promise<AnalyticsSummary> {
  const params = new URLSearchParams({ period });
  if (value) params.set("value", value);
  const res = await fetch(`/api/analytics/summary?${params.toString()}`);
  if (!res.ok) {
    throw new Error("Failed to load analytics summary.");
  }
  return (await res.json()) as AnalyticsSummary;
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
  const data = await safeParseJson<{ success: boolean; user: UserProfile }>(res, "Failed to save user.");
  return data.user;
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

export interface AuthResponse {
  success: boolean;
  token: string;
  username: string;
  role?: string;
  student_number?: string;
  email?: string;
}

export interface VerifyAuthResponse {
  authenticated: boolean;
  username: string;
  role?: string;
  user_info?: Record<string, unknown>;
}

const AUTH_TOKEN_KEY = "mg_attendance_admin_token";
const AUTH_USER_KEY = "mg_attendance_admin_user";
const AUTH_ROLE_KEY = "mg_attendance_user_role";

export function getStoredAuth(): { token: string | null; username: string | null; role: string | null } {
  return {
    token: localStorage.getItem(AUTH_TOKEN_KEY),
    username: localStorage.getItem(AUTH_USER_KEY),
    role: localStorage.getItem(AUTH_ROLE_KEY) || "admin",
  };
}

export function setStoredAuth(token: string, username: string, role: string = "admin") {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, username);
  localStorage.setItem(AUTH_ROLE_KEY, role);
}

export function clearStoredAuth() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem(AUTH_ROLE_KEY);
}

export async function loginAdmin(username: string, password: string): Promise<AuthResponse> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await safeParseJson<AuthResponse>(res, "Invalid administrator credentials.");
  setStoredAuth(data.token, data.username, data.role || "admin");
  return data;
}

export async function verifyAdminAuth(token: string): Promise<VerifyAuthResponse> {
  const res = await fetch("/api/auth/verify", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    clearStoredAuth();
    throw new Error("Session expired or invalid.");
  }
  return (await res.json()) as VerifyAuthResponse;
}

export async function logoutAdmin(): Promise<void> {
  const { token } = getStoredAuth();
  if (token) {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // ignore
    }
  }
  clearStoredAuth();
}

export async function changeAdminPassword(
  currentPassword: string,
  newPassword: string,
  newUsername?: string
): Promise<{ success: boolean; token: string; username: string }> {
  const { token } = getStoredAuth();
  const res = await fetch("/api/auth/change-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token || ""}`,
    },
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
      new_username: newUsername,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || "Failed to update credentials.");
  }
  if (data.token && data.username) {
    setStoredAuth(data.token, data.username);
  }
  return data;
}


export interface ScheduleSetting {
  enabled: boolean;
  schedule_closed: boolean;
  schedule_message: string | null;
}

/** Current state of the attendance-schedule master switch. */
export async function getScheduleSetting(): Promise<ScheduleSetting> {
  const res = await fetch("/api/settings/schedule");
  return safeParseJson<ScheduleSetting>(res, "Failed to read the schedule setting.");
}

/** Turn every time-of-day rule on or off (admin only). With it off the kiosk
 * camera runs around the clock and no check-in is refused for being outside
 * the schedule. */
export async function setScheduleEnabled(enabled: boolean): Promise<ScheduleSetting> {
  const { token } = getStoredAuth();
  const res = await fetch("/api/settings/schedule", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token || ""}`,
    },
    body: JSON.stringify({ enabled }),
  });
  return safeParseJson<ScheduleSetting>(res, "Failed to update the schedule setting.");
}
