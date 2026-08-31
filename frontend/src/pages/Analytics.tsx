import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpDown, CalendarCheck, ClipboardList, Search, Trophy, Users } from "lucide-react";

import { fetchAttendance, fetchStatus, type AttendanceRecord } from "@/api";
import { KpiCard } from "@/components/KpiCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { to12Hour } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function toKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function rowDateLabel(key: string): string {
  const today = toKey(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === today) return "Today";
  if (key === toKey(yesterday)) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function splitTimestamp(timestamp: string): { dateKey: string; time: string } {
  const [dateKey, time] = timestamp.split(" ");
  return { dateKey: dateKey ?? "", time: time ?? "" };
}

type SortKey = "name" | "timestamp";
type SortDir = "asc" | "desc";

function ChartTooltip({
  active,
  payload,
  labelFormatter,
}: {
  active?: boolean;
  payload?: { value: number; payload: { name?: string } }[];
  label?: string;
  labelFormatter?: (raw: string, entry: { name?: string }) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  const rawLabel = entry.payload?.name ?? "";
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-semibold text-popover-foreground">{entry.value}</div>
      <div className="text-muted-foreground">{labelFormatter ? labelFormatter(rawLabel, entry.payload) : rawLabel}</div>
    </div>
  );
}

export function Analytics() {
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);
  const [registeredCount, setRegisteredCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    Promise.all([fetchAttendance(), fetchStatus()])
      .then(([attendance, status]) => {
        setRecords(attendance);
        setRegisteredCount(status.registered_count);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load analytics."));
  }, []);

  const stats = useMemo(() => {
    const rows = records ?? [];
    const todayKey = toKey(new Date());

    const perDayMap = new Map<string, number>();
    const perNameMap = new Map<string, number>();
    let todayCount = 0;
    const todayNames = new Set<string>();

    for (const r of rows) {
      const { dateKey } = splitTimestamp(r.timestamp);
      perDayMap.set(dateKey, (perDayMap.get(dateKey) ?? 0) + 1);
      perNameMap.set(r.name, (perNameMap.get(r.name) ?? 0) + 1);
      if (dateKey === todayKey) {
        todayCount += 1;
        todayNames.add(r.name);
      }
    }

    const perDay: { key: string; name: string; value: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = toKey(d);
      perDay.push({ key, name: dayLabel(key), value: perDayMap.get(key) ?? 0 });
    }

    const topAttendees = [...perNameMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }))
      .reverse(); // recharts horizontal bars render bottom-up

    return {
      todayCount,
      uniqueToday: todayNames.size,
      allTime: rows.length,
      perDay,
      topAttendees,
    };
  }, [records]);

  const filteredRows = useMemo(() => {
    const rows = records ?? [];
    const needle = search.trim().toLowerCase();
    const filtered = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;

    const sorted = [...filtered].sort((a, b) => {
      const cmp =
        sortKey === "name" ? a.name.localeCompare(b.name) : a.timestamp.localeCompare(b.timestamp);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [records, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const loading = records === null && !error;

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">Attendance trends and historical check-in records</p>
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="py-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px]" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Check-ins Today" value={String(stats.todayCount)} icon={CalendarCheck} />
            <KpiCard label="Unique People Today" value={String(stats.uniqueToday)} icon={Users} />
            <KpiCard label="Total Check-ins" value={String(stats.allTime)} icon={ClipboardList} />
            <KpiCard label="Registered Faces" value={String(registeredCount)} icon={Trophy} />
          </div>

          {stats.allTime === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
                <ClipboardList className="size-8 opacity-40" />
                No attendance recorded yet — check-ins will appear here once someone is recognized on the Dashboard.
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card className="gap-4">
                  <CardHeader>
                    <CardTitle>Check-ins per day</CardTitle>
                    <CardDescription>Last 14 days</CardDescription>
                  </CardHeader>
                  <CardContent className="h-64 px-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.perDay} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="var(--border)" />
                        <XAxis
                          dataKey="name"
                          tickLine={false}
                          axisLine={{ stroke: "var(--border)" }}
                          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                          width={28}
                        />
                        <Tooltip
                          cursor={{ fill: "var(--accent)" }}
                          content={<ChartTooltip labelFormatter={(_, entry) => entry.name ?? ""} />}
                        />
                        <Bar dataKey="value" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={24} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="gap-4">
                  <CardHeader>
                    <CardTitle>Top attendees</CardTitle>
                    <CardDescription>By total check-ins, all time</CardDescription>
                  </CardHeader>
                  <CardContent className="h-64 px-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={stats.topAttendees}
                        layout="vertical"
                        margin={{ top: 8, right: 24, left: 8, bottom: 0 }}
                      >
                        <CartesianGrid horizontal={false} stroke="var(--border)" />
                        <XAxis type="number" hide allowDecimals={false} />
                        <YAxis
                          dataKey="name"
                          type="category"
                          tickLine={false}
                          axisLine={false}
                          width={88}
                          tick={{ fill: "var(--foreground)", fontSize: 12 }}
                        />
                        <Tooltip
                          cursor={{ fill: "var(--accent)" }}
                          content={<ChartTooltip labelFormatter={(_, entry) => entry.name ?? ""} />}
                        />
                        <Bar dataKey="value" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={18}>
                          <LabelList
                            dataKey="value"
                            position="right"
                            style={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              <Card className="gap-0 py-0">
                <CardHeader className="flex flex-row items-center justify-between gap-3 border-b px-5 py-4">
                  <div>
                    <CardTitle>Attendance log</CardTitle>
                    <CardDescription>{filteredRows.length} record(s)</CardDescription>
                  </div>
                  <div className="relative w-full max-w-xs">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by name…"
                      className="pl-8"
                    />
                  </div>
                </CardHeader>
                <CardContent className="max-h-96 overflow-y-auto px-0">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow className="hover:bg-transparent">
                        <TableHead>
                          <button
                            onClick={() => toggleSort("name")}
                            className="flex items-center gap-1 hover:text-foreground"
                          >
                            Name <ArrowUpDown className="size-3" />
                          </button>
                        </TableHead>
                        <TableHead>
                          <button
                            onClick={() => toggleSort("timestamp")}
                            className="flex items-center gap-1 hover:text-foreground"
                          >
                            Logged at <ArrowUpDown className="size-3" />
                          </button>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRows.length > 0 ? (
                        filteredRows.map((r, i) => {
                          const { dateKey, time } = splitTimestamp(r.timestamp);
                          return (
                            <TableRow key={`${r.name}-${r.timestamp}-${i}`}>
                              <TableCell className="font-medium">{r.name}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {rowDateLabel(dateKey)} · {to12Hour(time)}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      ) : (
                        <TableRow>
                          <TableCell colSpan={2} className="py-8 text-center text-muted-foreground">
                            No records match “{search}”.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
