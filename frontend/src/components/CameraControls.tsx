import { Monitor, RefreshCcw, Smartphone } from "lucide-react";

import { CameraPicker } from "@/components/CameraPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { CameraFacing, DeviceCameraStatus } from "@/hooks/useDeviceCamera";

export type CameraMode = "server" | "device";

interface CameraControlsProps {
  /** What *this* browser is doing — not what the backend reports, since
   * another device may be the one streaming. */
  mode: CameraMode;
  onModeChange: (mode: CameraMode) => void;
  /** Whether this browser can capture at all (secure context + API). */
  deviceCameraSupported: boolean;
  facing: CameraFacing;
  onFacingChange: (facing: CameraFacing) => void;
  deviceStatus: DeviceCameraStatus;
  /** Backend's view of the frame source, from the live feed. */
  liveSource: "local" | "browser";
  sourceLabel: string | null;
  selectedIndex: number | null;
  active: boolean;
  onError: (message: string | null) => void;
}

/**
 * Chooses where the recognition pipeline's frames come from: the webcam on
 * the machine running the backend, or this device's own camera streamed up to
 * it (the phone case — see useDeviceCamera). The backend runs the identical
 * pipeline either way, so this is purely about the source.
 */
export function CameraControls({
  mode,
  onModeChange,
  deviceCameraSupported,
  facing,
  onFacingChange,
  deviceStatus,
  liveSource,
  sourceLabel,
  selectedIndex,
  active,
  onError,
}: CameraControlsProps) {
  // Someone else's phone is feeding the pipeline. Say so rather than showing a
  // camera picker that would silently take the video away from them.
  const foreignStream = mode === "server" && liveSource === "browser";

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <div className="flex rounded-md border p-0.5" role="group" aria-label="Video source">
        <Button
          variant={mode === "server" ? "secondary" : "ghost"}
          size="sm"
          className={cn("h-7 gap-1.5 px-2", mode === "server" && "shadow-xs")}
          onClick={() => onModeChange("server")}
          aria-pressed={mode === "server"}
        >
          <Monitor className="size-3.5" />
          <span className="hidden sm:inline">Server webcam</span>
          <span className="sm:hidden">Server</span>
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={mode === "device" ? "secondary" : "ghost"}
              size="sm"
              className={cn("h-7 gap-1.5 px-2", mode === "device" && "shadow-xs")}
              onClick={() => onModeChange("device")}
              disabled={!deviceCameraSupported}
              aria-pressed={mode === "device"}
            >
              <Smartphone className="size-3.5" />
              <span className="hidden sm:inline">This device</span>
              <span className="sm:hidden">Phone</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {deviceCameraSupported
              ? "Use this device's camera for recognition"
              : "Camera capture needs an HTTPS (or localhost) connection"}
          </TooltipContent>
        </Tooltip>
      </div>

      {mode === "device" ? (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => onFacingChange(facing === "user" ? "environment" : "user")}
                disabled={deviceStatus === "starting"}
              >
                <RefreshCcw className="size-3.5" />
                {facing === "user" ? "Front" : "Back"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Switch between the front and back camera</TooltipContent>
          </Tooltip>
          <Badge variant={deviceStatus === "streaming" ? "success" : "secondary"} className="py-1">
            {deviceStatus === "streaming"
              ? "Streaming"
              : deviceStatus === "starting"
                ? "Starting…"
                : deviceStatus === "error"
                  ? "Camera error"
                  : "Idle"}
          </Badge>
        </>
      ) : foreignStream ? (
        <Badge variant="secondary" className="gap-1.5 py-1">
          <Smartphone className="size-3" />
          {sourceLabel ? `Streaming from ${sourceLabel}` : "Streaming from another device"}
        </Badge>
      ) : (
        <CameraPicker selectedIndex={selectedIndex} active={active} onError={onError} />
      )}
    </div>
  );
}
