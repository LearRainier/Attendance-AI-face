import { CheckCircle2 } from "lucide-react";
import type { ToastState } from "@/types";

interface ToastProps {
  toast: ToastState | null;
}

/** Slide-in/out check-in notification. Keying on start_time forces a fresh
 * mount (and re-triggers the animate-toast-slide animation) every time the
 * backend reports a new toast; the backend clears `toast` after 3s, at
 * which point this simply unmounts. */
export function Toast({ toast }: ToastProps) {
  if (!toast) return null;

  return (
    <div
      key={toast.start_time}
      className="animate-toast-slide absolute top-4 right-4 flex items-start gap-3 rounded-lg border border-success/40 bg-card px-4 py-3 shadow-lg"
    >
      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
      <div className="flex flex-col">
        <span className="text-sm font-semibold">Thank you, {toast.name}!</span>
        <span className="text-xs text-muted-foreground">Attendance logged successfully</span>
      </div>
    </div>
  );
}
