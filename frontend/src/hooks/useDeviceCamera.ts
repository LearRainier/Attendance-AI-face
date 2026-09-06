import { useCallback, useEffect, useRef, useState } from "react";

import { cameraSupport, deviceName } from "@/lib/device";

export type CameraFacing = "user" | "environment";
export type DeviceCameraStatus = "idle" | "starting" | "streaming" | "error";

interface UseDeviceCameraOptions {
  enabled: boolean;
  facing: CameraFacing;
  /** The visible preview element. Frames are grabbed from it rather than from
   * a hidden element of our own: iOS Safari refuses to decode video that
   * isn't actually rendered in the document, so the element the user can see
   * is the only one guaranteed to produce pixels. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Frames per second pushed to the backend. */
  fps?: number;
}

/** Longest edge of the uploaded frame. The backend's detector downscales to
 * 480px wide for *detection* anyway (DETECTOR_MAX_WIDTH), but the face chip
 * actually embedded for recognition is cropped from this frame at full
 * resolution — more source pixels per face is the biggest lever on accuracy,
 * so this is pushed as high as a phone uplink can reasonably sustain at
 * `fps` without the upload backing up (see MAX_BUFFERED_BYTES). Sending a
 * phone's full 1080p is still not worth it: the JPEG-encode cost per frame
 * would eat into the fps budget for detail this app doesn't use anywhere. */
const CAPTURE_WIDTH = 960;
const JPEG_QUALITY = 0.8;
/** Skip a frame rather than queue it when the socket is already backed up.
 * On a phone's uplink, queueing is what turns "slightly behind" into a feed
 * that drifts minutes late and never recovers. */
const MAX_BUFFERED_BYTES = 250_000;
/** A refresh on the phone can open the new socket before the server has
 * reaped the old one, which looks like "another device is already streaming".
 * Retry a couple of times before believing it. */
const CLAIM_RETRIES = 3;
const CLAIM_RETRY_DELAY_MS = 700;

export interface DeviceCameraState {
  status: DeviceCameraStatus;
  error: string | null;
  stream: MediaStream | null;
  /** Frames per second actually reaching the backend. */
  sentFps: number;
  retry: () => void;
}

/**
 * Streams this device's camera to the backend for recognition.
 *
 * The phone's camera can't be opened by the Python process (it isn't a local
 * capture device), so the direction is inverted compared to the desktop feed:
 * the browser captures with getUserMedia, JPEG-encodes each sampled frame
 * onto a canvas and pushes it up /ws/ingest. The backend runs its normal
 * detect → track → recognize → log pipeline on those frames, so attendance
 * behaves identically no matter which device is supplying the video.
 *
 * The preview stays local (the caller renders `stream` directly) — the
 * annotated frames are deliberately not sent back down, which is why the
 * dashboard opens /ws/live with `frames=0` in this mode.
 */
export function useDeviceCamera({
  enabled,
  facing,
  videoRef,
  fps = 12,
}: UseDeviceCameraOptions): DeviceCameraState {
  const [status, setStatus] = useState<DeviceCameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [sentFps, setSentFps] = useState(0);
  const [attempt, setAttempt] = useState(0);
  // Set once this device has actually produced a camera stream. The ingest
  // socket is gated on it, because connecting is what takes the pipeline's
  // video away from the server's webcam: claiming that slot and then failing
  // to send anything (permission denied, no camera) would blank the dashboard
  // for everyone and report a stalled stream. Deliberately *not* reset when
  // the front/back choice changes, so flipping cameras keeps the socket — a
  // reconnect there would race the backend's single-streamer claim.
  const [cameraReady, setCameraReady] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);

  const retry = useCallback(() => {
    setError(null);
    setCameraReady(false);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled) setCameraReady(false);
  }, [enabled]);

  // --- the camera itself: re-acquired when the front/back choice changes ---
  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setStream(null);
      return;
    }

    const support = cameraSupport();
    if (!support.supported) {
      setStatus("error");
      setError(support.reason ?? "Camera not supported.");
      return;
    }

    let cancelled = false;
    let acquired: MediaStream | null = null;
    setStatus("starting");

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
        },
        audio: false,
      })
      .then((mediaStream) => {
        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }
        acquired = mediaStream;
        setStream(mediaStream);
        setStatus("streaming");
        setError(null);
        setCameraReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus("error");
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setError("Camera access was blocked. Allow camera permission for this site, then try again.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setError("No camera matching that facing direction was found on this device.");
        } else if (name === "NotReadableError") {
          setError("The camera is already in use by another app.");
        } else {
          setError(err instanceof Error ? err.message : "Could not start this device's camera.");
        }
      });

    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((track) => track.stop());
      setStream(null);
    };
  }, [enabled, facing, attempt]);

  // --- the upload socket: opened only once a camera is actually in hand, and
  // kept across a front/back switch so flipping cameras doesn't drop and
  // re-claim the backend's ingest slot ---
  useEffect(() => {
    if (!enabled || !cameraReady) return;

    let cancelled = false;
    let claimAttempts = 0;
    let retryTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (cancelled) return;
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const label = encodeURIComponent(deviceName());
      const socket = new WebSocket(`${protocol}://${window.location.host}/ws/ingest?label=${label}`);
      socketRef.current = socket;

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as { ok?: boolean; error?: string };
          if (message.ok === false) {
            claimAttempts += 1;
            if (claimAttempts <= CLAIM_RETRIES) {
              retryTimer = setTimeout(connect, CLAIM_RETRY_DELAY_MS);
            } else if (!cancelled) {
              setStatus("error");
              setError(message.error ?? "The backend refused this device's video.");
            }
          }
        } catch {
          // non-JSON control message: nothing we need
        }
      };

      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [enabled, cameraReady, attempt]);

  // --- sampling loop: draw the preview to a canvas, ship it as JPEG ---
  useEffect(() => {
    if (!enabled || !stream) return;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;

    let sentInWindow = 0;
    let windowStart = performance.now();

    const timer = setInterval(() => {
      const video = videoRef.current;
      const socket = socketRef.current;
      if (!video || !socket || socket.readyState !== WebSocket.OPEN) return;
      // readyState < 2 means no frame is decoded yet; bufferedAmount guards
      // against piling frames onto a slow uplink.
      if (video.readyState < 2 || !video.videoWidth) return;
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return;

      const width = Math.min(CAPTURE_WIDTH, video.videoWidth);
      // Keep the capture aspect ratio identical to the preview's: the backend
      // returns boxes in *this* frame's pixel space and the overlay positions
      // them as percentages, so any aspect mismatch would offset every box.
      const height = Math.round((width * video.videoHeight) / video.videoWidth);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.drawImage(video, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          const current = socketRef.current;
          if (blob && current?.readyState === WebSocket.OPEN) {
            current.send(blob);
            sentInWindow += 1;
          }
        },
        "image/jpeg",
        JPEG_QUALITY
      );

      const now = performance.now();
      if (now - windowStart >= 1000) {
        setSentFps((sentInWindow * 1000) / (now - windowStart));
        sentInWindow = 0;
        windowStart = now;
      }
    }, Math.max(1, Math.round(1000 / fps)));

    return () => clearInterval(timer);
  }, [enabled, stream, videoRef, fps]);

  return { status, error, stream, sentFps, retry };
}
