"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { createUserAccount } from "@/app/actions/admin";
import type { AppRole } from "@/lib/types";
import { ActionForm, ActionSubmit, Button, Field, Input, Select, SlideOver, buttonClasses } from "@/components/ui";

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "agente", label: "Agente" },
  { value: "supervisor", label: "Supervisor" },
  { value: "admin", label: "Administrador" },
];

export function UserCreatePanel({ teams, empresa }: { teams: { id: string; name: string }[]; empresa: string | null }) {
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
        description={`${empresa ? `Queda en ${empresa}. ` : ""}La cuenta queda activa de inmediato. Si es agente, luego asígnale una campaña: Atlas habilitará telefonía y enrutamiento automáticamente.`}
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
            <Input type="text" name="password" required minLength={8} placeholder="Mínimo 8 caracteres" />
          </Field>
          <p className="-mt-2 text-xs text-muted-foreground">
            Compártela por un canal seguro y pídele que la cambie al primer ingreso.
          </p>

          <Field label="Rol">
            <Select name="role" defaultValue="agente">
              {ROLE_OPTIONS.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Equipo">
            <Select name="team_id" defaultValue="">
              <option value="">Sin equipo</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
          </Field>

          <label className="flex items-start gap-2 rounded-xl border border-border bg-surface-muted/40 p-3 text-sm text-foreground">
            <input type="checkbox" name="is_demo" value="1" className="mt-0.5 accent-primary" />
            <span>
              Cuenta de demostración
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Agrega un selector en el encabezado para alternar entre la vista de ejecutivo y la
                de supervisor sin cerrar sesión. No entrega permisos de administración.
              </span>
            </span>
          </label>

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
