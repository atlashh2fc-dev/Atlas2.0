"use client";

import { useState } from "react";
import { UserRoundCog } from "lucide-react";
import { assignLead } from "@/app/actions/admin";
import { ActionForm, ActionSubmit, Button, Field, Select, SlideOver, buttonClasses } from "@/components/ui";

type AgentOption = { id: string; full_name: string };

/**
 * Reasignar el registro sin salir de la ficha. El supervisor antes caía en
 * Mi equipo, donde el cliente que tenía abierto no aparecía; el admin, en una
 * búsqueda de Registros donde había que marcarlo y volver a elegir la acción.
 */
export function LeadReassignPanel({
  leadId,
  leadName,
  currentAgentId,
  currentAgentName,
  teamName,
  hasPendingAgenda,
  agents,
}: {
  leadId: string;
  leadName: string;
  currentAgentId: string | null;
  currentAgentName: string | null;
  teamName: string | null;
  hasPendingAgenda: boolean;
  /** Ejecutivos activos que pueden recibir el registro (los del equipo del registro). */
  agents: AgentOption[];
}) {
  const [open, setOpen] = useState(false);
  const candidates = agents.filter((agent) => agent.id !== currentAgentId);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClasses({ variant: "secondary" })}>
        <UserRoundCog size={15} aria-hidden="true" />
        Reasignar
      </button>

      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        title="Reasignar registro"
        description={leadName}
      >
        <ActionForm
          action={assignLead}
          success="Registro reasignado"
          onSuccess={() => setOpen(false)}
          className="space-y-4"
        >
          <input type="hidden" name="lead_id" value={leadId} />

          <dl className="grid grid-cols-2 gap-3 rounded-md border border-border bg-surface-muted/40 p-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Ejecutivo actual</dt>
              <dd className="font-medium">{currentAgentName ?? "Sin asignar"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Equipo</dt>
              <dd className="font-medium">{teamName ?? "Sin equipo"}</dd>
            </div>
          </dl>

          {candidates.length > 0 ? (
            <Field label="Asignar a">
              <Select name="agent_id" defaultValue="" required data-autofocus>
                <option value="" disabled>
                  Selecciona un ejecutivo
                </option>
                {candidates.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.full_name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <p className="text-sm text-muted-foreground">
              No hay otro ejecutivo activo en el equipo de este registro.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            {hasPendingAgenda
              ? "La agenda pendiente pasa al nuevo ejecutivo. El cambio queda registrado en el historial."
              : "El cambio queda registrado en el historial del registro."}
          </p>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <ActionSubmit pendingLabel="Reasignando…" disabled={candidates.length === 0}>
              Reasignar
            </ActionSubmit>
          </div>
        </ActionForm>
      </SlideOver>
    </>
  );
}
