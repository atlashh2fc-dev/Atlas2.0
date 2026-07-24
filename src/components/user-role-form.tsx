"use client";

import { useState, useTransition } from "react";
import { updateUserRole } from "@/app/actions/admin";
import type { AppRole } from "@/lib/types";
import { Button, Select } from "@/components/ui";

const ROLES: AppRole[] = ["agente", "supervisor", "admin"];

type TeamOption = { id: string; name: string };

export function UserRoleForm({
  userId,
  initialRole,
  initialTeamId,
  teams,
}: {
  userId: string;
  initialRole: AppRole;
  initialTeamId: string | null;
  teams: TeamOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function save(formData: FormData) {
    setMessage(null);
    setError(null);

    startTransition(async () => {
      try {
        await updateUserRole(formData);
        setMessage("Guardado");
        // El Router Cache puede conservar la lista anterior incluso después de
        // revalidatePath. Una recarga completa obliga a consultar el rol que
        // acaba de persistirse antes de volver a pintar la tabla.
        window.location.reload();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "No se pudo guardar el cambio.");
      }
    });
  }

  return (
    <form action={save} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <Select
        name="role"
        fieldSize="sm"
        defaultValue={initialRole}
        disabled={isPending}
        className="w-auto"
      >
        {ROLES.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </Select>
      <Select
        name="team_id"
        fieldSize="sm"
        defaultValue={initialTeamId ?? ""}
        disabled={isPending}
        className="w-auto"
      >
        <option value="">Sin equipo</option>
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Guardando…" : "Guardar"}
      </Button>
      <span aria-live="polite" className="text-xs">
        {message && <span className="text-success">{message}</span>}
        {error && <span className="text-danger">{error}</span>}
      </span>
    </form>
  );
}
