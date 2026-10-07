"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateUserRole } from "@/app/actions/admin";
import type { AppRole } from "@/lib/types";
import { Button, Select } from "@/components/ui";

const ROLES: AppRole[] = ["agente", "supervisor", "calidad", "admin"];
const ROLE_LABEL: Record<AppRole, string> = {
  agente: "Agente",
  supervisor: "Supervisor",
  admin: "Administrador",
  calidad: "Calidad",
};

type TeamOption = { id: string; name: string };

export function UserRoleForm({
  userId,
  initialRole,
  initialTeamId,
  initialSupervisorTeamIds,
  teams,
}: {
  userId: string;
  initialRole: AppRole;
  initialTeamId: string | null;
  initialSupervisorTeamIds: string[];
  teams: TeamOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [role, setRole] = useState<AppRole>(initialRole);
  const [supervisorTeamIds, setSupervisorTeamIds] = useState(() => new Set(initialSupervisorTeamIds));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function save(formData: FormData) {
    setMessage(null);
    setError(null);

    startTransition(async () => {
      try {
        await updateUserRole(formData);
        setMessage("Guardado");
        // router.refresh() vuelve a pedir la ruta actual al servidor sin pasar
        // por el Router Cache, así la tabla muestra el rol recién guardado sin
        // la recarga completa que perdía filtros, scroll y selección.
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "No se pudo guardar el cambio.");
      }
    });
  }

  const isSupervisor = role === "supervisor";

  return (
    <form action={save} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="user_id" value={userId} />
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-xs font-medium text-foreground">Rol de acceso</span>
        <Select
          name="role"
          fieldSize="sm"
          value={role}
          onChange={(event) => setRole(event.target.value as AppRole)}
          disabled={isPending}
          aria-label="Rol de acceso"
        >
          {ROLES.map((item) => (
            <option key={item} value={item}>
              {ROLE_LABEL[item]}
            </option>
          ))}
        </Select>
      </label>
      {isSupervisor ? (
        <fieldset className="min-w-0 sm:col-span-2">
          <legend className="text-xs font-medium text-foreground">Equipos supervisados</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {teams.map((team) => {
              const checked = supervisorTeamIds.has(team.id);
              return (
                <label
                  key={team.id}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
                    checked ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:border-primary/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    name="supervisor_team_ids"
                    value={team.id}
                    checked={checked}
                    disabled={isPending}
                    onChange={() => setSupervisorTeamIds((current) => {
                      const next = new Set(current);
                      if (next.has(team.id)) next.delete(team.id);
                      else next.add(team.id);
                      return next;
                    })}
                    className="size-3.5 accent-primary"
                  />
                  {team.name}
                </label>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Marca todos los equipos que este supervisor debe administrar.</p>
        </fieldset>
      ) : (
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-medium text-foreground">Equipo</span>
          <Select name="team_id" fieldSize="sm" defaultValue={initialTeamId ?? ""} disabled={isPending} aria-label="Equipo">
            <option value="">Sin equipo asignado</option>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </Select>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button type="submit" variant="secondary" size="sm" disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar cambios"}
        </Button>
        <span aria-live="polite" className="text-xs">
          {message && <span className="text-success">{message}</span>}
          {error && <span className="text-danger">{error}</span>}
        </span>
      </div>
    </form>
  );
}
