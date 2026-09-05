import { useEffect, useMemo, useState } from "react";
import { Camera, CheckCircle2, IdCard, Pencil, Plus, Search, Trash2, UserRoundX, XCircle } from "lucide-react";

import {
  deleteUserProfile,
  fetchUsers,
  registerFace,
  saveUserProfile,
  type UserProfile,
  type UserProfileInput,
} from "@/api";
import { FaceCapture } from "@/components/FaceCapture";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const EMPTY_FORM: UserProfileInput = {
  name: "",
  email: "",
  phone: "",
  department: "",
  position: "",
  student_number: "",
  employee_id: "",
  notes: "",
};

export function Users() {
  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null); // null => creating new
  const [form, setForm] = useState<UserProfileInput>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [capturingFace, setCapturingFace] = useState(false);
  const [faceMessage, setFaceMessage] = useState<string | null>(null);
  const [faceError, setFaceError] = useState<string | null>(null);

  const load = () => {
    fetchUsers()
      .then((data) => {
        setUsers(data);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load users."));
  };

  useEffect(load, []);

  const filtered = useMemo(() => {
    const rows = users ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((u) =>
      [u.name, u.email, u.phone, u.student_number, u.employee_id]
        .some((field) => field?.toLowerCase().includes(needle))
    );
  }, [users, search]);

  const resetCameraState = () => {
    setCameraOpen(false);
    setCapturingFace(false);
    setFaceMessage(null);
    setFaceError(null);
  };

  const openCreate = () => {
    setEditingName(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    resetCameraState();
    setSheetOpen(true);
  };

  const openEdit = (user: UserProfile) => {
    setEditingName(user.name);
    const studentNum = user.student_number || user.employee_id || "";
    setForm({
      name: user.name,
      email: user.email,
      phone: user.phone,
      department: user.department,
      position: user.position,
      student_number: studentNum,
      employee_id: studentNum,
      notes: user.notes,
    });
    setFormError(null);
    resetCameraState();
    setSheetOpen(true);
  };

  const handleFaceCapture = async (imageB64: string) => {
    const personName = form.name.trim();
    if (!personName) return; // guarded by FaceCapture's captureBlocked, defense in depth
    setCapturingFace(true);
    setFaceError(null);
    setFaceMessage(null);
    try {
      const result = await registerFace(personName, imageB64);
      setFaceMessage(`Saved template #${result.template_count} for ${result.name}.`);
      load(); // refresh the table's Face badge/template count
    } catch (err) {
      setFaceError(err instanceof Error ? err.message : "Face capture failed.");
    } finally {
      setCapturingFace(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setFormError("Enter a name.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await saveUserProfile({ ...form, name: form.name.trim() });
      setSheetOpen(false);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    setDeletingName(name);
    try {
      await deleteUserProfile(name);
      load();
    } catch {
      // Best-effort — the row simply stays put if this fails.
    } finally {
      setDeletingName(null);
    }
  };

  const loading = users === null && !loadError;
  const withProfile = (users ?? []).filter((u) => u.updated_at).length;
  const withoutFace = (users ?? []).filter((u) => u.template_count === 0).length;

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">User Management</h1>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          Add Person
        </Button>
      </div>

      {loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="py-6 text-sm text-destructive">{loadError}</CardContent>
        </Card>
      ) : loading ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Card className="gap-1 py-4">
              <CardHeader className="px-4">
                <CardDescription>Total people</CardDescription>
                <CardTitle className="text-2xl">{users?.length ?? 0}</CardTitle>
              </CardHeader>
            </Card>
            <Card className="gap-1 py-4">
              <CardHeader className="px-4">
                <CardDescription>With personal details</CardDescription>
                <CardTitle className="text-2xl">{withProfile}</CardTitle>
              </CardHeader>
            </Card>
            <Card className="col-span-2 gap-1 py-4 lg:col-span-1">
              <CardHeader className="px-4">
                <CardDescription>Missing a registered face</CardDescription>
                <CardTitle className="text-2xl">{withoutFace}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card className="gap-0 py-0">
            <CardHeader className="flex flex-row items-center justify-between gap-3 border-b px-5 py-4">
              <div>
                <CardTitle>People</CardTitle>
                <CardDescription>{filtered.length} shown</CardDescription>
              </div>
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, student no., email…"
                  className="pl-8"
                />
              </div>
            </CardHeader>
            <CardContent className="px-0 py-0">
              {filtered.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Student No.</TableHead>
                      <TableHead>Face</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((u) => (
                      <TableRow key={u.name}>
                        <TableCell className="font-medium">{u.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {u.email || u.phone ? (
                            <div className="flex flex-col text-xs">
                              {u.email && <span>{u.email}</span>}
                              {u.phone && <span>{u.phone}</span>}
                            </div>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {u.student_number || u.employee_id || "—"}
                        </TableCell>
                        <TableCell>
                          {u.template_count > 0 ? (
                            <Badge variant="success">{u.template_count} template{u.template_count === 1 ? "" : "s"}</Badge>
                          ) : (
                            <Badge variant="warning">Not registered</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(u)} title="Edit personal details">
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(u.name)}
                              disabled={deletingName === u.name}
                              title="Remove personal details (keeps face templates)"
                            >
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
                  <UserRoundX className="size-6 opacity-50" />
                  {search ? `No one matches "${search}".` : "No one added yet."}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <IdCard className="size-4.5" />
              {editingName ? `Edit ${editingName}` : "Add a person"}
            </SheetTitle>
            <SheetDescription className="sr-only">
              Personal profile editor
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-4 px-4 pb-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="user-name">Full name</Label>
              <Input
                id="user-name"
                value={form.name}
                disabled={!!editingName}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Jordan Lee"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Face template</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCameraOpen((open) => !open)}
                >
                  <Camera className="size-4" />
                  {cameraOpen ? "Close camera" : "Open camera"}
                </Button>
              </div>

              {cameraOpen && (
                <FaceCapture
                  onCapture={handleFaceCapture}
                  busy={capturingFace}
                  captureLabel="Capture Face"
                  captureBlocked={!form.name.trim()}
                  captureBlockedHint="Enter a name above to enable capture."
                />
              )}

              {faceMessage && (
                <Alert variant="success">
                  <CheckCircle2 />
                  <AlertDescription>{faceMessage}</AlertDescription>
                </Alert>
              )}
              {faceError && (
                <Alert variant="destructive">
                  <XCircle />
                  <AlertDescription>{faceError}</AlertDescription>
                </Alert>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="user-email">Email</Label>
                <Input
                  id="user-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="jordan@example.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="user-phone">Phone</Label>
                <Input
                  id="user-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+1 555 0100"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="user-student-no">Student No.</Label>
              <Input
                id="user-student-no"
                value={form.student_number || form.employee_id || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setForm((f) => ({ ...f, student_number: val, employee_id: val }));
                }}
                placeholder="e.g. 24-12345"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="user-notes">Notes</Label>
              <textarea
                id="user-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Anything else worth noting…"
                rows={3}
                className="border-input flex w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-2"
              />
            </div>

            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <Button onClick={handleSubmit} disabled={saving} size="lg">
              {saving ? "Saving…" : editingName ? "Save changes" : "Add person"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
