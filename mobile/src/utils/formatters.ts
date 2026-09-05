import { AttendanceRecord, DayLog } from "../api/types";

export function parseTimestamp(ts: string): Date {
  // Backend stamps as "YYYY-MM-DD HH:MM:SS"
  return new Date(ts.replace(" ", "T"));
}

export function formatTime(ts: string): string {
  try {
    const d = parseTimestamp(ts);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return ts.split(" ")[1]?.slice(0, 5) || ts;
  }
}

export function formatDayOfWeek(isoDate: string): string {
  try {
    const [y, m, d] = isoDate.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("en-US", { weekday: "short" });
  } catch {
    return "";
  }
}

export function formatDateReadable(isoDate: string): string {
  try {
    const [y, m, d] = isoDate.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoDate;
  }
}

export function formatMonthName(isoMonth: string): string {
  try {
    const [y, m] = isoMonth.split("-").map(Number);
    const date = new Date(y, m - 1, 1);
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } catch {
    return isoMonth;
  }
}

export function getCurrentIsoMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function getAdjacentMonth(isoMonth: string, delta: number): string {
  const [y, m] = isoMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const nextY = d.getFullYear();
  const nextM = String(d.getMonth() + 1).padStart(2, "0");
  return `${nextY}-${nextM}`;
}

export function groupAttendanceIntoDailyLogs(records: AttendanceRecord[], selectedMonth?: string): DayLog[] {
  if (!records || records.length === 0) return [];

  const byDate = new Map<string, AttendanceRecord[]>();

  for (const r of records) {
    if (!r.timestamp) continue;
    if (selectedMonth && !r.timestamp.startsWith(selectedMonth)) continue;
    const dateKey = r.timestamp.split(" ")[0];
    const list = byDate.get(dateKey) ?? [];
    list.push(r);
    byDate.set(dateKey, list);
  }

  const logs: DayLog[] = [];

  for (const [dateKey, dayRecords] of byDate) {
    // Sort chronologically to get first check-in
    dayRecords.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const firstIn = dayRecords.find((r) => r.type === "IN") || dayRecords[0];

    logs.push({
      date: dateKey,
      timeInTs: firstIn.timestamp,
      timeLabel: formatTime(firstIn.timestamp),
      dayOfWeek: formatDayOfWeek(dateKey),
      formattedDate: formatDateReadable(dateKey),
      status: "PRESENT",
    });
  }

  // Sort descending by date so most recent day is at top
  logs.sort((a, b) => b.date.localeCompare(a.date));
  return logs;
}
