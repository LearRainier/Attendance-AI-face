import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw } from "lucide-react";

import { fetchCameras, scanCameras, selectCamera, type CameraDevice } from "@/api";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface CameraPickerProps {
  /** Selected device index straight from the live feed — the source of
   * truth, so the dropdown also reflects a switch made in another tab or
   * the backend's startup fallback to a working camera. */
  selectedIndex: number | null;
  /** Whether the backend currently has that camera open. */
  active: boolean;
  onError?: (message: string | null) => void;
}

/**
 * Camera selector for the live feed. The backend owns the physical webcam
 * (see CLAUDE.md), so the list, the current selection and the switch itself
 * all live server-side — this only drives them. OpenCV can't report device
 * names, hence the thumbnail preview per option: "Camera 0" vs "Camera 1"
 * means nothing on its own.
 */
export function CameraPicker({ selectedIndex, active, onError }: CameraPickerProps) {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [switching, setSwitching] = useState(false);
  // Index the user just picked, held until the live feed confirms it, so the
  // dropdown doesn't visibly snap back to the old camera while the backend
  // reopens the device.
  const [pending, setPending] = useState<number | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    fetchCameras()
      .then((res) => setCameras(res.cameras))
      .catch(() => {
        /* the picker just stays empty; the feed itself reports camera trouble */
      });
  }, []);

  useEffect(() => {
    if (pending !== null && selectedIndex === pending) {
      setPending(null);
    }
  }, [pending, selectedIndex]);

  const handleSelect = async (value: string) => {
    const index = Number(value);
    if (!Number.isInteger(index) || index === selectedIndex) return;
    setPending(index);
    setSwitching(true);
    onErrorRef.current?.(null);
    try {
      const res = await selectCamera(index);
      setCameras(res.cameras);
    } catch (err) {
      setPending(null);
      onErrorRef.current?.(err instanceof Error ? err.message : "Failed to switch camera.");
    } finally {
      setSwitching(false);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    onErrorRef.current?.(null);
    try {
      const res = await scanCameras();
      setCameras(res.cameras);
      if (res.cameras.length === 0) {
        onErrorRef.current?.("No working cameras found. Check that the webcam is connected and not in use by another app.");
      }
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err.message : "Camera scan failed.");
    } finally {
      setScanning(false);
    }
  };

  const shownIndex = pending ?? selectedIndex;
  const shownCamera = cameras.find((camera) => camera.index === shownIndex);
  // Radix clones the selected SelectItem's content into the trigger unless
  // SelectValue is given its own children — and this item content is a
  // thumbnail plus two stacked lines, which would wreck the small trigger.
  const triggerLabel =
    shownIndex === null
      ? null
      : shownCamera
        ? `Camera ${shownIndex} · ${shownCamera.width}×${shownCamera.height}`
        : `Camera ${shownIndex}`;
  // A camera the backend is set to but that isn't in the scanned list (it was
  // unplugged, or saved from an earlier run) still needs an entry, or the
  // dropdown would render blank and hide what's actually selected.
  const options =
    shownIndex !== null && !cameras.some((camera) => camera.index === shownIndex)
      ? [...cameras, { index: shownIndex, width: 0, height: 0, backend: "", thumbnail: null }]
      : cameras;

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={shownIndex !== null ? String(shownIndex) : undefined}
        onValueChange={handleSelect}
        disabled={scanning || switching}
      >
        <SelectTrigger size="sm" className="min-w-[190px]" aria-label="Camera">
          {switching ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Camera className={active ? "size-3.5" : "size-3.5 opacity-50"} />
          )}
          <SelectValue placeholder={scanning ? "Scanning…" : "No camera"}>
            <span className="truncate">{switching ? "Switching…" : triggerLabel}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((camera) => (
            <SelectItem key={camera.index} value={String(camera.index)}>
              <span className="flex items-center gap-2">
                {camera.thumbnail ? (
                  <img
                    src={camera.thumbnail}
                    alt=""
                    className="h-8 w-11 shrink-0 rounded-sm border object-cover -scale-x-100"
                  />
                ) : (
                  <span className="flex h-8 w-11 shrink-0 items-center justify-center rounded-sm border bg-muted">
                    <Camera className="size-3.5 opacity-50" />
                  </span>
                )}
                <span className="flex flex-col items-start">
                  <span>Camera {camera.index}</span>
                  <span className="text-xs text-muted-foreground">
                    {camera.width > 0 ? `${camera.width}×${camera.height}` : "not detected"}
                  </span>
                </span>
              </span>
            </SelectItem>
          ))}
          {options.length === 0 && (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              No cameras found — try Rescan
            </div>
          )}
        </SelectContent>
      </Select>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={handleScan}
            disabled={scanning || switching}
            aria-label="Rescan cameras"
          >
            <RefreshCw className={scanning ? "size-3.5 animate-spin" : "size-3.5"} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Rescan for cameras (briefly pauses the feed)</TooltipContent>
      </Tooltip>
    </div>
  );
}
