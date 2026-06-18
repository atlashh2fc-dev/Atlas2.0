import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  updateUserRole,
  toggleUserActive,
  createTeam,
  createUserAccount,
  updateTeamSupervisor,
} from "@/app/actions/admin";
import type { AppRole } from "@/lib/types";

const ROLES: AppRole[] = ["agente", "supervisor", "admin"];

export default async function UsersAdminPage() {
  await requireProfile(["admin"]);
  const supabase = await createClient();

  const { data: users } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });

  const { data: teams } = await supabase.from("teams").select("*").order("name");

  const supervisors = (users ?? []).filter((u) => u.role === "supervisor");
  const supervisorName = (id: string | null) =>
    supervisors.find((s) => s.id === id)?.full_name ?? "Sin supervisor";
  const teamOf = (teamId: string | null) => (teams ?? []).find((t) => t.id === teamId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Usuarios</h1>
        <p className="text-sm text-muted-foreground">
          Gestiona roles, equipos y crea nuevas cuentas directamente desde aquí.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Crear usuario</h2>
        <form action={createUserAccount} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Nombre</label>
            <input
              type="text"
              name="full_name"
              required
              placeholder="Nombre completo"
              className="w-44 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Correo</label>
            <input
              type="email"
              name="email"
              required
              placeholder="correo@ejemplo.com"
              className="w-52 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Contraseña</label>
            <input
              type="text"
              name="password"
              required
              minLength={6}
              placeholder="Mínimo 6 caracteres"
              className="w-40 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Rol</label>
            <select
              name="role"
              defaultValue="agente"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Equipo</label>
            <select
              name="team_id"
              defaultValue=""
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Sin equipo</option>
              {(teams ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Crear usuario
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Nombre</th>
              <th className="px-5 py-3 font-medium">Correo</th>
              <th className="px-5 py-3 font-medium">Rol</th>
              <th className="px-5 py-3 font-medium">Equipo</th>
              <th className="px-5 py-3 font-medium">Supervisor</th>
              <th className="px-5 py-3 font-medium">Estado</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(users ?? []).map((u) => (
              <tr key={u.id}>
                <td className="px-5 py-3 font-medium text-foreground">{u.full_name}</td>
                <td className="px-5 py-3 text-muted-foreground">{u.email}</td>
                <td className="px-5 py-3">
                  <form action={updateUserRole} className="flex items-center gap-2">
                    <input type="hidden" name="user_id" value={u.id} />
                    <select
                      name="role"
                      defaultValue={u.role}
                      className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <select
                      name="team_id"
                      defaultValue={u.team_id ?? ""}
                      className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                    >
                      <option value="">Sin equipo</option>
                      {(teams ?? []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                    >
                      Guardar
                    </button>
                  </form>
                </td>
                <td className="px-5 py-3 text-muted-foreground">
                  {teamOf(u.team_id)?.name ?? "—"}
                </td>
                <td className="px-5 py-3 text-muted-foreground">
                  {u.role === "agente"
                    ? supervisorName(teamOf(u.team_id)?.supervisor_id ?? null)
                    : "—"}
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                      u.active ? "bg-success-bg text-success" : "bg-danger-bg text-danger"
                    }`}
                  >
                    {u.active ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <form action={toggleUserActive}>
                    <input type="hidden" name="user_id" value={u.id} />
                    <input type="hidden" name="active" value={String(u.active)} />
                    <button
                      type="submit"
                      className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-muted"
                    >
                      {u.active ? "Desactivar" : "Activar"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Equipos</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          El supervisor de un equipo define de quién dependen sus agentes (según el equipo
          asignado a cada usuario arriba).
        </p>
        <ul className="mb-4 space-y-2 text-sm">
          {(teams ?? []).map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
            >
              <span className="font-medium text-foreground">{t.name}</span>
              <form action={updateTeamSupervisor} className="flex items-center gap-2">
                <input type="hidden" name="team_id" value={t.id} />
                <select
                  name="supervisor_id"
                  defaultValue={t.supervisor_id ?? ""}
                  className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                >
                  <option value="">Sin supervisor</option>
                  {supervisors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                >
                  Guardar
                </button>
              </form>
            </li>
          ))}
          {(teams ?? []).length === 0 && (
            <li className="text-muted-foreground">No hay equipos creados.</li>
          )}
        </ul>
        <form action={createTeam} className="flex max-w-lg flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Nombre del equipo</label>
            <input
              type="text"
              name="name"
              required
              placeholder="Nombre del equipo"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Supervisor</label>
            <select
              name="supervisor_id"
              defaultValue=""
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Sin supervisor</option>
              {supervisors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Crear
          </button>
        </form>
      </div>
    </div>
  );
}
