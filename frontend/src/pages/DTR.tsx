import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Download, FileClock } from "lucide-react";

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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface DayRecord {
  date: string; // "YYYY-MM-DD"
  timeInTs: string | null;
}

function parseTimestamp(ts: string): Date {
  // Backend stamps as "YYYY-MM-DD HH:MM:SS"
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
  const [month, setMonth] = useState<string>(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  });
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus()
      .then((s) => {
        const names = s.people.map((p) => p.name);
        setPeople(names);
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
      const ins = dayRecords.filter((r) => r.type === "IN").sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const timeInTs = ins[0]?.timestamp ?? dayRecords[0]?.timestamp ?? null;
      result.push({ date, timeInTs });
    }

    result.sort((a, b) => a.date.localeCompare(b.date));
    return result;
  }, [records, selectedName, month]);

  const handleExportCsv = () => {
    const header = "Date,Time In\n";
    const rows = days.map((d) =>
      [
        d.date,
        d.timeInTs ? timeLabel(d.timeInTs) : "",
      ].join(",")
    );
    const csv = header + rows.join("\n") + "\n";
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
            Daily check-in records built from face-recognition events
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

          <div className="grid grid-cols-1 gap-4 sm:w-72">
            <KpiCard label="Days logged this month" value={String(days.length)} icon={CalendarClock} />
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {days.map((d) => (
                      <TableRow key={d.date}>
                        <TableCell className="font-medium">{dayLabel(d.date)}</TableCell>
                        <TableCell>{d.timeInTs ? timeLabel(d.timeInTs) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
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
