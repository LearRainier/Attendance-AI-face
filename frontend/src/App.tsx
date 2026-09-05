import { useEffect, useState } from "react";
import { AppShell, type View } from "./components/AppShell";
import { Dashboard } from "./pages/Dashboard";
import { Analytics } from "./pages/Analytics";
import { Register } from "./pages/Register";
import { Users } from "./pages/Users";
import { DTR } from "./pages/DTR";
import { Kiosk } from "./pages/Kiosk";
import { Login } from "./pages/Login";
import { getStoredAuth, verifyAdminAuth, logoutAdmin } from "./api";

function isKioskRoute(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.location.pathname.startsWith("/kiosk") ||
    window.location.search.includes("mode=kiosk") ||
    window.location.hash === "#kiosk"
  );
}

function App() {
  const [isKiosk, setIsKiosk] = useState<boolean>(isKioskRoute);
  const [view, setView] = useState<View>("dashboard");

  // Authentication state
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [adminUsername, setAdminUsername] = useState<string>("admin");
  const [userRole, setUserRole] = useState<string>("admin");
  const [authChecking, setAuthChecking] = useState<boolean>(true);

  // Handle popstate for back/forward navigation
  useEffect(() => {
    const handlePopState = () => setIsKiosk(isKioskRoute());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Verify stored session on startup (skip check if kiosk)
  useEffect(() => {
    if (isKiosk) {
      setAuthChecking(false);
      return;
    }

    const { token, username } = getStoredAuth();
    if (!token) {
      setAuthenticated(false);
      setAuthChecking(false);
      return;
    }

    verifyAdminAuth(token)
      .then((res) => {
        setAuthenticated(res.authenticated);
        setAdminUsername(res.username || username || "admin");
        setUserRole(res.role || "admin");
      })
      .catch(() => {
        setAuthenticated(false);
      })
      .finally(() => {
        setAuthChecking(false);
      });
  }, [isKiosk]);

  const enterKiosk = () => {
    window.open("/kiosk", "_blank");
  };

  const handleLoginSuccess = (username: string) => {
    setAdminUsername(username);
    setUserRole("admin");
    setAuthenticated(true);
  };

  const handleLogout = async () => {
    await logoutAdmin();
    setAuthenticated(false);
  };

  // Kiosk route is completely open and requires no admin login
  if (isKiosk) {
    return <Kiosk />;
  }

  // Loading state while verifying token
  if (authChecking) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background">
        <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Admin routes require authentication
  if (!authenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <AppShell
      view={view}
      onNavigate={setView}
      onEnterKiosk={enterKiosk}
      adminUsername={adminUsername}
      userRole={userRole}
      onLogout={handleLogout}
      onUsernameChange={setAdminUsername}
    >
      {view === "dashboard" && <Dashboard />}
      {view === "analytics" && <Analytics />}
      {view === "register" && <Register />}
      {view === "users" && <Users />}
      {view === "dtr" && <DTR />}
    </AppShell>
  );
}

export default App;
