import { Clock, Users, X } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  addCampaignAgent,
  addCampaignAgentSchedule,
  removeCampaignAgent,
  removeCampaignAgentSchedule,
  setCampaignAgentManualDial,
  setCampaignManualDialForAll,
} from "@/app/actions/campaigns";
import { ActionForm, ActionSubmit, Avatar, Badge, EmptyState, SectionCard } from "@/components/ui";
import { Conteo, PieDeFormulario } from "../../../_diseno";

type CampaignAgentSchedule = {
  id: string;
  campaign_agent_id: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  timezone: string;
};

const DAY_LABELS = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"];

export default async function CampaignAgentsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: members }, { data: agents }] = await Promise.all([
    supabase
      .from("campaign_agents")
      .select("id, profile_id, schedule_required, manual_dial_enabled, profiles(full_name, email)")
      .eq("campaign_id", id)
      .order("assigned_at", { ascending: true }),
    supabase.from("profiles").select("id, full_name, email").eq("role", "agente").order("full_name"),
  ]);

  const { data: schedules } =
    (members ?? []).length > 0
      ? await supabase
          .from("campaign_agent_schedules")
          .select("id, campaign_agent_id, days_of_week, start_time, end_time, timezone")
          .in(
            "campaign_agent_id",
            (members ?? []).map((member) => member.id)
          )
          .order("start_time")
      : { data: [] };

  const assignedIds = new Set((members ?? []).map((member) => member.profile_id));
  const availableAgents = (agents ?? []).filter((agent) => !assignedIds.has(agent.id));

  const schedulesByMembership = new Map<string, CampaignAgentSchedule[]>();
  for (const schedule of (schedules ?? []) as CampaignAgentSchedule[]) {
    schedulesByMembership.set(schedule.campaign_agent_id, [
      ...(schedulesByMembership.get(schedule.campaign_agent_id) ?? []),
      schedule,
    ]);
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title={
          <>
            Ejecutivos asignados
            <Conteo>{(members ?? []).length}</Conteo>
          </>
        }
        description="Al asignar un ejecutivo, Atlas habilita por detrás su extensión, campaña activa y colas vinculadas. El permiso híbrido solo agrega llamadas manuales seguras."
      >
        {(members ?? []).length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-y border-border bg-surface-raised px-5 py-2.5">
            <span className="mr-auto text-xs text-muted-foreground">
              Puedes habilitar algunos ejecutivos o todos.
            </span>
            <ActionForm action={setCampaignManualDialForAll} success="Modo híbrido habilitado para todos">
              <input type="hidden" name="campaign_id" value={id} />
              <input type="hidden" name="enabled" value="true" />
              <ActionSubmit variant="secondary" size="sm" pendingLabel="Habilitando…">Habilitar todos</ActionSubmit>
            </ActionForm>
            <ActionForm action={setCampaignManualDialForAll} success="Modo híbrido deshabilitado para todos">
              <input type="hidden" name="campaign_id" value={id} />
              <input type="hidden" name="enabled" value="false" />
              <ActionSubmit variant="secondary" size="sm" pendingLabel="Deshabilitando…">
                Deshabilitar todos
              </ActionSubmit>
            </ActionForm>
          </div>
        )}
        <div className="divide-y divide-border">
          {(members ?? []).length === 0 && (
            <EmptyState
              icon={Users}
              title="Sin ejecutivos asignados."
              description="La campaña no puede operar hasta que tenga al menos uno. Agrégalos abajo."
              className="border-t border-border"
            />
          )}

          {(members ?? []).map((member) => {
            const profileRaw = member.profiles as
              | { full_name: string; email: string }
              | { full_name: string; email: string }[]
              | null;
            const profile = Array.isArray(profileRaw) ? profileRaw[0] ?? null : profileRaw;
            const memberSchedules = schedulesByMembership.get(member.id) ?? [];

            return (
              <div key={member.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar name={profile?.full_name} size="md" className="mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{profile?.full_name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{profile?.email ?? "—"}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Badge tone={member.manual_dial_enabled ? "success" : "neutral"}>
                      {member.manual_dial_enabled ? "Híbrido habilitado" : "Solo automático"}
                    </Badge>
                    <ActionForm
                      action={setCampaignAgentManualDial}
                      success={member.manual_dial_enabled ? "Modo híbrido deshabilitado" : "Modo híbrido habilitado"}
                    >
                      <input type="hidden" name="campaign_id" value={id} />
                      <input type="hidden" name="membership_id" value={member.id} />
                      <input type="hidden" name="enabled" value={member.manual_dial_enabled ? "false" : "true"} />
                      <ActionSubmit variant="secondary" size="sm" pendingLabel="Guardando…">
                        {member.manual_dial_enabled ? "Deshabilitar híbrido" : "Habilitar híbrido"}
                      </ActionSubmit>
                    </ActionForm>
                    {/* Quitar desprovisiona extensión y colas: va aparte y pide confirmar. */}
                    <ActionForm
                      action={removeCampaignAgent}
                      success="Ejecutivo quitado de la campaña"
                      className="ml-3"
                      confirm={{
                        title: `¿Quitar a ${profile?.full_name ?? "este ejecutivo"} de la campaña?`,
                        description:
                          "Atlas le retira la extensión y las colas de esta campaña: deja de recibir sus llamadas desde ahora. Puedes volver a agregarlo más abajo, en Agregar ejecutivos.",
                        confirmLabel: "Quitar de la campaña",
                        tone: "danger",
                      }}
                    >
                      <input type="hidden" name="campaign_id" value={id} />
                      <input type="hidden" name="membership_id" value={member.id} />
                      <ActionSubmit variant="ghost" size="sm" pendingLabel="Quitando…" className="text-danger hover:text-danger">
                        Quitar
                      </ActionSubmit>
                    </ActionForm>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 pl-12">
                  {memberSchedules.map((schedule) => {
                    const days = schedule.days_of_week.map((day) => DAY_LABELS[day]).join(" · ");
                    const range = `${schedule.start_time.slice(0, 5)}–${schedule.end_time.slice(0, 5)}`;
                    return (
                      <span key={schedule.id} className="inline-flex items-center gap-0.5">
                        <Badge tone="neutral" dot={false} className="gap-1">
                          <Clock size={12} aria-hidden="true" />
                          {days} {range}
                        </Badge>
                        {/* Botón propio de 32 px fuera de la etiqueta: la × dentro del Badge era un blanco de 10 px. */}
                        <ActionForm action={removeCampaignAgentSchedule} success="Horario eliminado">
                          <input type="hidden" name="campaign_id" value={id} />
                          <input type="hidden" name="schedule_id" value={schedule.id} />
                          <button
                            type="submit"
                            aria-label={`Eliminar horario ${days} ${range}`}
                            title="Eliminar horario"
                            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <X size={14} aria-hidden="true" />
                          </button>
                        </ActionForm>
                      </span>
                    );
                  })}

                  {memberSchedules.length === 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {member.schedule_required
                        ? "Sin horario: no recibirá llamadas automáticas."
                        : "Sin horario especial: opera al conectarse en su campaña activa."}
                    </span>
                  )}
                </div>

                <details className="mt-2 pl-12">
                  <summary className="cursor-pointer text-xs font-medium text-primary">
                    Agregar horario especial (opcional)
                  </summary>
                  <ActionForm
                    action={addCampaignAgentSchedule}
                    success="Horario agregado"
                    className="mt-2 flex flex-wrap items-end gap-3 rounded-lg bg-surface-raised px-3 py-2.5"
                  >
                    <input type="hidden" name="campaign_id" value={id} />
                    <input type="hidden" name="membership_id" value={member.id} />
                    <fieldset className="flex gap-1" aria-label="Días de la semana">
                      {DAY_LABELS.map((day, dayIndex) => (
                        <label
                          key={day}
                          className="flex cursor-pointer flex-col items-center gap-0.5 text-xs text-muted-foreground"
                        >
                          <input type="checkbox" name="days_of_week" value={dayIndex} className="accent-primary" />
                          {day}
                        </label>
                      ))}
                    </fieldset>
                    <label className="text-xs text-muted-foreground">
                      Desde
                      <input
                        required
                        type="time"
                        name="start_time"
                        className="ml-1 h-8 rounded-lg border border-border-strong/70 bg-surface px-2 text-xs text-foreground shadow-sm"
                      />
                    </label>
                    <label className="text-xs text-muted-foreground">
                      Hasta
                      <input
                        required
                        type="time"
                        name="end_time"
                        className="ml-1 h-8 rounded-lg border border-border-strong/70 bg-surface px-2 text-xs text-foreground shadow-sm"
                      />
                    </label>
                    <ActionSubmit variant="secondary" size="sm" pendingLabel="Agregando…">
                      Agregar
                    </ActionSubmit>
                  </ActionForm>
                </details>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="Agregar ejecutivos"
        description={
          availableAgents.length > 0
            ? "Marca a quienes quieres sumar. Atlas completa automáticamente la habilitación operativa."
            : "Todos los ejecutivos activos ya están en esta campaña."
        }
      >
        <ActionForm action={addCampaignAgent} success="Ejecutivos agregados" className="border-t border-border">
          <input type="hidden" name="campaign_id" value={id} />
          {/* Lista con casilla, como en Miembros de la cola: el multiselect
              nativo exigía Ctrl/Cmd + clic y un clic suelto borraba la selección. */}
          {availableAgents.length > 0 && (
            <fieldset className="grid gap-x-2 gap-y-0.5 px-3 py-3 sm:grid-cols-2 xl:grid-cols-3">
              <legend className="sr-only">Ejecutivos disponibles</legend>
              {availableAgents.map((agent) => (
                <label
                  key={agent.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-muted/70 has-[:checked]:bg-primary/[0.06]"
                >
                  <input type="checkbox" name="profile_ids" value={agent.id} className="size-4 accent-primary" />
                  <Avatar name={agent.full_name} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{agent.full_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{agent.email}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <PieDeFormulario>
            <ActionSubmit disabled={availableAgents.length === 0} pendingLabel="Agregando…">
              Agregar seleccionados
            </ActionSubmit>
          </PieDeFormulario>
        </ActionForm>
      </SectionCard>
    </div>
  );
}
