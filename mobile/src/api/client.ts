import { API_BASE_URL } from "./config";
import { LoginResponse, StudentMeResponse } from "./types";

interface FetchOptions extends RequestInit {
  timeoutMs?: number;
}

async function requestWithTimeout<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { timeoutMs = 12000, ...fetchOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        ...fetchOptions.headers,
      },
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
    }

    const data = await res.json();
    if (!res.ok) {
      const errorMsg = data.detail || data.message || `Request failed with status ${res.status}`;
      throw new Error(errorMsg);
    }

    return data as T;
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error("Connection timed out. Please check your internet connection.");
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

export async function studentLogin(identifier: string, password: string): Promise<LoginResponse> {
  const url = `${API_BASE_URL}/api/student/login`;
  return requestWithTimeout<LoginResponse>(url, {
    method: "POST",
    body: JSON.stringify({
      username: identifier.trim(),
      password: password.trim(),
    }),
  });
}

export async function fetchStudentDtr(token: string, month?: string): Promise<StudentMeResponse> {
  let url = `${API_BASE_URL}/api/student/me`;
  if (month) {
    url += `?month=${encodeURIComponent(month.trim())}`;
  }

  return requestWithTimeout<StudentMeResponse>(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function checkServerHealth(): Promise<boolean> {
  try {
    const url = `${API_BASE_URL}/api/status`;
    const res = await fetch(url, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}
