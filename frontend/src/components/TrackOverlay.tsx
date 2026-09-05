import type { CSSProperties } from "react";
import type { RangeHint, Track } from "@/types";

interface TrackOverlayProps {
  tracks: Track[];
  /** Faces the backend saw but refused to scan because they're outside the
   * detection range. Drawn dimmed and dashed so they read as "seen but
   * ignored", clearly distinct from a real track. */
  hints?: RangeHint[];
  naturalWidth: number;
  naturalHeight: number;
  /** The video/image is displayed mirrored (selfie-style), but track boxes
   * come back from the backend in raw (unmirrored) frame space. Mirroring
   * the box's X position directly here — rather than wrapping this whole
   * component in a CSS `scaleX(-1)` — keeps the per-track status text
   * upright and readable instead of flipping backwards with everything else. */
  mirrored?: boolean;
}

import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ShieldAlert, Smile } from "lucide-react";

function statusColor(label: string, livenessState?: string | null, isSpoof?: boolean): string {
  if (isSpoof || label === "Spoof Detected") return "var(--destructive)";
  if (livenessState === "failed" || label === "Liveness Failed") return "var(--destructive)";
  if (livenessState === "challenge") return "var(--warning)";
  if (livenessState === "already_logged" || label.includes("(Already Logged Today)")) return "var(--primary)";
  if (label === "Scanning...") return "var(--primary)";
  if (label === "Unknown") return "var(--destructive)";
  if (label === "Error" || label === "No Face Detected") return "var(--muted-foreground)";
  if (livenessState === "passed") return "var(--success)";
  return "var(--primary)";
}

function renderStatusContent(track: Track) {
  if (track.label === "Spoof Detected" || track.is_spoof) {
    return (
      <span className="flex items-center gap-1.5 font-semibold text-destructive">
        <ShieldAlert className="size-3.5" />
        <span>Spoof / Screen detected</span>
      </span>
    );
  }

  if (track.liveness_state === "failed" || track.label === "Liveness Failed") {
    return (
      <span className="flex items-center gap-1.5 font-medium text-destructive">
        <AlertTriangle className="size-3.5" />
        <span>Liveness challenge failed</span>
      </span>
    );
  }

  if (track.liveness_state === "already_logged" || track.label.includes("(Already Logged Today)")) {
    const cleanName = track.label.replace(/\s*\(Already Logged Today\)/, "").trim();
    return (
      <span className="flex items-center gap-1.5 font-medium text-primary">
        <CheckCircle2 className="size-3.5" />
        <span>{cleanName} · Already Logged Today</span>
      </span>
    );
  }

  if (track.liveness_state === "challenge") {
    const seconds = track.challenge_seconds_left ? `${track.challenge_seconds_left}s` : "";
    return (
      <span className="flex items-center gap-1.5 font-medium text-warning">
        {track.challenge === "smile" && <Smile className="size-3.5" />}
        {track.challenge === "turn_left" && <ArrowLeft className="size-3.5" />}
        {track.challenge === "turn_right" && <ArrowRight className="size-3.5" />}
        <span>{track.challenge_text || "Please follow prompt"}</span>
        {seconds && <span className="opacity-80 text-[10px] font-mono">({seconds})</span>}
      </span>
    );
  }

  if (track.label === "Scanning...") {
    return (
      <span>
        {track.progress !== null ? `Scanning… ${track.progress}%` : "Scanning…"}
      </span>
    );
  }

  if (track.label === "Unknown") return <span>Unknown</span>;
  if (track.label === "Error" || track.label === "No Face Detected") return <span>Detection error</span>;

  if (track.liveness_state === "passed") {
    return (
      <span className="flex items-center gap-1.5 text-success font-medium">
        <CheckCircle2 className="size-3.5" />
        <span>{track.label} · Logged In</span>
      </span>
    );
  }

  return <span>{track.label}</span>;
}

/** Draws per-track bounding boxes, corner brackets, a scanning sweep, and
 * status banners. Box coordinates are native camera pixels, expressed as
 * percentages of the frame's natural size — VideoStage guarantees this
 * component's own box is always sized to exactly match the rendered image,
 * so these percentages land pixel-for-pixel on the face regardless of the
 * surrounding layout. */
export function TrackOverlay({
  tracks,
  hints = [],
  naturalWidth,
  naturalHeight,
  mirrored = true,
}: TrackOverlayProps) {
  if (!naturalWidth || !naturalHeight) return null;

  const boxPosition = (bbox: [number, number, number, number]): CSSProperties => {
    const [x, y, w, h] = bbox;
    return {
      left: `${(mirrored ? (naturalWidth - x - w) / naturalWidth : x / naturalWidth) * 100}%`,
      top: `${(y / naturalHeight) * 100}%`,
      width: `${(w / naturalWidth) * 100}%`,
      height: `${(h / naturalHeight) * 100}%`,
    };
  };

  return (
    <div className="pointer-events-none absolute inset-0">
      {hints.map((hint, i) => (
        <div
          key={`hint-${i}`}
          className="absolute rounded-sm border-2 border-dashed opacity-70"
          style={{ ...boxPosition(hint.bbox), borderColor: "var(--warning)" }}
        >
          <div className="absolute top-full left-0 mt-0.5 w-max rounded-sm bg-popover/90 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-popover-foreground shadow-sm backdrop-blur-sm">
            {hint.reason === "too_far" ? "Too far — step closer" : "Too close — step back"}
          </div>
        </div>
      ))}
      {tracks.map((track) => {
        const color = statusColor(track.label, track.liveness_state, track.is_spoof);
        const scanning = track.status === "processing" || track.label === "Scanning...";

        const style: CSSProperties = {
          ...boxPosition(track.bbox),
          ["--track-color" as string]: color,
        };

        return (
          <div
            key={track.track_id}
            className="absolute border-[1.5px]"
            style={{ ...style, borderColor: "color-mix(in oklch, var(--track-color) 65%, transparent)" }}
          >
            <span
              className="absolute -top-px -left-px size-4 border-t-2 border-l-2"
              style={{ borderColor: "var(--track-color)" }}
            />
            <span
              className="absolute -top-px -right-px size-4 border-t-2 border-r-2"
              style={{ borderColor: "var(--track-color)" }}
            />
            <span
              className="absolute -bottom-px -left-px size-4 border-b-2 border-l-2"
              style={{ borderColor: "var(--track-color)" }}
            />
            <span
              className="absolute -bottom-px -right-px size-4 border-b-2 border-r-2"
              style={{ borderColor: "var(--track-color)" }}
            />
            {scanning && <span className="track-box__laser" />}
            <div
              className="absolute top-full left-0 min-h-6 w-max max-w-[calc(200%)] rounded-b-sm border border-t-0 bg-popover/95 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-popover-foreground shadow-sm backdrop-blur-sm"
              style={{ borderColor: "var(--track-color)" }}
            >
              {renderStatusContent(track)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
