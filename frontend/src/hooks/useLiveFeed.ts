import { useEffect, useRef, useState } from "react";
import type { LiveState } from "../types";

const EMPTY_STATE: LiveState = {
  frame: null,
  tracks: [],
  hints: [],
  frame_width: 0,
  frame_height: 0,
  toast: null,
  fps: 0,
  registered_count: 0,
  recent_checkins: [],
  camera_index: null,
  camera_active: false,
  camera_error: null,
  camera_source: "local",
  source_label: null,
};

interface UseLiveFeedOptions {
  /** Set false when this client is the one *supplying* the video (see
   * useDeviceCamera): the backend then sends state without the JPEG, so a
   * phone isn't paying to download its own frames back. */
  includeFrames?: boolean;
}

/** Opens /ws/live and keeps the latest broadcast state in React state,
 * reconnecting automatically if the backend restarts or drops the socket. */
export function useLiveFeed({ includeFrames = true }: UseLiveFeedOptions = {}) {
  const [state, setState] = useState<LiveState>(EMPTY_STATE);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (cancelled) return;

      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const query = includeFrames ? "" : "?frames=0";
      const socket = new WebSocket(`${protocol}://${window.location.host}/ws/live${query}`);
      wsRef.current = socket;

      socket.onopen = () => setConnected(true);

      socket.onmessage = (event) => {
        try {
          setState(JSON.parse(event.data) as LiveState);
        } catch {
          // ignore a malformed frame, next one will arrive shortly
        }
      };

      socket.onclose = () => {
        setConnected(false);
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, 1000);
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [includeFrames]);

  return { state, connected };
}
