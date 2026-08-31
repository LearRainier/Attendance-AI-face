import { useEffect, useRef, useState } from "react";
import { CameraOff } from "lucide-react";

import type { RangeHint, Track } from "@/types";
import { TrackOverlay } from "@/components/TrackOverlay";

interface VideoStageProps {
  frame: string | null;
  connected: boolean;
  tracks: Track[];
  hints?: RangeHint[];
  /** Why there's no picture, when the backend knows (camera unplugged, held
   * by another app, delivering no frames). Shown instead of the generic
   * "waiting for camera" so a bad camera selection is obvious. */
  error?: string | null;
  /** This device's own camera, when it's the one supplying the video (see
   * useDeviceCamera). Rendered locally instead of `frame`: the phone already
   * has these pixels, so round-tripping them through the backend would only
   * add latency and double its bandwidth. */
  stream?: MediaStream | null;
  /** Set false for a rear-facing camera — mirroring is only natural for a
   * selfie view, and the overlay has to agree with the picture. */
  mirrored?: boolean;
  /** Populated with the preview element when `stream` is rendered, so the
   * caller can sample frames from the element the user actually sees (iOS
   * won't decode video that isn't rendered). */
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  /** Shown over the stage while this device's camera is starting up. */
  statusMessage?: string | null;
  /** Pixel size of the frame the backend computed `tracks` on. Track boxes
   * are in *that* space, which is not the displayed media's space when this
   * device previews its camera at full resolution and uploads a smaller copy
   * — without it, every box would be drawn at the wrong scale. Falls back to
   * the measured media size (correct for the backend's own webcam feed,
   * where the two are the same frame). */
  sourceSize?: { width: number; height: number } | null;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Renders the live camera frame and positions TrackOverlay boxes on top of
 * it. The container can be any aspect ratio, so the frame is letterboxed
 * (like object-fit: contain) — both the media element and the overlay are
 * placed at an identically ResizeObserver-measured pixel rect rather than
 * each independently assuming they fill the container, which is what
 * previously let the tracking box drift off the actual face whenever the
 * container's aspect ratio didn't match the camera frame's.
 *
 * Two sources render through the same geometry: a JPEG pushed down from the
 * backend's webcam, or this device's own MediaStream. Because the overlay
 * works in percentages of the media's natural size, boxes computed on the
 * backend's (downscaled) copy of a phone frame still land correctly on the
 * phone's full-resolution preview.
 */
export function VideoStage({
  frame,
  connected,
  tracks,
  hints = [],
  error = null,
  stream = null,
  mirrored = true,
  videoRef,
  statusMessage = null,
  sourceSize = null,
}: VideoStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
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
      const scale = Math.min(cw / natural.width, ch / natural.height);
      const width = natural.width * scale;
      const height = natural.height * scale;
      setRect({ width, height, left: (cw - width) / 2, top: (ch - height) / 2 });
    };

    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    return () => observer.disconnect();
  }, [natural.width, natural.height]);

  // Attach the local stream, and reset the measured size when it changes so a
  // front/back camera switch (different resolution) is re-measured.
  useEffect(() => {
    const video = videoRef?.current ?? localVideoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      setNatural({ width: 0, height: 0 });
    }
  }, [stream, videoRef]);

  const hasPicture = stream ? true : Boolean(frame);

  if (!hasPicture) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-black px-6 text-center text-sm">
        {statusMessage ? (
          <span className="text-neutral-300">{statusMessage}</span>
        ) : connected && error ? (
          <>
            <CameraOff className="size-6 text-destructive" />
            <span className="max-w-sm text-neutral-300">{error}</span>
          </>
        ) : (
          <span className="text-neutral-400">{connected ? "Waiting for camera…" : "Connecting to backend…"}</span>
        )}
      </div>
    );
  }

  const mediaStyle = rect
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : { opacity: 0 };

  return (
    <div ref={containerRef} className="relative flex-1 overflow-hidden bg-black">
      {stream ? (
        <video
          ref={(element) => {
            localVideoRef.current = element;
            if (videoRef) videoRef.current = element;
          }}
          // muted + playsInline are what let iOS play inline instead of
          // hijacking the screen with a fullscreen player.
          autoPlay
          muted
          playsInline
          className={mirrored ? "absolute -scale-x-100" : "absolute"}
          style={mediaStyle}
          onLoadedMetadata={(e) => {
            const video = e.currentTarget;
            setNatural({ width: video.videoWidth, height: video.videoHeight });
          }}
        />
      ) : (
        <img
          src={frame ?? undefined}
          alt="Live camera feed"
          className={mirrored ? "absolute -scale-x-100" : "absolute"}
          style={mediaStyle}
          onLoad={(e) => {
            const img = e.currentTarget;
            setNatural({ width: img.naturalWidth, height: img.naturalHeight });
          }}
        />
      )}
      {rect && (
        <div className="absolute" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
          <TrackOverlay
            tracks={tracks}
            hints={hints}
            naturalWidth={sourceSize?.width || natural.width}
            naturalHeight={sourceSize?.height || natural.height}
            mirrored={mirrored}
          />
        </div>
      )}
    </div>
  );
}
