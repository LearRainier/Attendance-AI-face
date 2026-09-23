import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  FileClock,
  FileSpreadsheet,
  UserCheck,
} from "lucide-react";

import {
  fetchAttendance,
  fetchStatus,
  fetchUsers,
  type AttendanceRecord,
  type UserProfile,
} from "@/api";
import { KpiCard } from "@/components/KpiCard";
import { PersonCombobox } from "@/components/PersonCombobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { exportIndividualDtrPdf } from "@/lib/pdfExport";
import { PaginationBar } from "@/components/PaginationBar";
import { cn } from "@/lib/utils";

interface DayRecord {
  date: string; // "YYYY-MM-DD"
  timeInTs: string | null;
  status: "ON_TIME" | "LATE";
}

function parseTimestamp(ts: string): Date {
  return new Date(ts.replace(" ", "T"));
}

function timeLabel(ts: string): string {
  const d = parseTimestamp(ts);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function monthLabel(isoMonth: string): string {
  const [y, m] = isoMonth.split("-").map(Number);
  const date = new Date(y, m - 1, 1);
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function DTR() {
  const [people, setPeople] = useState<string[]>([]);
  const [selectedName, setSelectedName] = useState<string>("");
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);
  const [month, setMonth] = useState<string>(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  });
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [tablePage, setTablePage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    setTablePage(1);
  }, [selectedName, month]);

  useEffect(() => {
    Promise.all([fetchStatus(), fetchUsers()])
      .then(([s, u]) => {
        const names = s.people.map((p) => p.name);
        setPeople(names);
        setUserProfiles(u);
        if (names.length > 0) setSelectedName(names[0]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load registered people."));
  }, []);

  useEffect(() => {
    fetchAttendance()
      .then((data) => {
        setRecords(data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load attendance records."));
  }, []);

  const currentUserProfile = useMemo(() => {
    return userProfiles.find((u) => u.name.toLowerCase() === selectedName.toLowerCase()) ?? null;
  }, [userProfiles, selectedName]);

  // Map days with check-in records for this person in the selected month
  const days: DayRecord[] = useMemo(() => {
    if (!records || !selectedName) return [];

    const byDate = new Map<string, AttendanceRecord[]>();
    for (const r of records) {
      if (r.name !== selectedName || !r.timestamp.startsWith(month)) continue;
      const key = r.timestamp.split(" ")[0];
      const list = byDate.get(key) ?? [];
      list.push(r);
      byDate.set(key, list);
    }

    const result: DayRecord[] = [];
    for (const [date, dayRecords] of byDate) {
      const ins = dayRecords
        .filter((r) => r.type === "IN")
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const firstIn = ins[0] ?? dayRecords[0];
      const timeInTs = firstIn?.timestamp ?? null;
      const status = (firstIn?.status ?? "ON_TIME") as "ON_TIME" | "LATE";
      result.push({ date, timeInTs, status });
    }

    result.sort((a, b) => a.date.localeCompare(b.date));
    return result;
  }, [records, selectedName, month]);

  const paginatedDays = useMemo(() => {
    const start = (tablePage - 1) * pageSize;
    return days.slice(start, start + pageSize);
  }, [days, tablePage, pageSize]);

  // Statistics for this month
  const stats = useMemo(() => {
    const [yStr, mStr] = month.split("-");
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const totalDaysInMonth = new Date(y, m, 0).getDate();

    let requiredDays = 0;
    for (let d = 1; d <= totalDaysInMonth; d++) {
      if (new Date(y, m - 1, d).getDay() !== 0) {
        requiredDays++;
      }
    }

    const presentDays = days.length;
    const cleanDays = days.filter((d) => d.status === "ON_TIME").length;
    const lateDays = days.filter((d) => d.status === "LATE").length;
    const absentDays = Math.max(0, requiredDays - presentDays);
    const rate = requiredDays > 0 ? Math.round((presentDays / requiredDays) * 100) : 100;

    return {
      totalDaysInMonth,
      requiredDays,
      presentDays,
      cleanDays,
      lateDays,
      absentDays,
      rate,
    };
  }, [days, month]);

  // Monthly calendar days matrix for the individual heatmap
  const calendarCells = useMemo(() => {
    const [yStr, mStr] = month.split("-");
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10) - 1;
    const daysCount = new Date(y, m + 1, 0).getDate();
    const startDay = new Date(y, m, 1).getDay(); // 0 = Sun

    const dayMap = new Map<string, DayRecord>();
    days.forEach((d) => dayMap.set(d.date, d));

    const cells: ({
      dayNum: number;
      dateStr: string;
      isSaturday: boolean;
      isSunday: boolean;
      record?: DayRecord;
    } | null)[] = [];

    for (let i = 0; i < startDay; i++) cells.push(null);
    for (let d = 1; d <= daysCount; d++) {
      const dStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dow = new Date(y, m, d).getDay();
      cells.push({
        dayNum: d,
        dateStr: dStr,
        isSaturday: dow === 6,
        isSunday: dow === 0,
        record: dayMap.get(dStr),
      });
    }
    return cells;
  }, [days, month]);

  // Export Handlers: PDF & CSV
  const handleExportCsv = () => {
    if (!selectedName || days.length === 0) return;
    const yl = currentUserProfile?.year_level ? `Year ${currentUserProfile.year_level}` : "Year 1";
    const courseYear = `${currentUserProfile?.department || "N/A"} - ${yl}${currentUserProfile?.is_deployed ? " (Deployed)" : ""}`;
    const studentId = currentUserProfile?.student_number || currentUserProfile?.employee_id || "N/A";

    const meta = [
      `"Student Name: ${selectedName}"`,
      `"Student ID: ${studentId}"`,
      `"Course & Year: ${courseYear}"`,
      `"Month: ${month}"`,
      "",
    ].join("\n");

    const header = "Date,Day,Course & Year,Time In,Status\n";
    const rows = days.map((d) => {
      const [yr, mo, dy] = d.date.split("-").map(Number);
      const dow = new Date(yr, mo - 1, dy).toLocaleDateString("en-US", { weekday: "long" });
      const timeStr = d.timeInTs ? timeLabel(d.timeInTs) : "—";
      const statusStr = d.timeInTs
        ? d.status === "LATE"
          ? "Late Login"
          : "Clean / On Time"
        : dow === "Sunday"
        ? "Sunday (Off)"
        : "Absent";
      return [d.date, dow, `"${courseYear}"`, `"${timeStr}"`, `"${statusStr}"`].join(",");
    });
    const csvContent = meta + "\n" + header + rows.join("\n") + "\n";
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DTR_${selectedName.replace(/[^a-zA-Z0-9_-]/g, "_")}_${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = async () => {
    if (!selectedName) return;
    setExporting(true);
    try {
      await exportIndividualDtrPdf({
        userName: selectedName,
        userProfile: currentUserProfile,
        month,
        days,
      });
    } catch (err) {
      console.error("PDF export failed:", err);
    } finally {
      setExporting(false);
    }
  };

  const loading = records === null && !error;

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Daily Time Record</h1>
          <p className="text-sm text-muted-foreground">
            Individual monthly attendance heatmap, activity tracking, and data export
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleExportCsv}
            disabled={exporting || people.length === 0 || days.length === 0}
            variant="outline"
            className="gap-2 shadow-xs cursor-pointer"
          >
            <FileSpreadsheet className="size-4" />
            Export CSV
          </Button>
          <Button
            onClick={handleExportPdf}
            disabled={exporting || people.length === 0}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs cursor-pointer"
          >
            <Download className="size-4" />
            {exporting ? "Generating PDF…" : "Export PDF"}
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="py-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : loading ? (
        <Skeleton className="h-96" />
      ) : people.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
            <FileClock className="size-8 opacity-40" />
            No one is registered yet — add someone on the Register page first.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Filter Bar */}
          <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-4 shadow-2xs">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dtr-person">Person</Label>
              <PersonCombobox
                id="dtr-person"
                people={people}
                value={selectedName}
                onChange={setSelectedName}
                placeholder="Search for a person…"
                className="w-64"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dtr-month">Month</Label>
              <input
                id="dtr-month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="border-input flex h-9 rounded-md border bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>
            {currentUserProfile && (
              <div className="flex flex-col gap-0.5 text-xs text-muted-foreground ml-auto self-center pt-2 sm:pt-0 text-right">
                <span className="font-semibold text-foreground">
                  {currentUserProfile.student_number || currentUserProfile.employee_id || "Student ID"}
                </span>
                <div className="flex items-center justify-end gap-1.5">
                  <span className="text-primary font-medium">
                    {currentUserProfile.department
                      ? `${currentUserProfile.department} - Year ${currentUserProfile.year_level || 1}`
                      : "Course: Not Specified"}
                  </span>
                  {currentUserProfile.is_deployed && (
                    <Badge variant="warning" className="font-semibold text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 py-0 px-1">
                      Deployed
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Metric Summary Cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard
              label="Days Present"
              value={`${stats.presentDays} / ${stats.requiredDays}`}
              icon={UserCheck}
            />
            <KpiCard
              label="Clean Logins"
              value={String(stats.cleanDays)}
              icon={CheckCircle2}
            />
            <KpiCard
              label="Late Logins"
              value={String(stats.lateDays)}
              icon={Clock}
            />
            <KpiCard
              label="Days Absent"
              value={String(stats.absentDays)}
              icon={CalendarClock}
            />
          </div>

          {/* Individual Heatmap Calendar */}
          <Card className="gap-0 py-0 overflow-hidden shadow-2xs">
            <CardHeader className="border-b px-5 py-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">
                  {selectedName} — Attendance Heatmap
                </CardTitle>
                <CardDescription>
                  {monthLabel(month)} • {stats.presentDays} of {stats.requiredDays} expected day(s) active ({stats.rate}% attendance)
                </CardDescription>
              </div>
              {/* Heatmap Legend */}
              <div className="flex items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="size-3 rounded-xs border border-success bg-success/20 dark:bg-success/30" />
                  <span className="text-muted-foreground">Clean (&lt; 5:15 AM)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="size-3 rounded-xs border border-warning bg-warning/25 dark:bg-warning/35" />
                  <span className="text-muted-foreground">Late (5:15–6:30 AM)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="size-3 rounded-xs border border-border bg-muted/20" />
                  <span className="text-muted-foreground">Absent / Sun Off</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              {/* Weekday headers */}
              <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold text-muted-foreground mb-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                  <div key={day} className="py-1">
                    {day}
                  </div>
                ))}
              </div>

              {/* Grid Cells */}
              <div className="grid grid-cols-7 gap-2">
                {calendarCells.map((cell, idx) => {
                  if (!cell) {
                    return (
                      <div
                        key={`pad-${idx}`}
                        className="min-h-[64px] rounded-lg border border-border/20 bg-muted/10 opacity-30"
                      />
                    );
                  }

                  const hasLogin = !!(cell.record && cell.record.timeInTs);
                  const isLate = cell.record?.status === "LATE";
                  const isSunday = cell.isSunday;

                  return (
                    <div
                      key={cell.dateStr}
                      className={cn(
                        "relative flex min-h-[64px] flex-col justify-between rounded-lg border p-2 transition-all shadow-2xs",
                        hasLogin
                          ? isLate
                            ? "border-warning/60 bg-warning/10 text-warning-foreground dark:bg-warning/15"
                            : "border-success/60 bg-success/10 text-foreground dark:bg-success/15"
                          : isSunday
                          ? "border-border/30 bg-muted/15 text-muted-foreground/50 opacity-75"
                          : "border-border/40 bg-card text-muted-foreground/60"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold leading-none">{cell.dayNum}</span>
                        {hasLogin ? (
                          <Badge
                            variant={isLate ? "outline" : "default"}
                            className={cn(
                              "text-[9px] px-1 py-0 h-4 uppercase font-semibold",
                              isLate
                                ? "border-warning text-warning bg-warning/10"
                                : "border-success text-success bg-success/10"
                            )}
                          >
                            {cell.isSaturday ? "Sat" : isLate ? "Late" : "Clean"}
                          </Badge>
                        ) : isSunday ? (
                          <Badge
                            variant="secondary"
                            className="text-[9px] px-1 py-0 h-4 uppercase font-medium text-muted-foreground/70 bg-muted/40"
                          >
                            Sun / Off
                          </Badge>
                        ) : null}
                      </div>

                      <div className="text-center my-auto">
                        {hasLogin && cell.record?.timeInTs ? (
                          <div className="text-xs font-semibold tracking-tight text-foreground">
                            {timeLabel(cell.record.timeInTs)}
                          </div>
                        ) : isSunday ? (
                          <span className="text-[10px] text-muted-foreground/40 font-medium">Closed</span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/40 font-medium">Absent</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Detailed Activity Table */}
          <Card className="gap-0 py-0 shadow-2xs">
            <CardHeader className="border-b px-5 py-4">
              <CardTitle className="text-base font-semibold">Attendance Log Detail</CardTitle>
              <CardDescription>Individual check-in timestamps and punctuality status</CardDescription>
            </CardHeader>
            <CardContent className="px-0 py-0">
              {days.length > 0 ? (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Time In</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedDays.map((d) => (
                        <TableRow key={d.date}>
                          <TableCell className="font-medium">{dayLabel(d.date)}</TableCell>
                          <TableCell>{d.timeInTs ? timeLabel(d.timeInTs) : "—"}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "gap-1 font-medium",
                                d.status === "LATE"
                                  ? "border-warning/60 text-warning bg-warning/10"
                                  : "border-success/60 text-success bg-success/10"
                              )}
                            >
                              {d.status === "LATE" ? (
                                <>
                                  <Clock className="size-3" />
                                  Late
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="size-3" />
                                  Clean
                                </>
                              )}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <PaginationBar
                    currentPage={tablePage}
                    totalItems={days.length}
                    pageSize={pageSize}
                    onPageChange={setTablePage}
                    itemLabel="days logged"
                  />
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
                  <FileClock className="size-6 opacity-50" />
                  No attendance activity recorded for {selectedName} in {monthLabel(month)}.
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
