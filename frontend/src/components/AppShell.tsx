import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlarmClock,
  BarChart3,
  CheckCircle2,
  Clock,
  IdCard,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MonitorPlay,
  Smartphone,
  UserPlus,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { changeAdminPassword, getScheduleSetting, setScheduleEnabled } from "@/api";
import { StudentAppModal } from "./StudentAppModal";
import { Footer } from "./Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";

export type View = "dashboard" | "analytics" | "register" | "users" | "dtr";

const NAV_ITEMS: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "register", label: "Register", icon: UserPlus },
  { id: "users", label: "User Management", icon: IdCard },
  { id: "dtr", label: "DTR", icon: Clock },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <img
        src="/shc logo.png"
        alt="SHC Logo"
        className="size-9 object-contain shrink-0 drop-shadow-xs"
      />
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-bold tracking-tight text-foreground">SHC MG</span>
        <span className="text-xs text-muted-foreground">Face Attendance System</span>
      </div>
    </div>
  );
}

/** Master switch for every time-of-day rule: the kiosk camera's operating
 * hours, the 6:30 AM / 8:00 AM check-in cutoffs and the Sunday closure.
 * Turning it off keeps the kiosk scanning around the clock; arrivals from
 * 5:15 AM on are still recorded as late. The choice lives on the backend, so
 * it applies to every screen and survives a restart. */
function ScheduleToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getScheduleSetting()
      .then((s) => {
        if (!cancelled) setEnabled(s.enabled);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't read the schedule setting.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(async () => {
    if (enabled === null || busy) return;
    const next = !enabled;
    setBusy(true);
    setError(null);
    // Optimistic: the switch should follow the finger straight away, and the
    // backend answer below is what it settles on.
    setEnabled(next);
    try {
      const saved = await setScheduleEnabled(next);
      setEnabled(saved.enabled);
    } catch (err) {
      setEnabled(!next);
      setError(err instanceof Error ? err.message : "Failed to update the schedule.");
    } finally {
      setBusy(false);
    }
  }, [enabled, busy]);

  const loading = enabled === null;
  const on = enabled === true;

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/30 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <AlarmClock
            className={cn("size-4 shrink-0", on ? "text-primary" : "text-muted-foreground")}
          />
          <span className="text-xs font-medium truncate">Attendance Schedule</span>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Attendance schedule"
          disabled={loading || busy}
          onClick={toggle}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            "disabled:cursor-not-allowed disabled:opacity-50",
            on ? "bg-primary border-primary" : "bg-muted border-sidebar-border"
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block size-3.5 rounded-full bg-background shadow-xs transition-transform",
              on ? "translate-x-4.5" : "translate-x-0.5"
            )}
          />
        </button>
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        {loading
          ? "Checking…"
          : on
            ? "On — kiosk runs 2:00–6:30 AM (8:00 AM Sat), closed Sundays."
            : "Off — kiosk scans any day, any time. Check-ins are never refused."}
      </p>

      {error && <p className="text-[10px] leading-snug text-destructive">{error}</p>}
    </div>
  );
}

