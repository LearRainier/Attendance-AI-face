import { useMemo } from "react";
import type { HeatmapDay } from "@/api";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface AttendanceHeatmapProps {
  days: HeatmapDay[];
  registeredCount: number;
  monthLabel?: string;
  isWeekView?: boolean;
  onDayClick?: (day: HeatmapDay) => void;
  className?: string;
}

// Calculate gradient color from white/light neutral (0%) to deep emerald green (100%)
function getGradientStyle(attendees: number, registered: number, isDark: boolean): {
  backgroundColor: string;
  color: string;
  borderColor: string;
} {
  if (registered === 0 || attendees === 0) {
    return {
      backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "#ffffff",
      color: isDark ? "rgba(255, 255, 255, 0.4)" : "#64748b",
      borderColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)",
    };
  }

  const ratio = Math.min(1, Math.max(0, attendees / registered));

  // Thresholds for discrete, clear visual tiers
  if (ratio < 0.25) {
    return {
      backgroundColor: isDark ? "#143823" : "#dcfce7",
      color: isDark ? "#86efac" : "#14532d",
      borderColor: isDark ? "#166534" : "#bbf7d0",
    };
  } else if (ratio < 0.5) {
    return {
      backgroundColor: isDark ? "#166534" : "#86efac",
      color: isDark ? "#dcfce7" : "#052e16",
      borderColor: isDark ? "#22c55e" : "#4ade80",
    };
  } else if (ratio < 0.75) {
    return {
      backgroundColor: isDark ? "#15803d" : "#22c55e",
      color: "#ffffff",
      borderColor: isDark ? "#22c55e" : "#16a34a",
    };
  } else {
    return {
      backgroundColor: isDark ? "#16a34a" : "#15803d",
      color: "#ffffff",
      borderColor: isDark ? "#4ade80" : "#14532d",
    };
  }
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AttendanceHeatmap({
  days,
  registeredCount,
  monthLabel,
  isWeekView = false,
  onDayClick,
  className,
}: AttendanceHeatmapProps) {
  // Check if dark theme is active
  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  // For monthly view, pad the calendar start so Sunday is column 0
  const calendarCells = useMemo(() => {
    if (days.length === 0) return [];
    if (isWeekView) return days;

    const firstDay = days[0];
    const [y, m, d] = firstDay.date.split("-").map(Number);
    const firstDate = new Date(y, m - 1, d);
    const startDayOfWeek = firstDate.getDay(); // 0 = Sun, 1 = Mon...

    const padded: (HeatmapDay | null)[] = [];
    for (let i = 0; i < startDayOfWeek; i++) {
      padded.push(null);
    }
    for (const day of days) {
      padded.push(day);
    }
    return padded;
  }, [days, isWeekView]);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between">
        {monthLabel && <h3 className="text-sm font-semibold tracking-tight">{monthLabel}</h3>}
        {/* Heatmap Legend */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground ml-auto">
          <span>0%</span>
          <div className="flex items-center gap-1">
            <span className="size-3 rounded-xs border border-border bg-card shadow-2xs" title="0% attendance" />
            <span className="size-3 rounded-xs border border-emerald-300 dark:border-emerald-800 bg-emerald-100 dark:bg-emerald-950" title="1-24%" />
            <span className="size-3 rounded-xs border border-emerald-400 dark:border-emerald-700 bg-emerald-300 dark:bg-emerald-800" title="25-49%" />
            <span className="size-3 rounded-xs border border-emerald-500 dark:border-emerald-600 bg-emerald-500 dark:bg-emerald-700" title="50-74%" />
            <span className="size-3 rounded-xs border border-emerald-700 dark:border-emerald-500 bg-emerald-700 dark:bg-emerald-600" title="75-100%" />
          </div>
          <span>100%</span>
        </div>
      </div>

      <TooltipProvider delayDuration={150}>
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-medium text-muted-foreground">
          {WEEKDAY_NAMES.map((name) => (
            <div key={name} className="py-1">
              {name}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1.5">
          {calendarCells.map((cell, idx) => {
            if (!cell) {
              return (
                <div
                  key={`pad-${idx}`}
                  className="aspect-square rounded-md bg-muted/20 border border-border/30 opacity-30"
                />
              );
            }

            const style = getGradientStyle(cell.attendees_count, registeredCount, isDark);
            const isToday = cell.date === new Date().toISOString().split("T")[0];

            return (
              <Tooltip key={cell.date}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onDayClick?.(cell)}
                    style={{
                      backgroundColor: style.backgroundColor,
                      color: style.color,
                      borderColor: style.borderColor,
                    }}
                    className={cn(
                      "group relative flex flex-col items-center justify-center rounded-md border p-1 transition-all aspect-square cursor-pointer hover:ring-2 hover:ring-primary/40 hover:scale-105 active:scale-95 shadow-2xs",
                      isToday && "ring-2 ring-primary ring-offset-1"
                    )}
                  >
                    <span className="text-xs font-semibold leading-tight">{cell.day}</span>
                    <span className="text-[10px] font-medium opacity-85 leading-none mt-0.5">
                      {cell.attendees_count}/{registeredCount}
                    </span>
                    {cell.late_count > 0 && (
                      <span
                        className="absolute top-1 right-1 size-1.5 rounded-full bg-warning ring-1 ring-background"
                        title={`${cell.late_count} late login(s)`}
                      />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="p-2.5 text-xs max-w-xs shadow-lg">
                  <div className="flex flex-col gap-1">
                    <div className="font-semibold text-popover-foreground">
                      {new Date(cell.date + "T00:00:00").toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                    <div className="flex items-center justify-between gap-4 text-muted-foreground">
                      <span>Attendance:</span>
                      <span className="font-semibold text-popover-foreground">
                        {cell.attendees_count} / {registeredCount} ({cell.attendance_rate}%)
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 text-muted-foreground">
                      <span>Clean / On Time:</span>
                      <span className="font-semibold text-success">{cell.clean_count}</span>
                    </div>
                    {cell.late_count > 0 && (
                      <div className="flex items-center justify-between gap-4 text-muted-foreground">
                        <span>Late Check-ins:</span>
                        <span className="font-semibold text-warning">{cell.late_count}</span>
                      </div>
                    )}
                    {cell.attendee_names && cell.attendee_names.length > 0 && (
                      <div className="border-t border-border/60 pt-1.5 mt-0.5">
                        <span className="text-[11px] font-medium text-popover-foreground">Logged in:</span>
                        <div className="text-[10px] text-muted-foreground line-clamp-3 leading-snug mt-0.5">
                          {cell.attendee_names.join(", ")}
                        </div>
                      </div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    </div>
  );
}
