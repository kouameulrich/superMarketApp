"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveUser, setUserActive, changeOwnPassword, type UserInput } from "@/lib/actions";
import { Badge, Card, CardHeader } from "@/components/ui";

export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  role: "CASHIER" | "STOCK" | "LOGISTICS" | "ADMIN" | "SUPER_ADMIN";
  active: boolean;
  createdAt: string;
}

const ROLE_OPTIONS: Array<{ value: UserRow["role"]; label: string }> = [
  { value: "CASHIER", label: "Caissier·ère — POS uniquement" },
  { value: "STOCK", label: "Gestionnaire stock — POS, stock, transferts" },
  { value: "LOGISTICS", label: "Logistique — + fournisseurs & achats" },
  { value: "ADMIN", label: "Administrateur — accès complet" },
  { value: "SUPER_ADMIN", label: "Super admin — accès complet" },
];
const ROLE_TONE: Record<UserRow["role"], "blue" | "violet" | "amber" | "green" | "red"> = {
  CASHIER: "amber",
  STOCK: "blue",
  LOGISTICS: "violet",
  ADMIN: "green",
  SUPER_ADMIN: "green",
};

const EMPTY: UserInput = { username: "", displayName: "", role: "CASHIER", password: "" };

export function UsersClient({ users, currentUsername }: { users: UserRow[]; currentUsername: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<UserInput>(EMPTY);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [self, setSelf] = useState({ current: "", next: "", confirm: "" });
  const [selfError, setSelfError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 4000);
  };

  const openCreate = () => {
    setForm(EMPTY);
    setEditing(null);
    setError(null);
    setShowForm(true);
  };

  const openEdit = (u: UserRow) => {
    setForm({ id: u.id, username: u.username, displayName: u.displayName, role: u.role, password: "" });
    setEditing(u);
    setError(null);
    setShowForm(true);
  };

  const submit = async () => {
    setError(null);
    const res = await saveUser({ ...form, username: editing ? form.username : form.username.trim().toLowerCase() });
    if (res.ok) {
      setShowForm(false);
      flash(editing ? "Utilisateur modifié" : "Utilisateur créé");
      startTransition(() => router.refresh());
    } else {
      setError(res.error);
    }
  };

  const toggleActive = async (u: UserRow) => {
    const res = await setUserActive(u.id, !u.active);
    if (res.ok) {
      flash(u.active ? `${u.displayName} désactivé` : `${u.displayName} réactivé`);
      startTransition(() => router.refresh());
    } else {
      setError(res.error);
      setTimeout(() => setError(null), 5000);
    }
  };

  const changeSelfPassword = async () => {
    setSelfError(null);
    if (self.next !== self.confirm) {
      setSelfError("Les mots de passe ne concordent pas");
      return;
    }
    const res = await changeOwnPassword(self.current, self.next);
    if (res.ok) {
      setSelf({ current: "", next: "", confirm: "" });
      flash("Mot de passe personnel modifié");
    } else {
      setSelfError(res.error);
    }
  };

  return (
    <div className="space-y-4">
      {toast && (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950 px-4 py-2 text-sm text-emerald-200">{toast}</div>
      )}

      <Card>
        <CardHeader
          title="Comptes du tenant"
          subtitle="Rôles : caissier (POS seul) · stock · logistique · administrateur. Le rôle en session est relu en base à chaque navigation."
          action={
            <button onClick={openCreate} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400">
              + Utilisateur
            </button>
          }
        />
        {error && <p className="mx-4 rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-300">{error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-800">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-100">{u.displayName}</p>
                    <p className="text-xs text-slate-500">@{u.username}</p>
                  </td>
                  <td className="px-2 py-3">
                    <Badge tone={ROLE_TONE[u.role]}>{ROLE_OPTIONS.find((r) => r.value === u.role)?.label ?? u.role}</Badge>
                  </td>
                  <td className="px-2 py-3">
                    {u.active ? <Badge tone="green">actif</Badge> : <Badge tone="red">désactivé</Badge>}
                    {u.username === currentUsername && <span className="ml-2 text-[10px] text-slate-500">(vous)</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => openEdit(u)} className="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-emerald-500 hover:text-emerald-300">
                        Modifier
                      </button>
                      <button
                        onClick={() => void toggleActive(u)}
                        disabled={u.username === currentUsername}
                        className={`rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-40 ${
                          u.active ? "border-red-800 text-red-300 hover:bg-red-950" : "border-emerald-700 text-emerald-300 hover:bg-emerald-950"
                        }`}
                      >
                        {u.active ? "Désactiver" : "Réactiver"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td className="px-4 py-6 text-center text-sm text-slate-500" colSpan={4}>Aucun utilisateur.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Mon profil" subtitle="Changez votre propre mot de passe (l'identifiant et le rôle sont gérés par l'administration)" />
        <div className="grid gap-3 p-4 md:grid-cols-3">
          <input type="password" placeholder="Mot de passe actuel" value={self.current} onChange={(e) => setSelf({ ...self, current: e.target.value })}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          <input type="password" placeholder="Nouveau mot de passe (≥ 8)" value={self.next} onChange={(e) => setSelf({ ...self, next: e.target.value })}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          <div className="flex gap-2">
            <input type="password" placeholder="Confirmer" value={self.confirm} onChange={(e) => setSelf({ ...self, confirm: e.target.value })}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
            <button onClick={() => void changeSelfPassword()} disabled={pending}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
              Valider
            </button>
          </div>
        </div>
        {selfError && <p className="mx-4 -mt-2 rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-300">{selfError}</p>}
      </Card>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white">{editing ? `Modifier ${editing.displayName}` : "Nouvel utilisateur"}</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Identifiant (connnexion)</label>
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  readOnly={!!editing}
                  placeholder="prenom.nom"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:opacity-60"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Nom affiché</label>
                <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Rôle</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserInput["role"] })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500">
                  {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">
                  {editing ? "Nouveau mot de passe — laisser vide pour ne pas changer" : "Mot de passe (initial, ≥ 8 caractères)"}
                </label>
                <input type="password" value={form.password ?? ""} onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
              </div>
              {error && <p className="rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-300">{error}</p>}
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowForm(false)} className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm text-slate-300 hover:border-slate-500">
                  Annuler
                </button>
                <button onClick={() => void submit()} disabled={pending}
                  className="flex-1 rounded-lg bg-emerald-500 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
                  {editing ? "Enregistrer" : "Créer le compte"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
