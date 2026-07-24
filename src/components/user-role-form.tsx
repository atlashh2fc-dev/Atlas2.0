"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [role, setRole] = useState<AppRole>(initialRole);
  const [teamId, setTeamId] = useState(initialTeamId ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function save(formData: FormData) {
    setMessage(null);
    setError(null);

    startTransition(async () => {
      try {
        await updateUserRole(formData);
        setMessage("Guardado");
        // Server Actions invalidan datos, pero el Router Cache del cliente puede
        // seguir mostrando la fila anterior. Forzamos una lectura fresca antes
        // de informar éxito para que el selector muestre el valor persistido.
        router.refresh();
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
        value={role}
        onChange={(event) => setRole(event.target.value as AppRole)}
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
        value={teamId}
        onChange={(event) => setTeamId(event.target.value)}
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
