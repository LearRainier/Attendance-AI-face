import { useEffect, useState } from "react";
import { CheckCircle2, Info, Users, XCircle } from "lucide-react";

import { fetchStatus, registerFace, type StatusResponse } from "@/api";
import { FaceCapture } from "@/components/FaceCapture";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function Register() {
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);

  const refreshStatus = () => {
    fetchStatus()
      .then(setStatus)
      .catch(() => {
        /* status panel is a nice-to-have, ignore transient failures */
      });
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  const handleCapture = async (imageB64: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await registerFace(name.trim(), imageB64);
      setMessage(`Saved template #${result.template_count} for ${result.name}.`);
      refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Register a Face</h1>
        <p className="text-sm text-muted-foreground">Capture embeddings for new people to enrol them in recognition</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Capture template</CardTitle>
            <CardDescription>Use the browser camera to take a fresh photo</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="register-name">Person&apos;s name</Label>
              <Input
                id="register-name"
                list="registered-people-names"
                type="text"
                placeholder="Select an existing person or type a new name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
              <datalist id="registered-people-names">
                {status?.people.map((p) => <option key={p.name} value={p.name} />)}
              </datalist>
              <p className="text-xs text-muted-foreground">
                Pick an existing person from the list to add another template for them, or type a new name to
                register someone new.
              </p>
            </div>

            <FaceCapture
              onCapture={handleCapture}
              busy={busy}
              captureBlocked={!name.trim()}
              captureBlockedHint="Enter a name above to enable capture."
            />

            {message && (
              <Alert variant="success">
                <CheckCircle2 />
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive">
                <XCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Alert>
              <Info />
              <AlertDescription>
                <span className="font-medium text-foreground">Helper — tips for a good capture</span>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>Center your face inside the dashed oval, facing the camera directly.</li>
                  <li>Only one person should be in frame — the box turns red if more than one face is seen.</li>
                  <li>
                    Stay within scanning range — the box turns amber with a &quot;step closer&quot; hint when
                    you&apos;re too far away, which is the same range the live dashboard uses.
                  </li>
                  <li>Use even, front-facing lighting and avoid strong backlight.</li>
                  <li>Keep a neutral expression and remove hats or sunglasses if possible.</li>
                  <li>Capture 3–5 templates from slightly different angles for the most reliable recognition.</li>
                </ul>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        <Card className="gap-0 py-0">
          <CardHeader className="border-b px-5 py-4">
            <CardTitle>Registered People</CardTitle>
            <CardDescription>{status?.registered_count ?? 0} enrolled</CardDescription>
          </CardHeader>
          <CardContent className="px-0 py-0">
            {status && status.people.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Templates</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {status.people.map((p) => (
                    <TableRow key={p.name}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary">{p.template_count}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
                <Users className="size-6 opacity-50" />
                No one registered yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
