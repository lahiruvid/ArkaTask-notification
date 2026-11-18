"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
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
import { formatCurrency } from "@/lib/utils";
import {
  addOwner,
  addProperty,
  archiveProperty,
  createId,
  getActiveProperties,
  getOwners,
  readStoreSnapshot,
  removeOwner,
  SYNC_EVENT,
  unarchiveProperty,
  updateOwnerWhatsapp,
  updateProperty,
} from "@/lib/store";
import type { Owner, Property, PropertySize } from "@/types/database";

/** Options shown in Add/Edit Property (new properties cannot pick legacy Doppia). */
const PROPERTY_SIZES: PropertySize[] = [
  "Monolocale",
  "Bilocale",
  "Trilocale",
  "Quadrilocale",
  "Quadrilocale +",
];

/** Still valid in saved data so existing client properties keep their size. */
const LEGACY_PROPERTY_SIZES: PropertySize[] = ["Doppia"];

const KNOWN_PROPERTY_SIZES: PropertySize[] = [
  ...PROPERTY_SIZES,
  ...LEGACY_PROPERTY_SIZES,
];

type FormState = {
  owner: string;
  name: string;
  size: PropertySize;
  single_beds: string;
  double_beds: string;
  pillow_covers_single: string;
  pillow_covers_double: string;
  extra_pillows: string;
  owner_amount: string;
  employee_pay_amount: string;
  single_sheet_cost: string;
  double_sheet_cost: string;
  extra_sheet_cost: string;
  pillow_cost: string;
  product_cost: string;
};

const emptyForm = (): FormState => ({
  owner: "",
  name: "",
  size: "",
  single_beds: "",
  double_beds: "",
  pillow_covers_single: "1",
  pillow_covers_double: "2",
  extra_pillows: "0",
  owner_amount: "",
  employee_pay_amount: "",
  single_sheet_cost: "",
  double_sheet_cost: "",
  extra_sheet_cost: "",
  pillow_cost: "",
  product_cost: "",
});

