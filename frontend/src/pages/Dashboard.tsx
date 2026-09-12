import { useEffect, useRef, useState } from "react";
import { Activity, CheckCircle2, Clock, LogIn, MonitorPlay, ScanFace, Users, Wifi, WifiOff, XCircle } from "lucide-react";

import { fetchStatus, logManualAttendance } from "@/api";
import { useLiveFeed } from "@/hooks/useLiveFeed";
import { useDeviceCamera, type CameraFacing } from "@/hooks/useDeviceCamera";
import { cameraSupport, isMobileDevice } from "@/lib/device";
import { VideoStage } from "@/components/VideoStage";
import { CameraControls, type CameraMode } from "@/components/CameraControls";
import { Toast } from "@/components/Toast";
import { KpiCard } from "@/components/KpiCard";
import { PersonCombobox } from "@/components/PersonCombobox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

interface DashboardProps {
  onEnterKiosk?: () => void;
}

export function Dashboard({ onEnterKiosk }: DashboardProps = {}) {
  // On a phone or tablet the backend's webcam is on some other machine
  // entirely, so this device's own camera is the sensible default source —
  // that's the whole point of opening the dashboard on a phone.
  const [mobile] = useState(isMobileDevice);
  const [support] = useState(cameraSupport);
  const [cameraMode, setCameraMode] = useState<CameraMode>(
    mobile && support.supported ? "device" : "server"
  );
  const [facing, setFacing] = useState<CameraFacing>("user");
  const previewRef = useRef<HTMLVideoElement | null>(null);

  const deviceMode = cameraMode === "device";
  // In device mode this client supplies the video, so it doesn't need the
  // annotated frames streamed back to it.
  const { state, connected } = useLiveFeed({ includeFrames: !deviceMode });
  const deviceCamera = useDeviceCamera({
    enabled: deviceMode,
    facing,
    videoRef: previewRef,
  });

  const [people, setPeople] = useState<string[]>([]);
  const [selectedName, setSelectedName] = useState<string>("");
  const [manualBusy, setManualBusy] = useState<"IN" | "OUT" | null>(null);
  const [manualMessage, setManualMessage] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  // Failure of the camera *request* itself (switch/scan call). The backend's
  // own camera trouble arrives on the live feed as state.camera_error.
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus()
      .then((status) => {
        const names = status.people.map((p) => p.name);
        setPeople(names);
        setSelectedName((prev) => prev || names[0] || "");
      })
      .catch(() => {
        /* manual-entry panel just stays empty on a transient failure */
      });
  }, []);

  useEffect(() => {
    setManualMessage(null);
    setManualError(null);
  }, [selectedName]);

  const handleManualEvent = async (eventType: "IN" | "OUT") => {
    if (!selectedName) return;
    setManualBusy(eventType);
    setManualError(null);
    setManualMessage(null);
    try {
      const result = await logManualAttendance(selectedName, eventType);
      const label = eventType === "IN" ? "timed in" : "timed out";
      const time = new Date(result.timestamp.replace(" ", "T")).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      setManualMessage(`${result.name} ${label} manually at ${time}.`);
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "Failed to log attendance.");
    } finally {
      setManualBusy(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <img
            src="/shc logo.png"
            alt="SHC Logo"
            className="size-11 object-contain shrink-0 drop-shadow-xs"
          />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">SHC MG Live Dashboard</h1>
            <p className="text-sm text-muted-foreground">Real-time recognition feed and attendance activity</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {state.schedule_closed ? (
            <Badge variant="outline" className="gap-1.5 py-1 border-amber-500/40 bg-amber-500/10 text-amber-400">
              <Clock className="size-3" />
              Closed
            </Badge>
          ) : (
            <Badge variant={connected ? "success" : "secondary"} className="gap-1.5 py-1">
              {connected ? (
                <>
                  <span className="size-1.5 animate-live-pulse rounded-full bg-success-foreground" />
                  Live
                </>
              ) : (
                <>
                  <WifiOff className="size-3" />
                  Connecting…
                </>
              )}
            </Badge>
          )}

          {onEnterKiosk && (
            <Button
              onClick={onEnterKiosk}
              size="sm"
              className="gap-1.5 cursor-pointer font-medium shadow-xs"
            >
              <MonitorPlay className="size-4" />
              Launch Kiosk
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Active Targets" value={String(state.tracks.length)} icon={ScanFace} />
        <KpiCard label="Registered Faces" value={String(state.registered_count)} icon={Users} />
        <KpiCard label="Frame Rate" value={`${state.fps.toFixed(1)} fps`} icon={Activity} />
        <KpiCard label="Connection" value={connected ? "Online" : "Offline"} icon={Wifi} />
      </div>

      <div className="grid flex-1 gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="border-b px-5 py-4">
            <CardTitle>Live Feed</CardTitle>
            <CardDescription>
              {deviceMode
                ? "This device's camera · YuNet detection + ArcFace recognition"
                : "YuNet face detection + ArcFace recognition"}
            </CardDescription>
            <CardAction>
              <CameraControls
                mode={cameraMode}
                onModeChange={setCameraMode}
                deviceCameraSupported={support.supported}
                facing={facing}
                onFacingChange={setFacing}
                deviceStatus={deviceCamera.status}
                liveSource={state.camera_source}
                sourceLabel={state.source_label}
                selectedIndex={state.camera_index}
                active={state.camera_active}
                onError={setCameraError}
              />
            </CardAction>
          </CardHeader>
          <div className="relative flex min-h-[360px] flex-1">
            <VideoStage
              frame={state.frame}
              connected={connected}
              tracks={state.tracks}
              hints={state.hints}
              // In device mode the detailed reason (plus a retry button) lives
              // in the alert below, so the stage itself only needs a caption.
              error={deviceMode ? null : (cameraError ?? state.camera_error)}
              stream={deviceMode ? deviceCamera.stream : null}
              // A rear camera shows the world, not a selfie — don't mirror it
              // (and TrackOverlay has to match, or every box lands on the
              // wrong side of the frame).
              mirrored={!deviceMode || facing === "user"}
              videoRef={previewRef}
              sourceSize={
                state.frame_width && state.frame_height
                  ? { width: state.frame_width, height: state.frame_height }
                  : null
              }
              statusMessage={
                !deviceMode
                  ? null
                  : deviceCamera.status === "starting"
                    ? "Starting this device's camera…"
                    : deviceCamera.status === "error"
                      ? "This device's camera isn't available."
                      : null
              }
              scheduleClosed={state.schedule_closed}
              scheduleMessage={state.schedule_message}
            />
            <Toast toast={state.toast} />
          </div>
          {deviceMode && deviceCamera.error && (
            <Alert variant="destructive" className="m-3">
              <XCircle />
              <AlertDescription className="flex flex-col items-start gap-2">
                <span>{deviceCamera.error}</span>
                <Button variant="outline" size="sm" onClick={deviceCamera.retry}>
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b px-5 py-4">
              <CardTitle>Recent Check-ins</CardTitle>
              <CardDescription>Latest logged attendance</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 px-3 py-3">
              {state.recent_checkins.length > 0 ? (
                [...state.recent_checkins]
                  .reverse()
                  .map(([name, time], i) => (
                    <div
                      key={`${name}-${time}-${i}`}
                      className={cn("flex items-center gap-3 rounded-lg px-2 py-2", i === 0 && "bg-accent/60")}
                    >
                      <Avatar className="size-8">
                        <AvatarFallback>{initials(name)}</AvatarFallback>
                      </Avatar>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">{name}</span>
                      </div>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" />
                        {time}
                      </span>
                    </div>
                  ))
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
                  <Users className="size-6 opacity-50" />
                  No check-ins yet
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Manual Time In</CardTitle>
              <CardDescription>Fallback for when face recognition isn&apos;t practical</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dashboard-manual-person">Person</Label>
                <PersonCombobox
                  id="dashboard-manual-person"
                  people={people}
                  value={selectedName}
                  onChange={setSelectedName}
                  placeholder="Search for a person…"
                />
              </div>

              <div>
                <Button
                  className="w-full"
                  onClick={() => handleManualEvent("IN")}
                  disabled={!selectedName || manualBusy !== null || Boolean(state.schedule_closed)}
                >
                  <LogIn className="size-4" />
                  {manualBusy === "IN" ? "Timing in…" : "Time In"}
                </Button>
              </div>

              {state.schedule_closed && (
                <p className="text-xs text-amber-500/90 font-medium text-center">
                  {state.schedule_message || "Check-in is currently closed."}
                </p>
              )}

              {manualMessage && (
                <Alert variant="success">
                  <CheckCircle2 />
                  <AlertDescription>{manualMessage}</AlertDescription>
                </Alert>
              )}
              {manualError && (
                <Alert variant="destructive">
                  <XCircle />
                  <AlertDescription>{manualError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
