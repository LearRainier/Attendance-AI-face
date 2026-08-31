import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Clock, Download, FileClock } from "lucide-react";

import { fetchAttendance, fetchStatus, type AttendanceRecord } from "@/api";
import { KpiCard } from "@/components/KpiCard";
import { PersonCombobox } from "@/components/PersonCombobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface DayRecord {
  date: string; // "YYYY-MM-DD"
  timeInTs: string | null;
  timeOutTs: string | null;
  hours: number | null; // null when the day has no complete IN+OUT pair yet
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function parseTimestamp(ts: string): Date {
  const [datePart, timePart] = ts.split(" ");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm, ss] = (timePart ?? "0:0:0").split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, ss);
}

function timeLabel(ts: string): string {
  return parseTimestamp(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
}

function dayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function DTR() {
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);
  const [people, setPeople] = useState<string[]>([]);
  const [selectedName, setSelectedName] = useState<string>("");
  const [month, setMonth] = useState<string>(currentMonthKey());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchAttendance(), fetchStatus()])
      .then(([attendance, status]) => {
        setRecords(attendance);
        const names = status.people.map((p) => p.name);
        setPeople(names);
        setSelectedName((prev) => prev || names[0] || "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load attendance."));
  }, []);

  const days = useMemo<DayRecord[]>(() => {
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
      const ins = dayRecords.filter((r) => r.type === "IN").sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const outs = dayRecords.filter((r) => r.type === "OUT").sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const timeInTs = ins[0]?.timestamp ?? null;
      const timeOutTs = outs.length > 0 ? outs[outs.length - 1].timestamp : null;

      let hours: number | null = null;
      if (timeInTs && timeOutTs) {
        const rawHours = (parseTimestamp(timeOutTs).getTime() - parseTimestamp(timeInTs).getTime()) / 3_600_000;
        hours = rawHours >= 0 ? rawHours : null; // guard against clock anomalies
      }

      result.push({ date, timeInTs, timeOutTs, hours });
    }

    result.sort((a, b) => a.date.localeCompare(b.date));
    return result;
  }, [records, selectedName, month]);

  const totalHours = useMemo(() => days.reduce((sum, d) => sum + (d.hours ?? 0), 0), [days]);
  const completeDays = days.filter((d) => d.hours !== null).length;

  const handleExportCsv = () => {
    const header = "Date,Time In,Time Out,Hours Rendered\n";
    const rows = days.map((d) =>
      [
        d.date,
        d.timeInTs ? timeLabel(d.timeInTs) : "",
        d.timeOutTs ? timeLabel(d.timeOutTs) : "",
        d.hours !== null ? d.hours.toFixed(2) : "",
      ].join(",")
    );
    const csv = header + rows.join("\n") + `\nTotal,,,${totalHours.toFixed(2)}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DTR_${selectedName}_${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loading = records === null && !error;

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Daily Time Record</h1>
          <p className="text-sm text-muted-foreground">
            Time in / time out and hours rendered, built from face-recognition events
          </p>
        </div>
        <Button onClick={handleExportCsv} disabled={days.length === 0} variant="outline">
          <Download className="size-4" />
          Export CSV
        </Button>
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
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dtr-person">Person</Label>
              <PersonCombobox
                id="dtr-person"
                people={people}
                value={selectedName}
                onChange={setSelectedName}
                placeholder="Search for a person…"
                className="w-56"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dtr-month">Month</Label>
              <input
                id="dtr-month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="border-input flex h-9 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <KpiCard label="Days logged this month" value={String(days.length)} icon={CalendarClock} />
            <KpiCard label="Days with a full IN + OUT" value={String(completeDays)} icon={FileClock} />
            <KpiCard label="Overall total hours rendered" value={`${totalHours.toFixed(2)} hrs`} icon={Clock} />
          </div>

          <Card className="gap-0 py-0">
            <CardHeader className="border-b px-5 py-4">
              <CardTitle>
                {selectedName} — {monthLabel(month)}
              </CardTitle>
              <CardDescription>{days.length} day(s) with activity this month</CardDescription>
            </CardHeader>
            <CardContent className="px-0 py-0">
              {days.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Time In</TableHead>
                      <TableHead>Time Out</TableHead>
                      <TableHead className="text-right">Hours Rendered</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {days.map((d) => (
                      <TableRow key={d.date}>
                        <TableCell className="font-medium">{dayLabel(d.date)}</TableCell>
                        <TableCell>{d.timeInTs ? timeLabel(d.timeInTs) : "—"}</TableCell>
                        <TableCell>
                          {d.timeOutTs ? (
                            timeLabel(d.timeOutTs)
                          ) : (
                            <span className="text-muted-foreground">no time-out yet</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {d.hours !== null ? `${d.hours.toFixed(2)} hrs` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3}>Overall Total Hours Rendered</TableCell>
                      <TableCell className="text-right font-semibold">{totalHours.toFixed(2)} hrs</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              ) : (
                <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
                  <FileClock className="size-6 opacity-50" />
                  No attendance activity for {selectedName} in {monthLabel(month)}.
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
