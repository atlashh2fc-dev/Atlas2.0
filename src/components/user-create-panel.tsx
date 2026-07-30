"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { createUserAccount } from "@/app/actions/admin";
import type { AppRole } from "@/lib/types";
import { ActionForm, ActionSubmit, Button, Field, Input, SlideOver, buttonClasses } from "@/components/ui";

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "agente", label: "Agente" },
  { value: "supervisor", label: "Supervisor" },
  { value: "admin", label: "Administrador" },
];

export function UserCreatePanel({ teams }: { teams: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClasses()}>
        <Plus size={16} aria-hidden="true" />
        Nuevo usuario
      </button>

      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        title="Nuevo usuario"
        description="La cuenta queda activa de inmediato con la contraseña temporal que definas."
      >
        <ActionForm
          action={createUserAccount}
          success="Usuario creado"
          onSuccess={() => setOpen(false)}
          className="space-y-4"
        >
          <Field label="Nombre completo">
            <Input name="full_name" required placeholder="María Fernández" data-autofocus />
          </Field>

          <Field label="Correo">
            <Input type="email" name="email" required placeholder="maria@empresa.cl" />
          </Field>

          <Field label="Contraseña temporal">
            <Input type="text" name="password" required minLength={6} placeholder="Mínimo 6 caracteres" />
          </Field>
          <p className="-mt-2 text-xs text-muted-foreground">
            Compártela por un canal seguro y pídele que la cambie al primer ingreso.
          </p>

          <Field label="Rol">
            <select
              name="role"
              defaultValue="agente"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Equipo">
            <select
              name="team_id"
              defaultValue=""
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Sin equipo</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <ActionSubmit pendingLabel="Creando…">Crear usuario</ActionSubmit>
          </div>
        </ActionForm>
      </SlideOver>
    </>
  );
}
