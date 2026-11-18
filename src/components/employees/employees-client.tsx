"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addEmployee,
  archiveEmployee,
  createId,
  getActiveEmployees,
  readStoreSnapshot,
  unarchiveEmployee,
  updateEmployee,
  SYNC_EVENT,
} from "@/lib/store";
import type { Employee } from "@/types/database";

const AUTO_COLORS = [
  "#0d9488", "#0891b2", "#7c3aed", "#dc2626", "#ea580c",
  "#2563eb", "#059669", "#db2777", "#ca8a04", "#4f46e5",
  "#0e7490", "#b45309", "#be123c", "#15803d", "#6d28d9",
];

const emptyForm = { name: "", phone: "" };

export function EmployeesClient() {
  const [items, setItems] = useState<Employee[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeId, setRemoveId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [archived, setArchived] = useState<Employee[]>([]);

  const sync = useCallback(() => {
    setItems(getActiveEmployees());
    setArchived(
      readStoreSnapshot().employees.filter((e) => e.archived)
    );
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener(SYNC_EVENT, sync);
    return () => window.removeEventListener(SYNC_EVENT, sync);
  }, [sync]);

  const openEdit = (employee: Employee) => {
    setAddOpen(false);
    setEditId(employee.id);
    setForm({ name: employee.name, phone: employee.phone ?? "" });
    setEditOpen(true);
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    addEmployee({
      id: createId("e"),
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      color_code: AUTO_COLORS[items.length % AUTO_COLORS.length],
    });
    setAddOpen(false);
    setForm(emptyForm);
    sync();
  };

  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editId || !form.name.trim()) return;
    updateEmployee(editId, {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
    });
    setEditOpen(false);
    setEditId("");
    setForm(emptyForm);
    sync();
  };

  const handleRemove = () => {
    if (!removeId) return;
    archiveEmployee(removeId);
    setRemoveId("");
    setRemoveOpen(false);
    sync();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Employees</h1>
          <p className="text-slate-500 mt-1">
            Archive: past/today stay visible (view only). Tomorrow+ only if
            already assigned. Reports keep cleaner names.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setEditOpen(false);
              setEditId("");
              setForm(emptyForm);
              setAddOpen(true);
            }}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Employee
          </Button>
          <Button
            variant="destructive"
            onClick={() => setRemoveOpen(true)}
            disabled={items.length === 0}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" />
            Archive cleaner
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {items.map((e) => (
          <div key={e.id} className="rounded-lg border bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full text-white font-bold text-lg"
                style={{ backgroundColor: e.color_code }}
              >
                {e.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-slate-800 truncate">{e.name}</h3>
                <p className="text-sm text-slate-500">{e.phone ?? "No phone"}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge variant="success">Active</Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 px-2 text-slate-600"
                  onClick={() => openEdit(e)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {items.length === 0 && (
        <div className="rounded-lg border border-dashed bg-white p-12 text-center text-slate-500">
          No employees yet. Add your cleaners to start.
        </div>
      )}

      {archived.length > 0 ? (
        <div className="rounded-lg border border-dashed bg-white p-4 space-y-3">
          <h2 className="font-semibold text-slate-800">Archived cleaners</h2>
          <p className="text-sm text-slate-500">
            Past/today: view only. Tomorrow+: only nights they were already
            ticked (you can untick to clear). Reports keep names.
          </p>
          <ul className="space-y-2">
            {archived.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="text-slate-700">{e.name}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    unarchiveEmployee(e.id);
                    sync();
                  }}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Employee</DialogTitle>
            <DialogDescription>Name and phone only.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Add Employee</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) {
            setEditId("");
            setForm(emptyForm);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Employee</DialogTitle>
            <DialogDescription>
              Update name or phone. Changes apply to schedules and WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!form.name.trim()}>
                Save Changes
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive cleaner</DialogTitle>
            <DialogDescription>
              Soft-archive only — not permanently deleted. Past/today stay on
              the schedule (view only). Tomorrow+ only where already ticked
              (you can untick). Report names are kept. Restore anytime below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Select value={removeId || undefined} onValueChange={setRemoveId}>
              <SelectTrigger>
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {items.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRemoveOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleRemove} disabled={!removeId}>
                Archive
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
