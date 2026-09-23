import { useEffect, useState } from "react";
import { CheckCircle2, Info, Users, XCircle } from "lucide-react";

import { fetchStatus, registerFace, type StatusResponse } from "@/api";
import { DEPARTMENTS } from "@/constants/departments";
import { FaceCapture } from "@/components/FaceCapture";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PaginationBar } from "@/components/PaginationBar";

export function Register() {
  const [name, setName] = useState("");
  const [studentNumber, setStudentNumber] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState<string>("BSCS");
  const [yearLevel, setYearLevel] = useState<number>(1);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [peoplePage, setPeoplePage] = useState(1);
  const pageSize = 8;

  const studentNumberValid = /^\d{2}-\d{5}$/.test(studentNumber.trim());
  const emailValid = email.trim().includes("@") && email.trim().includes(".");
  const canCapture = Boolean(name.trim() && studentNumberValid && emailValid);

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
    if (!studentNumberValid) {
      setError("Student number must follow YY-NNNNN format (e.g. 26-00123).");
      return;
    }
    if (!emailValid) {
      setError("Please enter a valid domain email address.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await registerFace(
        name.trim(),
        imageB64,
        studentNumber.trim(),
        email.trim(),
        department.trim(),
        yearLevel
      );
      if (result.email_status === "already_sent" || result.template_count > 1) {
        setMessage(
          `Registered ${result.name} (${studentNumber.trim()} · ${department} - Year ${yearLevel}). Face template #${result.template_count} saved (existing credentials preserved).`
        );
      } else {
        setMessage(
          `Registered ${result.name} (${studentNumber.trim()} · ${department} - Year ${yearLevel}). Face template #${result.template_count} saved. Credentials sent to ${email.trim()}.`
        );
      }
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
        <h1 className="text-2xl font-semibold tracking-tight">Register a Student</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Student Information & Face Capture</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="register-student-no">Student Number</Label>
                <Input
                  id="register-student-no"
                  type="text"
                  placeholder="YY-NNNNN (e.g. 26-00123)"
                  value={studentNumber}
                  onChange={(e) => setStudentNumber(e.target.value.toUpperCase())}
                  autoComplete="off"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="register-department">Course / Department</Label>
                <select
                  id="register-department"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="border-input flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 font-medium cursor-pointer"
                >
                  {DEPARTMENTS.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="register-year-level">Year Level</Label>
                <select
                  id="register-year-level"
                  value={yearLevel}
                  onChange={(e) => setYearLevel(Number(e.target.value))}
                  className="border-input flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 font-medium cursor-pointer"
                >
                  <option value={1}>1st Year</option>
                  <option value={2}>2nd Year</option>
                  <option value={3}>3rd Year</option>
                  <option value={4}>4th Year</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="register-name">Student Full Name</Label>
                <Input
                  id="register-name"
                  list="registered-people-names"
                  type="text"
                  placeholder="e.g. Juan Dela Cruz"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                />
                <datalist id="registered-people-names">
                  {status?.people.map((p) => <option key={p.name} value={p.name} />)}
                </datalist>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="register-email">Domain Email</Label>
                <Input
                  id="register-email"
                  type="email"
                  placeholder="student@domain.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>

            <FaceCapture
              onCapture={handleCapture}
              busy={busy}
              captureBlocked={!canCapture}
              captureBlockedHint={
                !name.trim()
                  ? "Enter full name to enable capture."
                  : !studentNumberValid
                  ? "Enter a valid student number (YY-NNNNN)."
                  : "Enter a valid domain email."
              }
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
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Templates</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {status.people
                      .slice((peoplePage - 1) * pageSize, peoplePage * pageSize)
                      .map((p) => (
                        <TableRow key={p.name}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="secondary">{p.template_count}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
                <PaginationBar
                  currentPage={peoplePage}
                  totalItems={status.people.length}
                  pageSize={pageSize}
                  onPageChange={setPeoplePage}
                  itemLabel="people"
                />
              </>
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
