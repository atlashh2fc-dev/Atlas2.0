"use client";

import { useCallback, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Headset, KeyRound, ShieldCheck, type LucideIcon } from "lucide-react";
import { bulkSetUserActive, toggleUserActive } from "@/app/actions/admin";
import type { AppRole } from "@/lib/types";
import { UserRoleForm } from "@/components/user-role-form";
import { AgentCampaignsDialog } from "@/components/agent-campaigns-dialog";
import { UserPasswordDialog } from "@/components/user-password-dialog";
import {
  ActionForm,
  ActionSubmit,
  Badge,
  DataTable,
  useToast,
  type BulkAction,
  type Column,
} from "@/components/ui";

const ROLE_LABEL: Record<AppRole, string> = {
  agente: "Agente",
  supervisor: "Supervisor",
  admin: "Administrador",
};

/** Chip del rol: ejecutivos en azul (personas), supervisión en violeta, administración en gris. */
const ROLE_CHIP: Record<AppRole, { icon: LucideIcon; tone: "blue" | "violet" | "slate" }> = {
  agente: { icon: Headset, tone: "blue" },
  supervisor: { icon: ShieldCheck, tone: "violet" },
  admin: { icon: KeyRound, tone: "slate" },
};

export type UserRow = {
  id: string;
  full_name: string;
  email: string;
  role: AppRole;
  team_id: string | null;
  active: boolean;
  team_name: string | null;
  supervisor_names: string[];
  supervised_team_ids: string[];
  campaign_ids: string[];
};

export function UsersTable({
  rows,
  teams,
  campaigns,
  canEditAccess = true,
}: {
  rows: UserRow[];
  teams: { id: string; name: string }[];
  campaigns: { id: string; name: string }[];
  /** Rol y equipo son de administración: un supervisor ve la tabla sin esa columna. */
  canEditAccess?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const campaignNameById = useMemo(
    () => new Map(campaigns.map((campaign) => [campaign.id, campaign.name])),
    [campaigns]
  );

  const apply = useCallback(
    (ids: string[], active: boolean) =>
      startTransition(async () => {
        const result = await bulkSetUserActive(ids, active);
        if (result.error) {
          toast({ tone: "danger", message: `No se pudo completar: ${result.error}` });
          return;
        }
        toast({
          tone: "success",
          message: `${result.ok} ${result.ok === 1 ? "cuenta" : "cuentas"} ${active ? "activadas" : "desactivadas"}`,
        });
        router.refresh();
      }),
    [router, toast, startTransition]
  );

  const columns = useMemo<Column<UserRow>[]>(
    () => ([
      {
        id: "usuario",
        header: "Usuario",
        value: (row) => row.full_name,
        cell: (row) => {
          const { icon: RoleIcon, tone } = ROLE_CHIP[row.role];
          return (
            <span className="flex items-start gap-3">
              <span
                className={`icon-chip mt-0.5 size-8 rounded-full ${row.active ? "" : "opacity-50"}`}
                data-tone={tone}
                aria-hidden="true"
              >
                <RoleIcon size={15} />
              </span>
              <span className="block min-w-0 space-y-2">
                <span className="block">
                  <span className="font-medium text-foreground">{row.full_name}</span>
                  <span className="mt-0.5 block break-all text-xs text-muted-foreground">{row.email}</span>
                  {row.role === "agente" && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Supervisores: {row.supervisor_names.length > 0 ? row.supervisor_names.join(" · ") : "Sin supervisor"}
                    </span>
                  )}
                </span>
                <UserPasswordDialog user={{ id: row.id, fullName: row.full_name, email: row.email }} />
              </span>
            </span>
          );
        },
      },
      {
        id: "rol",
        header: "Rol",
        value: (row) => ROLE_LABEL[row.role],
        cell: (row) => <Badge tone="neutral">{ROLE_LABEL[row.role]}</Badge>,
      },
      {
        id: "equipo",
        header: "Equipo",
        value: (row) => row.team_name ?? "",
        cell: (row) => row.team_name ?? <span className="text-muted-foreground">Sin equipo</span>,
      },
      {
        id: "acceso",
        header: "Acceso y equipo",
        sortable: false,
        cell: (row) => (
          <UserRoleForm
            userId={row.id}
            initialRole={row.role}
            initialTeamId={row.team_id}
            initialSupervisorTeamIds={row.supervised_team_ids}
            teams={teams}
          />
        ),
        className: "min-w-80",
      },
      {
        id: "estado",
        header: "Estado",
        value: (row) => (row.active ? "Activo" : "Inactivo"),
        cell: (row) => (
          <span className="block space-y-2">
            <Badge tone={row.active ? "success" : "danger"}>{row.active ? "Activo" : "Inactivo"}</Badge>
            <ActionForm
              action={toggleUserActive}
              success={row.active ? "Usuario desactivado" : "Usuario activado"}
            >
              <input type="hidden" name="user_id" value={row.id} />
              <input type="hidden" name="active" value={String(row.active)} />
              <ActionSubmit variant="secondary" size="sm" pendingLabel="Guardando…">
                {row.active ? "Desactivar" : "Activar"}
              </ActionSubmit>
            </ActionForm>
          </span>
        ),
      },
      {
        id: "campanas",
        header: "Campañas",
        value: (row) => row.campaign_ids.length,
        cell: (row) =>
          row.role === "agente" ? (
            <span className="block space-y-2">
              <span className="flex max-w-56 flex-wrap gap-x-3 gap-y-1">
                {row.campaign_ids.map((campaignId) => (
                  <Badge key={campaignId} tone="info">
                    {campaignNameById.get(campaignId) ?? "Campaña"}
                  </Badge>
                ))}
                {row.campaign_ids.length === 0 && (
                  <span className="text-xs text-muted-foreground">Sin campañas</span>
                )}
              </span>
              <AgentCampaignsDialog
                agent={{ id: row.id, fullName: row.full_name, email: row.email }}
                campaignIds={row.campaign_ids}
                campaigns={campaigns}
              />
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No aplica</span>
          ),
      },
    ] as Column<UserRow>[]).filter((column) => canEditAccess || column.id !== "acceso"),
    [campaignNameById, campaigns, teams, canEditAccess]
  );

  const bulkActions = useMemo<BulkAction<UserRow>[]>(
    () => [
      {
        id: "activate",
        label: pending ? "Aplicando…" : "Activar",
        onAction: (selected) => apply(selected.map((row) => row.id), true),
      },
      {
        id: "deactivate",
        label: pending ? "Aplicando…" : "Desactivar",
        variant: "ghost",
        onAction: (selected) => apply(selected.map((row) => row.id), false),
      },
    ],
    [apply, pending]
  );

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      selectable
      bulkActions={bulkActions}
      storageKey="usuarios"
      exportFilename="usuarios"
      emptyTitle="No hay usuarios con estos filtros"
      emptyDescription="Cambia el rol, el estado o la campaña que estás revisando."
    />
  );
}
