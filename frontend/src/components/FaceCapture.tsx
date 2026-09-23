import { useEffect, useRef, useState, type RefObject } from "react";
import { ScanFace, UserPlus } from "lucide-react";

import { detectFaces, pauseBackendCamera, resumeBackendCamera, type DetectResponse } from "@/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const DETECT_INTERVAL_MS = 600;

type FaceStatus = "none" | "single" | "multiple" | "too_far" | "too_close";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Maps the /api/register/detect response's face boxes (in raw-frame pixel
 * space) onto the video element's actual rendered rect, using the same
 * "cover" scale/crop math as the video's own object-cover CSS. Without
 * this, a box computed as a plain percentage of the container would drift
 * off the real face whenever the container's aspect ratio doesn't exactly
 * match the camera's native frame. */
function useCoverRect(containerRef: RefObject<HTMLDivElement | null>, natural: { width: number; height: number }) {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !natural.width || !natural.height) {
      setRect(null);
      return;
    }

    const recompute = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (!cw || !ch) return;
      const scale = Math.max(cw / natural.width, ch / natural.height);
      const width = natural.width * scale;
      const height = natural.height * scale;
      setRect({ width, height, left: (cw - width) / 2, top: (ch - height) / 2 });
    };

    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, natural.width, natural.height]);

  return rect;
}

function guideColor(status: FaceStatus): string {
  if (status === "single") return "var(--success)";
  if (status === "multiple") return "var(--destructive)";
  if (status === "too_far" || status === "too_close") return "var(--warning)";
  return "var(--muted-foreground)";
}

function statusMessage(status: FaceStatus): string {
  if (status === "single") return "Face detected — ready to capture";
  if (status === "multiple") return "Multiple faces detected — only one person at a time";
  if (status === "too_far") return "Too far away — step closer to the camera";
  if (status === "too_close") return "Too close — step back a little";
  return "No face detected — center your face in the guide";
}

function badgeVariant(status: FaceStatus): "success" | "destructive" | "warning" | "secondary" {
  if (status === "single") return "success";
  if (status === "multiple") return "destructive";
  if (status === "too_far" || status === "too_close") return "warning";
  return "secondary";
}

export interface FaceCaptureProps {
  /** Called with a JPEG data URL once the user clicks Capture while exactly
   * one well-positioned face is in frame — the button is disabled otherwise,
   * so this only ever fires with a valid single-face frame. */
  onCapture: (imageB64: string) => void;
  /** True while the parent's own async use of the captured image (e.g. the
   * /api/register call) is in flight — shows busyLabel and disables the button. */
  busy?: boolean;
  busyLabel?: string;
  captureLabel?: string;
  /** Extra external condition that also blocks capture (e.g. no name entered yet). */
  captureBlocked?: boolean;
  captureBlockedHint?: string;
}

/** Self-contained browser-camera capture widget: acquires getUserMedia on
 * mount (pausing the backend's own camera hold first, resuming it on
 * unmount), polls a lightweight face-count/box preview, and renders a
 * positioning guide + live detection box + status badge. Used by both the
 * Register page and User Management's "Open camera" flow so the guide/gate
 * behavior stays identical everywhere a face gets captured. */
