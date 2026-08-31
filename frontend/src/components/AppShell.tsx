import { useState, type ReactNode } from "react";
import { BarChart3, Clock, IdCard, LayoutDashboard, Menu, ScanFace, UserPlus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

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
    <div className="flex items-center gap-2 px-2">
      <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <ScanFace className="size-4.5" />
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-semibold">FaceID</span>
        <span className="text-xs text-muted-foreground">Attendance System</span>
      </div>
    </div>
  );
}

function NavList({ view, onNavigate }: { view: View; onNavigate: (v: View) => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onNavigate(id)}
          className={cn(
            "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            view === id
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          )}
        >
          <Icon className="size-4" />
          {label}
        </button>
      ))}
    </nav>
  );
}

interface AppShellProps {
  view: View;
  onNavigate: (view: View) => void;
  children: ReactNode;
}

export function AppShell({ view, onNavigate, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-svh w-full bg-background">
      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar px-3 py-5 md:flex">
        <Brand />
        <NavList view={view} onNavigate={onNavigate} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="bg-sidebar w-64 px-3 py-5">
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
              />
            </SheetContent>
          </Sheet>
          <Brand />
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
