export interface CameraSupportResult {
  supported: boolean;
  reason?: string;
}

export function cameraSupport(): CameraSupportResult {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return {
      supported: false,
      reason: "Camera API (getUserMedia) is not available in this browser or context.",
    };
  }
  return { supported: true };
}

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function deviceName(): string {
  if (typeof navigator === "undefined") return "Unknown Device";
  if (/iPhone/i.test(navigator.userAgent)) return "iPhone";
  if (/iPad/i.test(navigator.userAgent)) return "iPad";
  if (/Android/i.test(navigator.userAgent)) return "Android Device";
  return "Browser Camera";
}
