import { useEffect, useState } from "react";
import { CheckCircle2, Clock, ShieldCheck, Wifi, WifiOff } from "lucide-react";

import { useLiveFeed } from "@/hooks/useLiveFeed";
import { resumeBackendCamera } from "@/api";
import { VideoStage } from "@/components/VideoStage";
import { Toast } from "@/components/Toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Footer } from "@/components/Footer";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

interface KioskProps {
  onExitKiosk?: () => void;
}

export function Kiosk({ onExitKiosk }: KioskProps = {}) {
  const { state, connected } = useLiveFeed({ includeFrames: true });
  const [currentTime, setCurrentTime] = useState<string>("");
  const [currentDate, setCurrentDate] = useState<string>("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        })
      );
      setCurrentDate(
        now.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      );
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    resumeBackendCamera().catch(() => {});
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      {/* Top Kiosk Header */}
      <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 sm:px-6 py-2.5 bg-card/60 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <img
            src="/shc logo.png"
            alt="SHC Logo"
            className="size-10 sm:size-11 object-contain shrink-0 drop-shadow-xs"
          />
          <div>
            <h1 className="text-base sm:text-lg font-bold leading-tight tracking-tight">
              SHC MG Face Attendance System
            </h1>
            <p className="text-xs text-muted-foreground">Contactless Facial Recognition Check-In</p>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 ml-auto">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-semibold tracking-wide font-mono">{currentTime}</div>
            <div className="text-[11px] text-muted-foreground">{currentDate}</div>
          </div>

          {state.schedule_closed ? (
            <Badge variant="outline" className="gap-1.5 py-1 px-2.5 border-amber-500/40 bg-amber-500/10 text-amber-400">
              <Clock className="size-3.5" />
              <span>Check-in Closed</span>
            </Badge>
          ) : (
            <Badge variant={connected ? "default" : "outline"} className="gap-1.5 py-1 px-2.5">
              {connected ? <Wifi className="size-3.5 text-success" /> : <WifiOff className="size-3.5 text-destructive" />}
              <span className="hidden xs:inline">{connected ? "System Online" : "Connecting..."}</span>
            </Badge>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (onExitKiosk) {
                onExitKiosk();
              } else {
                window.location.href = "/";
              }
            }}
            className="shrink-0 gap-2 border-primary/30 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground font-medium shadow-xs cursor-pointer"
            title="Enter Admin Portal"
          >
            <ShieldCheck className="size-4" />
            <span>Enter Admin Portal</span>
          </Button>
        </div>
      </header>

      {/* Main Kiosk Layout */}
      <main className="flex flex-1 flex-col lg:flex-row gap-6 p-6 max-w-7xl mx-auto w-full">
        {/* Left Column: Video Stage & Scanner */}
        <div className="flex flex-1 flex-col gap-4">
          <div className="relative overflow-hidden rounded-xl border border-border bg-black shadow-sm flex-1 min-h-[480px] w-full flex flex-col">
            <VideoStage
              frame={state.frame}
              tracks={state.tracks}
              hints={state.hints}
              sourceSize={
                state.frame_width && state.frame_height
                  ? { width: state.frame_width, height: state.frame_height }
                  : null
              }
              connected={connected}
              error={state.camera_error}
              scheduleClosed={state.schedule_closed}
              scheduleMessage={state.schedule_message}
            />

            <Toast toast={state.toast} />
          </div>

          <div className="flex items-center justify-between px-2 text-xs text-muted-foreground">
            {state.schedule_closed ? (
              <span className="flex items-center gap-1.5 text-amber-400/90 font-medium">
                <Clock className="size-4 text-amber-400" /> Attendance Closed (Standby Mode)
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-primary" /> Active Liveness Detection Enabled
              </span>
            )}
            <span>{state.registered_count} Enrolled Students</span>
          </div>
        </div>

        {/* Right Column: Instructions & Live Feed of Recent Check-ins */}
        <div className="w-full lg:w-84 flex flex-col gap-5">
          {/* Instructions Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">How to Check In</CardTitle>
              <CardDescription className="text-xs">Follow the onscreen prompts</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5 text-xs text-muted-foreground">
              <div className="flex items-start gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                  1
                </span>
                <span>Stand within 1 meter and look directly at the camera.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                  2
                </span>
                <span>When prompted, perform the gesture (Smile or Turn Head).</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                  3
                </span>
                <span>Wait for the green confirmation banner.</span>
              </div>
            </CardContent>
          </Card>

          {/* Recent Check-Ins Card */}
          <Card className="flex-1 flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Clock className="size-4 text-primary" /> Today&apos;s Check-ins
                </CardTitle>
                <Badge variant="outline" className="text-[10px] font-mono">
                  {state.recent_checkins.length}
                </Badge>
              </div>
              <CardDescription className="text-xs">Live activity at this station</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              {state.recent_checkins.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-xs text-muted-foreground">
                  <Clock className="size-6 opacity-40 mb-1.5" />
                  <span>No check-ins yet today.</span>
                </div>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {state.recent_checkins.map(([name, time], idx) => (
                    <li
                      key={`${name}-${time}-${idx}`}
                      className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 p-2.5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar className="size-7 shrink-0 text-xs">
                          <AvatarFallback className="bg-primary/10 text-primary text-[11px]">
                            {initials(name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs font-medium truncate">{name}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0 font-mono">
                        <CheckCircle2 className="size-3 text-success" />
                        {time}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer className="mt-auto" />
    </div>
  );
}
