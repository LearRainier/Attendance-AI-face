import { useState } from "react";
import { AppShell, type View } from "./components/AppShell";
import { Dashboard } from "./pages/Dashboard";
import { Analytics } from "./pages/Analytics";
import { Register } from "./pages/Register";
import { Users } from "./pages/Users";
import { DTR } from "./pages/DTR";

function App() {
  const [view, setView] = useState<View>("dashboard");

  return (
    <AppShell view={view} onNavigate={setView}>
      {view === "dashboard" && <Dashboard />}
      {view === "analytics" && <Analytics />}
      {view === "register" && <Register />}
      {view === "users" && <Users />}
      {view === "dtr" && <DTR />}
    </AppShell>
  );
}

export default App;