function productCostFromProperty(p: Property): number {
  if (p.product_cost !== undefined && p.product_cost !== null) {
    return Number(p.product_cost) || 0;
  }
  if (p.other_cost !== undefined && p.other_cost !== null) {
    return Number(p.other_cost) || 0;
  }
  return (p.extra_costs ?? []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
}

function ownerAmountOf(p: Property): number {
  return Number(p.owner_amount ?? p.amount) || 0;
}

function employeePayOf(p: Property): number {
  if (p.employee_pay_amount !== undefined && p.employee_pay_amount !== null) {
    return Number(p.employee_pay_amount) || 0;
  }
  return ownerAmountOf(p);
}

function propertyToForm(p: Property): FormState {
  return {
    owner: p.owner,
    name: p.name,
    size: (KNOWN_PROPERTY_SIZES.includes(p.size as PropertySize)
      ? p.size
      : "") as PropertySize,
    single_beds: String(p.single_beds ?? 0),
    double_beds: String(p.double_beds ?? 0),
    pillow_covers_single: String(p.pillow_covers_single ?? 0),
    pillow_covers_double: String(p.pillow_covers_double ?? 0),
    extra_pillows: String(p.extra_pillows ?? 0),
    owner_amount: String(ownerAmountOf(p)),
    employee_pay_amount: String(employeePayOf(p)),
    single_sheet_cost: String(p.single_sheet_cost ?? 0),
    double_sheet_cost: String(p.double_sheet_cost ?? 0),
    extra_sheet_cost: String(p.extra_sheet_cost ?? 0),
    pillow_cost: String(p.pillow_cost ?? 0),
    product_cost: String(productCostFromProperty(p)),
  };
}

function formToProperty(
  form: FormState,
  id: string,
  existing?: Property | null
): Property {
  const single = parseInt(form.single_beds, 10) || 0;
  const dbl = parseInt(form.double_beds, 10) || 0;
  const pillowCoversSingle = parseInt(form.pillow_covers_single, 10) || 0;
  const pillowCoversDouble = parseInt(form.pillow_covers_double, 10) || 0;
  const extraPillows = parseInt(form.extra_pillows, 10) || 0;
  const singleSheet = parseFloat(form.single_sheet_cost) || 0;
  const doubleSheet = parseFloat(form.double_sheet_cost) || 0;
  const extraSheet = parseFloat(form.extra_sheet_cost) || 0;
  const pillow = parseFloat(form.pillow_cost) || 0;
  const product = parseFloat(form.product_cost) || 0;
  const ownerAmount = parseFloat(form.owner_amount) || 0;
  const employeePay = parseFloat(form.employee_pay_amount) || 0;
  return {
    id,
    owner: form.owner.trim(),
    name: form.name.trim(),
    size: form.size,
    single_beds: single,
    double_beds: dbl,
    beds: single + dbl,
    pillow_covers_single: pillowCoversSingle,
    pillow_covers_double: pillowCoversDouble,
    extra_pillows: extraPillows,
    owner_amount: ownerAmount,
    employee_pay_amount: employeePay,
    amount: ownerAmount,
    single_sheet_cost: singleSheet,
    double_sheet_cost: doubleSheet,
    extra_sheet_cost: extraSheet,
    pillow_cost: pillow,
    // Keep labeled extras on edit; product_cost stays the flat extra cost
    extra_costs: existing?.extra_costs ?? [],
    other_cost: product,
    // pillow_cost = per extra pillow only
    bedsheet_cost:
      single * singleSheet + dbl * doubleSheet + extraPillows * pillow,
    product_cost: product,
  };
}

export function PropertiesClient() {
  const [items, setItems] = useState<Property[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeId, setRemoveId] = useState("");
  const [ownersOpen, setOwnersOpen] = useState(false);
  const [newOwnerName, setNewOwnerName] = useState("");
  const [newOwnerWhatsapp, setNewOwnerWhatsapp] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [archived, setArchived] = useState<Property[]>([]);

  const sync = useCallback(() => {
    setItems(getActiveProperties());
    setOwners(getOwners());
    setArchived(
      readStoreSnapshot().properties.filter((p) => p.archived)
    );
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener(SYNC_EVENT, sync);
    return () => window.removeEventListener(SYNC_EVENT, sync);
  }, [sync]);

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (p: Property) => {
    setEditingId(p.id);
    setForm(propertyToForm(p));
    setFormOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.owner.trim() || !form.name.trim()) return;
    if (editingId) {
      const existing = readStoreSnapshot().properties.find(
        (p) => p.id === editingId
      );
      updateProperty(editingId, formToProperty(form, editingId, existing));
    } else {
      addProperty(formToProperty(form, createId("p")));
    }
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm());
    sync();
  };

  const handleRemove = () => {
    if (!removeId) return;
    archiveProperty(removeId);
    setRemoveId("");
    setRemoveOpen(false);
    sync();
  };

  const handleAddOwner = () => {
    if (!newOwnerName.trim()) return;
    const ok = addOwner(newOwnerName, newOwnerWhatsapp);
    if (!ok) {
      window.alert("That owner name already exists.");
      return;
    }
    setNewOwnerName("");
    setNewOwnerWhatsapp("");
    sync();
  };

  const handleRemoveOwner = (id: string) => {
    const result = removeOwner(id);
    if (!result.ok && result.reason === "in_use") {
      window.alert(
        "This owner still has properties. Change or clear the owner on those places first."
      );
      return;
    }
    sync();
  };

  const [ownerWhatsappDrafts, setOwnerWhatsappDrafts] = useState<
    Record<string, string>
  >({});

  const ownerWhatsappValue = (o: Owner) =>
    ownerWhatsappDrafts[o.id] !== undefined
      ? ownerWhatsappDrafts[o.id]
      : o.whatsapp ?? "";

  const saveOwnerWhatsapp = (id: string) => {
    const value =
      ownerWhatsappDrafts[id] !== undefined
        ? ownerWhatsappDrafts[id]
        : owners.find((o) => o.id === id)?.whatsapp ?? "";
    updateOwnerWhatsapp(id, value);
    setOwnerWhatsappDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    sync();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Properties</h1>
          <p className="text-slate-500 mt-1">
            Archive: past/today stay visible (view only). Tomorrow+ only if
            already ticked. Reports keep place names.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setOwnersOpen(true)} className="gap-2">
            <Users className="h-4 w-4" />
            Owners
          </Button>
          <Button onClick={openAdd} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Property
          </Button>
          <Button
            variant="destructive"
            onClick={() => setRemoveOpen(true)}
            className="gap-2"
            disabled={items.length === 0}
          >
            <Trash2 className="h-4 w-4" />
            Archive place
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-white p-12 text-center text-slate-500">
          No properties yet. Add owners, then add your places.
        </div>
      ) : (
        <div className="rounded-lg border bg-white shadow-sm overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b bg-teal-50">
                {[
                  "Place",
                  "Size",
                  "Owner",
                  "Single",
                  "Double",
                  "Pillow /S",
                  "Pillow /D",
                  "Owner pay €",
                  "Emp pay €",
                  "Sheet S",
                  "Sheet D",
                  "Pillow €",
                  "Extra",
                  "Edit",
                ].map((h) => (
                  <th
                    key={h}
                    className={
                      h === "Edit"
                        ? "sticky right-0 z-10 bg-teal-50 px-3 py-3 text-right font-semibold text-teal-800 whitespace-nowrap"
                        : "px-3 py-3 text-left font-semibold text-teal-800 whitespace-nowrap"
                    }
                  >
                    {h === "Edit" ? "" : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((p, i) => (
                <tr
                  key={p.id}
                  className={
                    i % 2 === 1
                      ? "group border-b bg-slate-50/50 hover:bg-slate-50"
                      : "group border-b bg-white hover:bg-slate-50"
                  }
                >
                  <td className="px-3 py-3 font-medium text-slate-800 whitespace-nowrap">
                    {p.name}
                  </td>
                  <td className="px-3 py-3 text-slate-700 whitespace-nowrap">
                    {p.size || "—"}
                  </td>
                  <td className="px-3 py-3 text-slate-700 whitespace-nowrap">
                    {p.owner || "—"}
                  </td>
                  <td className="px-3 py-3 text-slate-700">{p.single_beds}</td>
                  <td className="px-3 py-3 text-slate-700">{p.double_beds}</td>
                  <td className="px-3 py-3 text-slate-700">
                    {p.pillow_covers_single ?? 0}
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    {p.pillow_covers_double ?? 0}
                  </td>
                  <td className="px-3 py-3 text-slate-700 whitespace-nowrap">
                    {formatCurrency(ownerAmountOf(p))}
                  </td>
                  <td className="px-3 py-3 text-slate-700 whitespace-nowrap">
                    {formatCurrency(employeePayOf(p))}
                  </td>
                  <td className="px-3 py-3 text-slate-700 whitespace-nowrap">
                    {formatCurrency(p.single_sheet_cost || 0)}
                  </td>
                  <td className="px-3 py-3 text-slate-700 whitespace-nowrap">
                    {formatCurrency(p.double_sheet_cost || 0)}
                  </td>
                  <td className="px-3 py-3 text-slate-700 whitespace-nowrap">
                    {formatCurrency(p.pillow_cost || 0)}
                  </td>
                  <td className="px-3 py-3 text-slate-700 whitespace-nowrap">
                    {formatCurrency(productCostFromProperty(p))}
                  </td>
                  <td
                    className={
                      i % 2 === 1
                        ? "sticky right-0 z-10 bg-slate-50 px-3 py-3 text-right whitespace-nowrap group-hover:bg-slate-50 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.08)]"
                        : "sticky right-0 z-10 bg-white px-3 py-3 text-right whitespace-nowrap group-hover:bg-slate-50 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.08)]"
                    }
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1 shrink-0"
                      onClick={() => openEdit(p)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {archived.length > 0 ? (
        <div className="rounded-lg border border-dashed bg-white p-4 space-y-3">
          <h2 className="font-semibold text-slate-800">Archived places</h2>
          <p className="text-sm text-slate-500">
            Past/today: view only. Tomorrow+: only if already ticked before
            remove. Reports keep history.
          </p>
          <ul className="space-y-2">
            {archived.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="text-slate-700">
                  {p.name} · {p.owner || "—"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    unarchiveProperty(p.id);
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

      {/* Add / Edit property */}
      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) {
            setEditingId(null);
            setForm(emptyForm());
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader className="pb-1">
            <DialogTitle>
              {editingId ? "Edit Property" : "Add Property"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Add or edit property details.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            {/* 1 · Place */}
            <section className="rounded-md border border-slate-200 p-2.5 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700">
                1 · Place
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="space-y-1">
                  <Label className="text-xs">Owner</Label>
                  <Select
                    value={form.owner || undefined}
                    onValueChange={(v) => setForm({ ...form, owner: v })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select owner" />
                    </SelectTrigger>
                    <SelectContent>
                      {owners.map((o) => (
                        <SelectItem key={o.id} value={o.name}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {owners.length === 0 ? (
                    <p className="text-[11px] text-amber-700">
                      Add an owner first (Owners).
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Place name</Label>
                  <Input
                    className="h-9"
                    value={form.name}
                    onChange={(e) =>
                      setForm({ ...form, name: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Size</Label>
                  <Select
                    value={form.size || undefined}
                    onValueChange={(v) =>
                      setForm({ ...form, size: v as PropertySize })
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Size" />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        form.size &&
                        LEGACY_PROPERTY_SIZES.includes(form.size) &&
                        !PROPERTY_SIZES.includes(form.size)
                          ? [form.size, ...PROPERTY_SIZES]
                          : PROPERTY_SIZES
                      ).map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            {/* 2 · Beds & pillows (paired by bed type) */}
            <section className="rounded-md border border-slate-200 p-2.5 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700">
                2 · Beds &amp; pillows
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="rounded-md bg-slate-50 p-2 grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Single beds</Label>
                    <Input
                      className="h-9"
                      type="number"
                      min="0"
                      value={form.single_beds}
                      onChange={(e) =>
                        setForm({ ...form, single_beds: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Pillow per single bed</Label>
                    <Input
                      className="h-9"
                      type="number"
                      min="0"
                      value={form.pillow_covers_single}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          pillow_covers_single: e.target.value,
                        })
                      }
                      required
                    />
                  </div>
                </div>
                <div className="rounded-md bg-slate-50 p-2 grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Double beds</Label>
                    <Input
                      className="h-9"
                      type="number"
                      min="0"
                      value={form.double_beds}
                      onChange={(e) =>
                        setForm({ ...form, double_beds: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Pillow per double bed</Label>
                    <Input
                      className="h-9"
                      type="number"
                      min="0"
                      value={form.pillow_covers_double}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          pillow_covers_double: e.target.value,
                        })
                      }
                      required
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-1 max-w-[200px]">
                <Label className="text-xs">Number of extra pillows</Label>
                <Input
                  className="h-9"
                  type="number"
                  min="0"
                  value={form.extra_pillows}
                  onChange={(e) =>
                    setForm({ ...form, extra_pillows: e.target.value })
                  }
                />
              </div>
            </section>

            {/* 3 · Money */}
            <section className="rounded-md border border-slate-200 p-2.5 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700">
                3 · Money (€)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <div className="space-y-1">
                  <Label className="text-xs">Owner Pay (€)</Label>
                  <Input
                    className="h-9"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.owner_amount}
                    onChange={(e) =>
                      setForm({ ...form, owner_amount: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Employee Pay (€)</Label>
                  <Input
                    className="h-9"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.employee_pay_amount}
                    onChange={(e) =>
                      setForm({ ...form, employee_pay_amount: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Extra cost (€)</Label>
                  <Input
                    className="h-9"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.product_cost}
                    onChange={(e) =>
                      setForm({ ...form, product_cost: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Extra sheet cost (€)</Label>
                  <Input
                    className="h-9"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.extra_sheet_cost}
                    onChange={(e) =>
                      setForm({ ...form, extra_sheet_cost: e.target.value })
                    }
                  />
                </div>
              </div>
            </section>

            {/* 4 · Unit rates */}
            <section className="rounded-md border border-slate-200 bg-slate-50/80 p-2.5 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700">
                4 · Sheet &amp; pillow rates (€)
              </p>
              <div className="grid grid-cols-3 gap-2.5">
                <div className="space-y-1">
                  <Label className="text-xs">Per single bed</Label>
                  <Input
                    className="h-9 bg-white"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.single_sheet_cost}
                    onChange={(e) =>
                      setForm({ ...form, single_sheet_cost: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Per double bed</Label>
                  <Input
                    className="h-9 bg-white"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.double_sheet_cost}
                    onChange={(e) =>
                      setForm({ ...form, double_sheet_cost: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Per extra pillow</Label>
                  <Input
                    className="h-9 bg-white"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.pillow_cost}
                    onChange={(e) =>
                      setForm({ ...form, pillow_cost: e.target.value })
                    }
                  />
                </div>
              </div>
            </section>

            {/* Italian cost preview */}
            <section className="rounded-md border border-teal-200 bg-teal-50/60 p-2.5 space-y-1.5 text-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-800">
                Calcolo costi
              </p>
              {(() => {
                const single = parseInt(form.single_beds, 10) || 0;
                const dbl = parseInt(form.double_beds, 10) || 0;
                const extraPillows = parseInt(form.extra_pillows, 10) || 0;
                const singleRate = parseFloat(form.single_sheet_cost) || 0;
                const doubleRate = parseFloat(form.double_sheet_cost) || 0;
                const pillowRate = parseFloat(form.pillow_cost) || 0;
                const extraSheet = parseFloat(form.extra_sheet_cost) || 0;
                const extraCost = parseFloat(form.product_cost) || 0;
                const singleTotal = single * singleRate;
                const doubleTotal = dbl * doubleRate;
                const pillowTotal = extraPillows * pillowRate;
                const linen = singleTotal + doubleTotal + pillowTotal;
                return (
                  <>
                    <div className="flex justify-between text-slate-700">
                      <span>
                        Letti singoli ({single} × {formatCurrency(singleRate)})
                      </span>
                      <span>{formatCurrency(singleTotal)}</span>
                    </div>
                    <div className="flex justify-between text-slate-700">
                      <span>
                        Letti doppi ({dbl} × {formatCurrency(doubleRate)})
                      </span>
                      <span>{formatCurrency(doubleTotal)}</span>
                    </div>
                    <div className="flex justify-between text-slate-700">
                      <span>
                        Cuscini extra ({extraPillows} ×{" "}
                        {formatCurrency(pillowRate)})
                      </span>
                      <span>{formatCurrency(pillowTotal)}</span>
                    </div>
                    {extraSheet > 0 ? (
                      <div className="flex justify-between text-slate-700">
                        <span>Costo lenzuola extra</span>
                        <span>{formatCurrency(extraSheet)}</span>
                      </div>
                    ) : null}
                    {extraCost > 0 ? (
                      <div className="flex justify-between text-slate-700">
                        <span>Costo extra</span>
                        <span>{formatCurrency(extraCost)}</span>
                      </div>
                    ) : null}
                    <div className="flex justify-between font-semibold text-slate-900 border-t border-teal-200 pt-1.5 mt-1">
                      <span>Totale biancheria + extra</span>
                      <span>
                        {formatCurrency(linen + extraSheet + extraCost)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 pt-0.5">
                      Proprietario:{" "}
                      {formatCurrency(parseFloat(form.owner_amount) || 0)} ·
                      Dipendente:{" "}
                      {formatCurrency(parseFloat(form.employee_pay_amount) || 0)}
                    </p>
                  </>
                );
              })()}
            </section>

            <div className="flex justify-end gap-2 pt-0.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!form.owner.trim() || !form.size}
              >
                {editingId ? "Save changes" : "Add Property"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Owners manager */}
      <Dialog open={ownersOpen} onOpenChange={setOwnersOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="shrink-0">
            <DialogTitle>Owners</DialogTitle>
            <DialogDescription>
              Add owners with WhatsApp number for the property dropdown.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 flex flex-col gap-3 overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 shrink-0">
              <Input
                value={newOwnerName}
                onChange={(e) => setNewOwnerName(e.target.value)}
                placeholder="Owner name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddOwner();
                  }
                }}
              />
              <Input
                value={newOwnerWhatsapp}
                onChange={(e) => setNewOwnerWhatsapp(e.target.value)}
                placeholder="WhatsApp number"
                inputMode="tel"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddOwner();
                  }
                }}
              />
              <Button
                type="button"
                onClick={handleAddOwner}
                className="gap-1 shrink-0"
              >
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
            {owners.length === 0 ? (
              <p className="text-sm text-slate-500">No owners yet.</p>
            ) : (
              <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain divide-y rounded-lg border">
                {owners.map((o) => (
                  <li
                    key={o.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2.5 text-sm"
                  >
                    <span className="font-medium text-slate-800 sm:w-36 shrink-0">
                      {o.name}
                    </span>
                    <Input
                      className="h-9 flex-1"
                      value={ownerWhatsappValue(o)}
                      onChange={(e) =>
                        setOwnerWhatsappDrafts((prev) => ({
                          ...prev,
                          [o.id]: e.target.value,
                        }))
                      }
                      onBlur={() => saveOwnerWhatsapp(o.id)}
                      placeholder="WhatsApp number"
                      inputMode="tel"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-red-600 shrink-0 self-end sm:self-auto"
                      onClick={() => handleRemoveOwner(o.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-500 shrink-0">
              Use international format if possible (e.g. 393331234567). Removing
              an owner only hides them from the dropdown — places stay.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive place</DialogTitle>
            <DialogDescription>
              Soft-archive only — not permanently deleted. Past/today stay
              visible (view only). Tomorrow+ only if already assigned. You can
              restore below. History stays in reports.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Select value={removeId || undefined} onValueChange={setRemoveId}>
              <SelectTrigger>
                <SelectValue placeholder="Select property" />
              </SelectTrigger>
              <SelectContent>
                {items.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — {p.owner}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRemoveOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleRemove}
                disabled={!removeId}
              >
                Archive
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
