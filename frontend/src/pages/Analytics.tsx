import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpDown,
  CalendarCheck,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Flame,
  RefreshCw,
  Search,
  Trophy,
  TrendingDown,
  Users,
} from "lucide-react";

import {
  fetchAnalyticsSummary,
  fetchAttendance,
  type AnalyticsSummary,
  type AttendanceRecord,
} from "@/api";
import { AttendanceHeatmap } from "@/components/AttendanceHeatmap";
import { KpiCard } from "@/components/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { exportAnalyticsReportPdf } from "@/lib/pdfExport";
import { cn } from "@/lib/utils";

type PeriodMode = "month" | "week";
type SortKey = "name" | "timestamp" | "status";
type SortDir = "asc" | "desc";

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function Analytics() {
  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const [monthValue, setMonthValue] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [weekValue, setWeekValue] = useState<string>(() => toDateKey(new Date()));

  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [rawRecords, setRawRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<boolean>(false);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Load analytics summary
  const loadData = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    const filterVal = periodMode === "month" ? monthValue : weekValue;

    try {
      const [sumData, attData] = await Promise.all([
        fetchAnalyticsSummary(periodMode, filterVal),
        fetchAttendance(),
      ]);
      setSummary(sumData);
      setRawRecords(attData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [periodMode, monthValue, weekValue]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Navigate week forward / backward
  const shiftWeek = (daysOffset: number) => {
    const current = new Date(weekValue + "T00:00:00");
    current.setDate(current.getDate() + daysOffset);
    setWeekValue(toDateKey(current));
  };

  // Filter attendance log table
  const filteredLog = useMemo(() => {
    if (!summary) return [];
    const start = summary.start_date;
    const end = summary.end_date;

    const inRange = rawRecords.filter((r) => {
      const d = r.timestamp.split(" ")[0];
      return d >= start && d <= end;
    });

    const needle = search.trim().toLowerCase();
    const searched = needle
      ? inRange.filter((r) => r.name.toLowerCase().includes(needle))
      : inRange;

    return [...searched].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "status") cmp = (a.status || "").localeCompare(b.status || "");
      else cmp = a.timestamp.localeCompare(b.timestamp);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rawRecords, summary, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // PDF Export
  const handleExportPdf = async () => {
    if (!summary) return;
    setExporting(true);
    try {
      await exportAnalyticsReportPdf(summary);
    } catch (err) {
      console.error("PDF export failed:", err);
    } finally {
      setExporting(false);
    }
  };

  // Chart data for daily attendance trend
  const dailyTrendData = useMemo(() => {
    if (!summary) return [];
    return summary.heatmap.map((d) => ({
      name: periodMode === "week" ? d.weekday : `${d.day}`,
      date: d.date,
      rate: d.attendance_rate,
      attendees: d.attendees_count,
      clean: d.clean_count,
      late: d.late_count,
    }));
  }, [summary, periodMode]);

  // Donut chart data for Punctuality
  const punctualityData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: "Clean / On Time", value: summary.total_clean, color: "var(--success)" },
      { name: "Late Check-in", value: summary.total_late, color: "var(--warning)" },
    ];
  }, [summary]);

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Real-Time Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Real-time attendance investigation, density heatmaps, and ranking leaderboards
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData(true)}
            disabled={refreshing || loading}
            className="gap-1.5 shadow-2xs"
            title="Refresh analytics data"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            <span>{refreshing ? "Refreshing…" : "Live Refresh"}</span>
          </Button>

          <Button
            onClick={handleExportPdf}
            disabled={exporting || !summary}
            className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs"
          >
            <Download className="size-4" />
            <span>{exporting ? "Generating PDF…" : "Export PDF Report"}</span>
          </Button>
        </div>
      </div>

      {/* Filter Toolbar: Month vs Week Filter */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 shadow-2xs">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Filter View:
          </span>

          <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/30">
            <button
              type="button"
              onClick={() => setPeriodMode("month")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                periodMode === "month"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <CalendarRange className="size-3.5" />
              Monthly Filter
            </button>

            <button
              type="button"
              onClick={() => setPeriodMode("week")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                periodMode === "week"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <CalendarCheck className="size-3.5" />
              Weekly Filter
            </button>
          </div>
        </div>

        {/* Date Selector based on mode */}
        <div className="flex items-center gap-2">
          {periodMode === "month" ? (
            <div className="flex items-center gap-2">
              <Label htmlFor="analytics-month" className="text-xs text-muted-foreground">
                Select Month:
              </Label>
              <input
                id="analytics-month"
                type="month"
                value={monthValue}
                onChange={(e) => setMonthValue(e.target.value)}
                className="border-input flex h-8 rounded-md border bg-background px-2.5 py-1 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon"
                className="size-7"
                onClick={() => shiftWeek(-7)}
                title="Previous Week"
              >
                <ChevronLeft className="size-3.5" />
              </Button>

              <div className="flex items-center gap-1.5 border border-border rounded-md px-2.5 py-1 bg-background text-xs font-medium">
                <span>{summary?.filter_label || "Selected Week"}</span>
              </div>

              <Button
                variant="outline"
                size="icon"
                className="size-7"
                onClick={() => shiftWeek(7)}
                title="Next Week"
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="py-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : loading && !summary ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : summary ? (
        <>
          {/* Executive KPI Overview */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard
              label="Registered Users"
              value={String(summary.registered_count)}
              icon={Users}
            />
            <KpiCard
              label="Total Check-ins"
              value={String(summary.total_sessions)}
              icon={CalendarCheck}
            />
            <KpiCard
              label="Avg Daily Attendance"
              value={`${summary.avg_daily_rate}%`}
              icon={Trophy}
            />
            <KpiCard
              label="Punctuality Rate"
              value={`${summary.punctuality_rate}%`}
              icon={Clock}
            />
          </div>

          {/* 1. Monthly / Weekly Attendance Density Heatmap (White-to-Green gradient) */}
          <Card className="gap-0 py-0 overflow-hidden shadow-2xs">
            <CardHeader className="border-b px-5 py-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">
                  Attendance Density Heatmap ({summary.filter_label})
                </CardTitle>
                <CardDescription>
                  Gradient intensity reflects active attendees relative to registered users ({summary.registered_count} total).
                </CardDescription>
              </div>
              <Badge variant="outline" className="font-mono text-xs">
                {summary.period === "month" ? "30/31 Days View" : "7 Days Week View"}
              </Badge>
            </CardHeader>
            <CardContent className="p-5">
              <AttendanceHeatmap
                days={summary.heatmap}
                registeredCount={summary.registered_count}
                isWeekView={periodMode === "week"}
              />
            </CardContent>
          </Card>

          {/* 2. Top Rankings Section: 3 Columns Grid */}
          {/* 1. Top 15 Most Logins */}
          {/* 2. Top 15 Lowest Logins */}
          {/* 3. Top 15 Most Lates */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Card A: Top 15 Users with Most Logins */}
            <Card className="gap-0 py-0 shadow-2xs flex flex-col">
              <CardHeader className="border-b px-5 py-3.5 bg-card">
                <div className="flex items-center gap-2">
                  <Flame className="size-4 text-primary" />
                  <CardTitle className="text-sm font-semibold">Top 15 Most Logins</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Highest check-in frequency during this period
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 flex-1 max-h-96 overflow-y-auto">
                {summary.top_most_logins.length > 0 ? (
                  <div className="divide-y divide-border/60">
                    {summary.top_most_logins.map((user, idx) => (
                      <div
                        key={`most-${user.name}-${idx}`}
                        className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={cn(
                              "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                              idx === 0
                                ? "bg-amber-400/20 text-amber-600 dark:text-amber-300"
                                : idx === 1
                                ? "bg-slate-400/20 text-slate-600 dark:text-slate-300"
                                : idx === 2
                                ? "bg-amber-700/20 text-amber-700 dark:text-amber-400"
                                : "text-muted-foreground"
                            )}
                          >
                            {idx + 1}
                          </span>
                          <div className="truncate font-medium text-foreground">{user.name}</div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-muted-foreground">
                            {user.clean} clean, {user.lates} late
                          </span>
                          <Badge variant="default" className="text-xs font-semibold px-2 py-0.5">
                            {user.count}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-12 text-center text-xs text-muted-foreground">
                    No login data recorded.
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Card B: Top 15 Users with Lowest Logins */}
            <Card className="gap-0 py-0 shadow-2xs flex flex-col">
              <CardHeader className="border-b px-5 py-3.5 bg-card">
                <div className="flex items-center gap-2">
                  <TrendingDown className="size-4 text-destructive" />
                  <CardTitle className="text-sm font-semibold">Top 15 Lowest Logins</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Includes registered users with 0 or minimal check-ins
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 flex-1 max-h-96 overflow-y-auto">
                {summary.top_lowest_logins.length > 0 ? (
                  <div className="divide-y divide-border/60">
                    {summary.top_lowest_logins.map((user, idx) => (
                      <div
                        key={`low-${user.name}-${idx}`}
                        className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-muted-foreground">
                            {idx + 1}
                          </span>
                          <div className="truncate font-medium text-foreground">{user.name}</div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-muted-foreground">
                            {user.count === 0 ? "No activity" : `${user.clean} clean`}
                          </span>
                          <Badge
                            variant={user.count === 0 ? "destructive" : "secondary"}
                            className="text-xs font-semibold px-2 py-0.5"
                          >
                            {user.count}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-12 text-center text-xs text-muted-foreground">
                    No registered users found.
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Card C: Top 15 Users with Most Lates */}
            <Card className="gap-0 py-0 shadow-2xs flex flex-col">
              <CardHeader className="border-b px-5 py-3.5 bg-card">
                <div className="flex items-center gap-2">
                  <Clock className="size-4 text-warning" />
                  <CardTitle className="text-sm font-semibold">Top 15 Most Lates</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Frequent tardiness (5:15 AM – 6:30 AM non-Saturdays)
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 flex-1 max-h-96 overflow-y-auto">
                {summary.top_most_lates.length > 0 ? (
                  <div className="divide-y divide-border/60">
                    {summary.top_most_lates.map((user, idx) => (
                      <div
                        key={`late-${user.name}-${idx}`}
                        className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-warning">
                            {idx + 1}
                          </span>
                          <div className="truncate font-medium text-foreground">{user.name}</div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-muted-foreground">
                            {user.clean} on-time
                          </span>
                          <Badge
                            variant="outline"
                            className="border-warning/60 text-warning bg-warning/10 text-xs font-semibold px-2 py-0.5"
                          >
                            {user.lates} late(s)
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center text-xs text-muted-foreground gap-1.5">
                    <CheckCircle2 className="size-6 text-success opacity-80" />
                    <span className="font-medium text-foreground">Zero Late Logins!</span>
                    <span>All logged-in members were on time in this period.</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 3. Visual Charts Section: Punctuality Breakdown & Daily Trend */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Punctuality Donut Chart */}
            <Card className="gap-0 py-0 shadow-2xs">
              <CardHeader className="border-b px-5 py-4">
                <CardTitle className="text-base font-semibold">Punctuality Ratio</CardTitle>
                <CardDescription>Clean Check-ins vs Late Logins Distribution</CardDescription>
              </CardHeader>
              <CardContent className="p-5 flex flex-col md:flex-row items-center justify-center gap-6">
                <div className="size-48 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={punctualityData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={75}
                        paddingAngle={4}
                      >
                        {punctualityData.map((entry, idx) => (
                          <Cell key={`cell-${idx}`} fill={entry.color} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex flex-col gap-3 text-xs w-full max-w-xs">
                  <div className="flex items-center justify-between border-b border-border/60 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="size-3 rounded-full bg-success" />
                      <span className="font-medium text-foreground">Clean / On Time:</span>
                    </div>
                    <span className="font-bold text-success">
                      {summary.total_clean} ({summary.punctuality_rate}%)
                    </span>
                  </div>

                  <div className="flex items-center justify-between border-b border-border/60 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="size-3 rounded-full bg-warning" />
                      <span className="font-medium text-foreground">Late Check-in:</span>
                    </div>
                    <span className="font-bold text-warning">
                      {summary.total_late} ({summary.total_sessions > 0 ? (100 - summary.punctuality_rate).toFixed(1) : 0}%)
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-1 text-muted-foreground">
                    <span>Total Recorded Sessions:</span>
                    <span className="font-semibold text-foreground">{summary.total_sessions}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Daily Attendance Trend Line Chart */}
            <Card className="gap-0 py-0 shadow-2xs">
              <CardHeader className="border-b px-5 py-4">
                <CardTitle className="text-base font-semibold">Daily Attendance Trend (%)</CardTitle>
                <CardDescription>Attendance density curve across the selected period</CardDescription>
              </CardHeader>
              <CardContent className="h-64 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyTrendData} margin={{ top: 10, right: 20, left: -15, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="name"
                      tickLine={false}
                      axisLine={{ stroke: "var(--border)" }}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                      domain={[0, 100]}
                      unit="%"
                    />
                    <Tooltip
                      formatter={(value: any) => [`${value}%`, "Attendance Rate"]}
                      labelFormatter={(label, payload) => {
                        const item = payload[0]?.payload;
                        return item ? `${item.date} (${item.attendees} attendees)` : label;
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="rate"
                      stroke="var(--primary)"
                      strokeWidth={2.5}
                      dot={{ fill: "var(--primary)", r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* 4. Detailed Attendance Log Table with Search & Status Badges */}
          <Card className="gap-0 py-0 shadow-2xs">
            <CardHeader className="flex flex-row items-center justify-between gap-3 border-b px-5 py-4">
              <div>
                <CardTitle className="text-base font-semibold">Attendance Log Detail</CardTitle>
                <CardDescription>
                  {filteredLog.length} record(s) recorded in {summary.filter_label}
                </CardDescription>
              </div>

              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search attendee name…"
                  className="pl-8 text-xs h-8"
                />
              </div>
            </CardHeader>
            <CardContent className="max-h-96 overflow-y-auto px-0">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>
                      <button
                        onClick={() => toggleSort("name")}
                        className="flex items-center gap-1 hover:text-foreground cursor-pointer"
                      >
                        Name <ArrowUpDown className="size-3" />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => toggleSort("timestamp")}
                        className="flex items-center gap-1 hover:text-foreground cursor-pointer"
                      >
                        Timestamp <ArrowUpDown className="size-3" />
                      </button>
                    </TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>
                      <button
                        onClick={() => toggleSort("status")}
                        className="flex items-center gap-1 hover:text-foreground cursor-pointer"
                      >
                        Punctuality Status <ArrowUpDown className="size-3" />
                      </button>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLog.length > 0 ? (
                    filteredLog.map((r, i) => {
                      const isLate = r.status === "LATE";
                      return (
                        <TableRow key={`${r.name}-${r.timestamp}-${i}`}>
                          <TableCell className="font-medium">{r.name}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {r.timestamp}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px] font-semibold">
                              {r.type}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "gap-1 font-semibold text-[11px]",
                                isLate
                                  ? "border-warning/60 text-warning bg-warning/10"
                                  : "border-success/60 text-success bg-success/10"
                              )}
                            >
                              {isLate ? (
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
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        No attendance records found matching “{search}”.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
