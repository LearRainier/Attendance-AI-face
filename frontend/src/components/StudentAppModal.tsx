import { useState } from "react";
import { Clock, Construction, Info, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

interface StudentAppModalProps {
  open: boolean;
  onClose: () => void;
}

export function StudentAppModal({ open, onClose }: StudentAppModalProps) {
  const [activeTab, setActiveTab] = useState<"android" | "ios">("android");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-150 text-card-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
        >
          <X className="size-4.5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex size-10 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
            <Smartphone className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">Student Mobile App</h2>
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-500 dark:text-amber-400 text-[10px] py-0 px-2">
                In Development
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Mobile app is in active development for upcoming updates
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
            {/* Obscured QR Symbol Box */}
            <div className="relative flex flex-col items-center justify-center rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-6 w-full text-center">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-amber-500/15 border border-amber-500/25 text-amber-500 mb-3 shadow-inner">
                <Construction className="size-8" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">Android App in Development</h3>
              <p className="text-xs text-muted-foreground max-w-xs mt-1 leading-relaxed">
                QR code scanning and APK direct download are temporarily paused while features are being completed.
              </p>
            </div>

            <div className="flex items-start gap-2.5 w-full rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              <Info className="size-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="leading-snug">
                <span className="font-semibold text-foreground">Planned Release:</span> This portal will allow students to check their Daily Time Record (DTR) and view attendance passes on their personal phones in future updates.
              </div>
            </div>

            <Button
              disabled
              variant="outline"
              className="w-full gap-2 opacity-60 cursor-not-allowed"
            >
              <Clock className="size-4 text-amber-500" />
              <span>Available in Future Updates</span>
            </Button>
          </TabsContent>

          {/* IOS TAB */}
          <TabsContent value="ios" className="flex flex-col items-center gap-4">
            {/* Obscured QR Symbol Box */}
            <div className="relative flex flex-col items-center justify-center rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-6 w-full text-center">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-amber-500/15 border border-amber-500/25 text-amber-500 mb-3 shadow-inner">
                <Construction className="size-8" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">iOS Portal in Development</h3>
              <p className="text-xs text-muted-foreground max-w-xs mt-1 leading-relaxed">
                iPhone Expo connection QR is temporarily shielded to prevent premature scanning during development.
              </p>
            </div>

            <div className="flex items-start gap-2.5 w-full rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              <Info className="size-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="leading-snug">
                <span className="font-semibold text-foreground">Planned Release:</span> iOS students will be able to connect directly via TestFlight / Expo Go once the build is certified.
              </div>
            </div>

            <Button
              disabled
              variant="outline"
              className="w-full gap-2 opacity-60 cursor-not-allowed"
            >
              <Clock className="size-4 text-amber-500" />
              <span>Available in Future Updates</span>
            </Button>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