function NavList({
  view,
  onNavigate,
  onEnterKiosk,
  adminUsername,
  userRole = "admin",
  onLogout,
  onOpenChangePassword,
  onOpenStudentApp,
}: {
  view: View;
  onNavigate: (v: View) => void;
  onEnterKiosk?: () => void;
  adminUsername?: string;
  userRole?: string;
  onLogout?: () => void;
  onOpenChangePassword?: () => void;
  onOpenStudentApp?: () => void;
}) {
  const visibleNavItems = userRole === "student"
    ? NAV_ITEMS.filter(({ id }) => id === "dtr" || id === "dashboard")
    : NAV_ITEMS;

  return (
    <nav className="flex flex-1 flex-col justify-between gap-1">
      <div className="flex flex-col gap-1">
        {visibleNavItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
              view === id
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}

        {userRole !== "student" && onEnterKiosk && (
          <button
            onClick={onEnterKiosk}
            className="flex items-center gap-2.5 rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/20 transition-colors mt-2 cursor-pointer shadow-xs"
          >
            <MonitorPlay className="size-4" />
            Launch Kiosk
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 pt-4 border-t border-sidebar-border mt-auto">
        {userRole !== "student" && <ScheduleToggle />}

        {onOpenStudentApp && (
          <button
            onClick={onOpenStudentApp}
            className="flex items-center gap-2.5 rounded-md border border-sidebar-border/80 bg-sidebar-accent/40 px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer"
          >
            <Smartphone className="size-4 text-primary" />
            Get Student App
          </button>
        )}

        <div className="flex items-center justify-between rounded-lg border border-sidebar-border/60 bg-sidebar-accent/30 p-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-bold">
              {adminUsername ? adminUsername[0]!.toUpperCase() : "U"}
            </div>
            <div className="flex flex-col min-w-0 leading-none">
              <span className="text-xs font-medium truncate">{adminUsername || "User"}</span>
              <span className="text-[10px] text-muted-foreground capitalize">
                {userRole === "student" ? "Student" : "Administrator"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {onOpenChangePassword && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                onClick={onOpenChangePassword}
                title="Change password"
              >
                <KeyRound className="size-3.5" />
              </Button>
            )}
            {onLogout && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={onLogout}
                title="Sign out"
              >
                <LogOut className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

interface AppShellProps {
  view: View;
  onNavigate: (view: View) => void;
  onEnterKiosk?: () => void;
  adminUsername?: string;
  userRole?: string;
  onLogout?: () => void;
  onUsernameChange?: (newUsername: string) => void;
  children: ReactNode;
}

export function AppShell({
  view,
  onNavigate,
  onEnterKiosk,
  adminUsername = "Admin",
  userRole = "admin",
  onLogout,
  onUsernameChange,
  children,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pwdSheetOpen, setPwdSheetOpen] = useState(false);
  const [studentAppOpen, setStudentAppOpen] = useState(false);

  // Change password form state
  const [currentPwd, setCurrentPwd] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);

  const openChangePassword = () => {
    setCurrentPwd("");
    setNewUsername(adminUsername);
    setNewPwd("");
    setConfirmPwd("");
    setPwdError(null);
    setPwdSuccess(null);
    setPwdSheetOpen(true);
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPwd) {
      setPwdError("Please enter your current password.");
      return;
    }
    if (!newPwd || newPwd.length < 4) {
      setPwdError("New password must be at least 4 characters.");
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdError("New passwords do not match.");
      return;
    }

    setPwdBusy(true);
    setPwdError(null);
    setPwdSuccess(null);
    try {
      const res = await changeAdminPassword(
        currentPwd,
        newPwd,
        newUsername.trim() || undefined
      );
      setPwdSuccess("Credentials updated successfully.");
      if (res.username && onUsernameChange) {
        onUsernameChange(res.username);
      }
      setTimeout(() => {
        setPwdSheetOpen(false);
      }, 1200);
    } catch (err) {
      setPwdError(err instanceof Error ? err.message : "Failed to update credentials.");
    } finally {
      setPwdBusy(false);
    }
  };

  return (
    <div className="flex min-h-svh w-full bg-background">
      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar px-3 py-5 md:flex overflow-y-auto max-h-screen sticky top-0">
        <Brand />
        <NavList
          view={view}
          onNavigate={onNavigate}
          onEnterKiosk={onEnterKiosk}
          adminUsername={adminUsername}
          userRole={userRole}
          onLogout={onLogout}
          onOpenChangePassword={openChangePassword}
          onOpenStudentApp={() => setStudentAppOpen(true)}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-4 md:hidden">
          <div className="flex items-center gap-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="bg-sidebar w-64 px-3 py-5 overflow-y-auto">
                <SheetHeader className="p-0">
                  <SheetTitle className="sr-only">Navigation menu</SheetTitle>
                  <Brand />
                </SheetHeader>
                <NavList
                  view={view}
                  onNavigate={(v) => {
                    onNavigate(v);
                    setMobileOpen(false);
                  }}
                  onEnterKiosk={() => {
                    setMobileOpen(false);
                    onEnterKiosk?.();
                  }}
                  adminUsername={adminUsername}
                  userRole={userRole}
                  onLogout={onLogout}
                  onOpenChangePassword={openChangePassword}
                  onOpenStudentApp={() => {
                    setMobileOpen(false);
                    setStudentAppOpen(true);
                  }}
                />
              </SheetContent>
            </Sheet>
            <Brand />
          </div>

          {userRole !== "student" && onEnterKiosk && (
            <Button
              variant="outline"
              size="sm"
              onClick={onEnterKiosk}
              className="gap-1.5 border-primary/30 text-primary hover:bg-primary/10 text-xs shadow-xs"
            >
              <MonitorPlay className="size-3.5" />
              Kiosk
            </Button>
          )}
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {children}
          <Footer className="mt-auto" />
        </main>
      </div>

      {/* Change Password Sheet */}
      <Sheet open={pwdSheetOpen} onOpenChange={setPwdSheetOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <KeyRound className="size-4.5" />
              Change Admin Password
            </SheetTitle>
            <SheetDescription>
              Update your administrator username or login password.
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleChangePasswordSubmit} className="flex flex-col gap-4 px-4 pb-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="change-admin-username">Username</Label>
              <Input
                id="change-admin-username"
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="admin"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="change-current-pwd">Current Password</Label>
              <Input
                id="change-current-pwd"
                type="password"
                value={currentPwd}
                onChange={(e) => setCurrentPwd(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="change-new-pwd">New Password</Label>
              <Input
                id="change-new-pwd"
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="At least 4 characters"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="change-confirm-pwd">Confirm New Password</Label>
              <Input
                id="change-confirm-pwd"
                type="password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="Re-type new password"
              />
            </div>

            {pwdError && (
              <Alert variant="destructive">
                <XCircle className="size-4" />
                <AlertDescription>{pwdError}</AlertDescription>
              </Alert>
            )}

            {pwdSuccess && (
              <Alert variant="success">
                <CheckCircle2 className="size-4" />
                <AlertDescription>{pwdSuccess}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={pwdBusy} size="lg" className="mt-2">
              {pwdBusy ? "Saving…" : "Update Credentials"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>

      {/* Student Mobile App Modal */}
      <StudentAppModal
        open={studentAppOpen}
        onClose={() => setStudentAppOpen(false)}
      />
    </div>
  );
}
