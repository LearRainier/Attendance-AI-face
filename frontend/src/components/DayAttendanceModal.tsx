import { useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  Clock,
  LogIn,
  LogOut,
  Search,
  UserCheck,
  Users,
} from "lucide-react";

import type { AttendanceRecord, HeatmapDay } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaginationBar } from "@/components/PaginationBar";

interface DayAttendanceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: HeatmapDay | null;
  records: AttendanceRecord[];
  registeredCount: number;
}

export function DayAttendanceModal({
  open,
  onOpenChange,
  day,
  records,
  registeredCount,
}: DayAttendanceModalProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ON_TIME" | "LATE">("ALL");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Filter records for this day and search criteria
  const dayRecords = useMemo(() => {
    if (!day) return [];
    // Only records matching this day's date string "YYYY-MM-DD"
    const datePrefix = day.date;
    const matching = records.filter((r) => r.timestamp.startsWith(datePrefix));

    return matching.filter((r) => {
      const matchSearch = r.name.toLowerCase().includes(search.trim().toLowerCase());
      const matchStatus =
        statusFilter === "ALL" ||
        (statusFilter === "ON_TIME" && r.status === "ON_TIME") ||
        (statusFilter === "LATE" && r.status === "LATE");
      return matchSearch && matchStatus;
    });
  }, [day, records, search, statusFilter]);

  const paginatedRecords = useMemo(() => {
    const start = (page - 1) * pageSize;
    return dayRecords.slice(start, start + pageSize);
  }, [dayRecords, page, pageSize]);

  if (!day) return null;

  const formattedDate = new Date(day.date + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b bg-card/60 backdrop-blur-sm">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Calendar className="size-4.5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold tracking-tight">
                {formattedDate}
              </DialogTitle>
              <DialogDescription className="text-xs">
                Attendance logs and entry timestamps for this date
              </DialogDescription>
            </div>
          </div>

          {/* Quick Metrics Badges */}
          <div className="flex flex-wrap items-center gap-2 pt-3">
            <Badge variant="outline" className="gap-1 text-xs py-0.5">
              <Users className="size-3 text-muted-foreground" />
              <span>
                Attendance: <strong className="font-semibold text-foreground">{day.attendees_count}</strong> / {registeredCount} ({day.attendance_rate}%)
              </span>
            </Badge>

            <Badge variant="outline" className="gap-1 text-xs py-0.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400">
              <CheckCircle2 className="size-3" />
              <span>Clean: {day.clean_count}</span>
            </Badge>

            {day.late_count > 0 && (
              <Badge variant="outline" className="gap-1 text-xs py-0.5 border-amber-500/30 bg-amber-500/10 text-amber-500 dark:text-amber-400">
                <Clock className="size-3" />
                <span>Late: {day.late_count}</span>
              </Badge>
            )}
          </div>
        </DialogHeader>

        {/* Filter & Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b bg-muted/20">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search attendee name…"
              className="h-8 pl-8 text-xs bg-background"
            />
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant={statusFilter === "ALL" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs px-2.5 cursor-pointer"
              onClick={() => setStatusFilter("ALL")}
            >
              All ({day.attendees_count})
            </Button>
            <Button
              variant={statusFilter === "ON_TIME" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs px-2.5 cursor-pointer"
              onClick={() => setStatusFilter("ON_TIME")}
            >
              Clean ({day.clean_count})
            </Button>
            {day.late_count > 0 && (
              <Button
                variant={statusFilter === "LATE" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs px-2.5 cursor-pointer"
                onClick={() => setStatusFilter("LATE")}
              >
                Late ({day.late_count})
              </Button>
            )}
          </div>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-y-auto px-6 py-3 min-h-[220px]">
          {dayRecords.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Student / Attendee</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Punctuality</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedRecords.map((rec, idx) => {
                    const timePart = rec.timestamp.split(" ")[1] || rec.timestamp;
                    const timeDate = new Date(rec.timestamp.replace(" ", "T"));
                    const formattedTime = !isNaN(timeDate.getTime())
                      ? timeDate.toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                          second: "2-digit",
                          hour12: true,
                        })
                      : timePart;

                    const isLate = rec.status === "LATE";
                    const rowNum = (page - 1) * pageSize + idx + 1;

                    return (
                      <TableRow key={`${rec.name}-${rec.timestamp}-${idx}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {rowNum}
                        </TableCell>
                        <TableCell className="font-medium text-xs">
                          {rec.name}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {formattedTime}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                            {rec.type === "IN" ? (
                              <>
                                <LogIn className="size-3 text-emerald-500" />
                                <span>Time In</span>
                              </>
                            ) : (
                              <>
                                <LogOut className="size-3 text-amber-500" />
                                <span>Time Out</span>
                              </>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {isLate ? (
                            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-500 dark:text-amber-400 text-[11px]">
                              Late Login
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 text-[11px]">
                              Clean / On Time
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <PaginationBar
                currentPage={page}
                totalItems={dayRecords.length}
                pageSize={pageSize}
                onPageChange={setPage}
                itemLabel="logs"
              />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 text-center text-xs text-muted-foreground">
              <UserCheck className="size-8 opacity-30 mb-2" />
              <p className="font-medium text-foreground">No attendance records found</p>
              <p className="text-[11px] mt-0.5">
                {search || statusFilter !== "ALL"
                  ? "Try changing your search query or status filter."
                  : "No check-ins were registered for this date."}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