export function FaceCapture({
  onCapture,
  busy = false,
  busyLabel = "Saving…",
  captureLabel = "Capture Template",
  captureBlocked = false,
  captureBlockedHint,
}: FaceCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const detectingRef = useRef(false);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [faceBoxes, setFaceBoxes] = useState<[number, number, number, number][]>([]);
  const [outOfRange, setOutOfRange] = useState<DetectResponse["out_of_range"]>([]);
  const [detectDims, setDetectDims] = useState({ width: 0, height: 0 });

  // Out-of-range faces only decide the message when there's no usable face
  // in frame — a valid capture shouldn't be blocked because someone else is
  // visible in the background.
  const faceStatus: FaceStatus =
    faceBoxes.length > 1
      ? "multiple"
      : faceBoxes.length === 1
        ? "single"
        : outOfRange.some((hint) => hint.reason === "too_close")
          ? "too_close"
          : outOfRange.some((hint) => hint.reason === "too_far")
            ? "too_far"
            : "none";

  const rect = useCoverRect(containerRef, detectDims);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      // Ask the backend to let go of the webcam first — it holds it
      // continuously for the live dashboard feed, so the browser's own
      // getUserMedia below can otherwise fail to acquire an already-open
      // camera on some drivers.
      try {
        await pauseBackendCamera();
      } catch {
        // Best-effort: still try to acquire the camera even if this fails.
      }
      if (cancelled) return;

      try {
        // Ask for the highest resolution the webcam offers ("ideal" lets the
        // browser pick the closest supported mode instead of failing outright
        // on a camera that can't do exactly this). The captured frame is what
        // gets embedded — more source pixels per face is the biggest lever on
        // recognition accuracy, and this capture only ever produces a handful
        // of still frames, so the extra bandwidth costs nothing.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        setCameraError(
          "Could not access the webcam from the browser. " +
            (err instanceof Error ? err.message : String(err))
        );
      }
    };

    start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/camera/resume");
        }
      } catch {}
      resumeBackendCamera().catch(() => {});
    };
  }, []);

  // Live face-count/box preview: poll the backend's lightweight detection
  // endpoint (no DeepFace/embedding work) so the guide box and the
  // single-face gate stay in sync with what's actually in frame right now.
  // It runs the same face + distance gate as the live dashboard, so a
  // template can't be captured at a distance recognition would later refuse.
  useEffect(() => {
    if (cameraError) return;

    const id = window.setInterval(async () => {
      if (detectingRef.current) return;
      const video = videoRef.current;
      const canvas = detectCanvasRef.current;
      if (!video || !canvas || video.videoWidth === 0) return;

      detectingRef.current = true;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        detectingRef.current = false;
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageB64 = canvas.toDataURL("image/jpeg", 0.7);

      try {
        const result = await detectFaces(imageB64);
        setFaceBoxes(result.faces);
        setOutOfRange(result.out_of_range ?? []);
        setDetectDims({ width: result.width, height: result.height });
      } catch {
        // Transient — keep showing the last known state instead of flapping.
      } finally {
        detectingRef.current = false;
      }
    }, DETECT_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [cameraError]);

  const handleCaptureClick = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL("image/jpeg", 0.92));
  };

  const captureDisabled = busy || !!cameraError || faceStatus !== "single" || captureBlocked;

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={containerRef}
        className="relative flex aspect-4/3 w-full items-center justify-center overflow-hidden rounded-lg bg-black"
      >
        {cameraError ? (
          <div className="px-6 text-center text-sm text-white/90">{cameraError}</div>
        ) : (
          <>
            {/* Flip wrapper: the video is mirrored for a natural "selfie"
                view, but face-box coordinates come back in raw (unmirrored)
                frame space — nesting the boxes inside the same flipped
                wrapper as the video keeps them pinned to the real face
                instead of drifting to the wrong side. */}
            <div className="absolute inset-0 -scale-x-100">
              <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
              {rect && (
                <div
                  className="pointer-events-none absolute"
                  style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
                >
                  {faceBoxes.map(([x, y, w, h], i) => (
                    <div
                      key={i}
                      className="absolute rounded-sm border-2 transition-colors duration-150"
                      style={{
                        left: `${(x / detectDims.width) * 100}%`,
                        top: `${(y / detectDims.height) * 100}%`,
                        width: `${(w / detectDims.width) * 100}%`,
                        height: `${(h / detectDims.height) * 100}%`,
                        borderColor: guideColor(faceStatus),
                      }}
                    />
                  ))}
                  {outOfRange.map(({ bbox: [x, y, w, h] }, i) => (
                    <div
                      key={`out-${i}`}
                      className="absolute rounded-sm border-2 border-dashed opacity-70"
                      style={{
                        left: `${(x / detectDims.width) * 100}%`,
                        top: `${(y / detectDims.height) * 100}%`,
                        width: `${(w / detectDims.width) * 100}%`,
                        height: `${(h / detectDims.height) * 100}%`,
                        borderColor: "var(--warning)",
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Guide range — a symmetric oval, so it reads the same
                whether or not it sits inside the mirrored wrapper. */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className="h-[72%] w-[54%] rounded-[50%] border-2 border-dashed transition-colors duration-150"
                style={{ borderColor: guideColor(faceStatus), opacity: 0.8 }}
              />
            </div>

            <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center px-3">
              <Badge variant={badgeVariant(faceStatus)} className="gap-1.5 py-1">
                <ScanFace className="size-3.5" />
                {statusMessage(faceStatus)}
              </Badge>
            </div>
          </>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={detectCanvasRef} className="hidden" />

      <Button onClick={handleCaptureClick} disabled={captureDisabled} size="lg">
        <UserPlus className="size-4" />
        {busy ? busyLabel : captureLabel}
      </Button>
      {captureBlocked && captureBlockedHint && (
        <p className="text-xs text-muted-foreground">{captureBlockedHint}</p>
      )}
    </div>
  );
}
