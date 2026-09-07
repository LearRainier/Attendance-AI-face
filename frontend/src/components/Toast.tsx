import { CheckCircle2, Clock } from "lucide-react";
import type { ToastState } from "@/types";
import { cn } from "@/lib/utils";

interface ToastProps {
  toast: ToastState | null;
}

/** Slide-in/out check-in notification with status (Clean vs Late). */
export function Toast({ toast }: ToastProps) {
  if (!toast) return null;

  const isLate = toast.status === "LATE";

  return (
    <div
      key={toast.start_time}
      className={cn(
        "animate-toast-slide absolute top-4 right-4 flex items-start gap-3 rounded-lg border bg-card px-4 py-3 shadow-lg z-50",
        isLate ? "border-warning/60 bg-warning/5" : "border-success/40"
      )}
    >
      {isLate ? (
        <Clock className="mt-0.5 size-5 shrink-0 text-warning" />
      ) : (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
      )}
      <div className="flex flex-col">
        <span className="text-sm font-semibold">
          {isLate ? `Welcome, ${toast.name}!` : `Thank you, ${toast.name}!`}
        </span>
        <span
          className={cn(
            "text-xs font-medium",
            isLate ? "text-warning" : "text-muted-foreground"
          )}
        >
          {isLate ? "Attendance logged (Late Check-in)" : "Attendance logged on time"}
        </span>
      </div>
    </div>
  );
}
