import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Download, QrCode, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface StudentAppModalProps {
  open: boolean;
  onClose: () => void;
}

export function StudentAppModal({ open, onClose }: StudentAppModalProps) {
  const [activeTab, setActiveTab] = useState<"android" | "ios">("android");
  const [copied, setCopied] = useState<boolean>(false);

  const androidCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const iosCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Automatically use the active browser origin (Cloudflare tunnel or local network)
  const baseUrl = typeof window !== "undefined" && window.location.origin
    ? window.location.origin
    : "";

  const apkDownloadUrl = `${baseUrl}/api/download/student-app.apk`;
  
  // Expo URL for iOS (connects via Expo Go)
  const expoProjectUrl = `exp://${baseUrl.replace(/^https?:\/\//, "")}`;

  useEffect(() => {
    if (!open) return;

    if (androidCanvasRef.current) {
      QRCode.toCanvas(androidCanvasRef.current, apkDownloadUrl, {
        width: 190,
        margin: 2,
        color: {
          dark: "#09090b",
          light: "#ffffff",
        },
      }).catch((err) => console.error("QR Code render error (Android):", err));
    }

    if (iosCanvasRef.current) {
      QRCode.toCanvas(iosCanvasRef.current, expoProjectUrl, {
        width: 190,
        margin: 2,
        color: {
          dark: "#09090b",
          light: "#ffffff",
        },
      }).catch((err) => console.error("QR Code render error (iOS):", err));
    }
  }, [open, activeTab, apkDownloadUrl, expoProjectUrl]);

  const handleCopyLink = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-150 text-card-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="size-4.5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Smartphone className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight">Get Student App</h2>
            <p className="text-xs text-muted-foreground">
              Direct install for Android and instant launch for iOS
            </p>
          </div>
        </div>

        {/* Tabs for Android & iOS */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "android" | "ios")}>
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="android">Android (APK)</TabsTrigger>
            <TabsTrigger value="ios">iOS (Expo Go)</TabsTrigger>
          </TabsList>

          {/* ANDROID TAB */}
          <TabsContent value="android" className="flex flex-col items-center gap-4">
            <div className="flex flex-col items-center justify-center rounded-xl border border-border/80 bg-white p-3 shadow-inner">
              <canvas ref={androidCanvasRef} className="rounded" />
            </div>

            <p className="text-center text-xs text-muted-foreground leading-relaxed px-2">
              Point your Android camera at this QR code to download and install the app directly. No Google Play Store required.
            </p>

            <div className="flex w-full gap-2 mt-1">
              <Button
                variant="default"
                className="flex-1 gap-2"
                onClick={() => window.open(apkDownloadUrl, "_blank")}
              >
                <Download className="size-4" />
                Download APK
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => handleCopyLink(apkDownloadUrl)}
              >
                {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                {copied ? "Copied" : "Copy Link"}
              </Button>
            </div>
          </TabsContent>

          {/* IOS TAB */}
          <TabsContent value="ios" className="flex flex-col items-center gap-4">
            <div className="flex flex-col items-center justify-center rounded-xl border border-border/80 bg-white p-3 shadow-inner">
              <canvas ref={iosCanvasRef} className="rounded" />
            </div>

            <div className="w-full space-y-1.5 rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">How to launch on iPhone:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Install the free <span className="text-foreground font-medium">Expo Go</span> app from the App Store.</li>
                <li>Scan this QR code with your iPhone Camera app.</li>
                <li>Tap to open in Expo Go — the app runs natively!</li>
              </ol>
            </div>

            <Button
              variant="outline"
              className="w-full gap-2 mt-1"
              onClick={() => handleCopyLink(expoProjectUrl)}
            >
              <QrCode className="size-4" />
              {copied ? "Link Copied!" : "Copy Expo Link"}
            </Button>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
