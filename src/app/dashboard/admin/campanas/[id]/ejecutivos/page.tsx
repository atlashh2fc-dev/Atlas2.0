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
import { ActionForm, ActionSubmit, SectionCard } from "@/components/ui";

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
        title={`Ejecutivos asignados (${(members ?? []).length})`}
        description="Al asignar un ejecutivo, Atlas habilita por detrás su extensión, campaña activa y colas vinculadas. El permiso híbrido solo agrega llamadas manuales seguras."
      >
        {(members ?? []).length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
            <span className="mr-auto text-xs text-muted-foreground">
              Puedes habilitar algunos ejecutivos o todos.
            </span>
            <ActionForm action={setCampaignManualDialForAll} success="Modo híbrido habilitado para todos">
              <input type="hidden" name="campaign_id" value={id} />
              <input type="hidden" name="enabled" value="true" />
              <ActionSubmit size="sm" pendingLabel="Habilitando…">Habilitar todos</ActionSubmit>
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
            <p className="p-5 text-sm text-muted-foreground">
              Sin ejecutivos asignados. La campaña no puede operar hasta que tenga al menos uno.
            </p>
          )}

          {(members ?? []).map((member) => {
            const profileRaw = member.profiles as
              | { full_name: string; email: string }
              | { full_name: string; email: string }[]
              | null;
            const profile = Array.isArray(profileRaw) ? profileRaw[0] ?? null : profileRaw;
            const memberSchedules = schedulesByMembership.get(member.id) ?? [];

            return (
              <div key={member.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{profile?.full_name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{profile?.email ?? "—"}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${member.manual_dial_enabled ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                      {member.manual_dial_enabled ? "Híbrido habilitado" : "Solo automático"}
                    </span>
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
                    <ActionForm action={removeCampaignAgent} success="Ejecutivo quitado de la campaña">
                      <input type="hidden" name="campaign_id" value={id} />
                      <input type="hidden" name="membership_id" value={member.id} />
                      <ActionSubmit variant="secondary" size="sm" pendingLabel="Quitando…">
                        Quitar
                      </ActionSubmit>
                    </ActionForm>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {memberSchedules.map((schedule) => (
                    <span
                      key={schedule.id}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[11px] text-primary"
                    >
                      {schedule.days_of_week.map((day) => DAY_LABELS[day]).join(" · ")}{" "}
                      {schedule.start_time.slice(0, 5)}–{schedule.end_time.slice(0, 5)}
                      <ActionForm action={removeCampaignAgentSchedule} success="Horario eliminado">
                        <input type="hidden" name="campaign_id" value={id} />
                        <input type="hidden" name="schedule_id" value={schedule.id} />
                        <button type="submit" aria-label="Eliminar horario" className="font-semibold hover:text-danger">
                          ×
                        </button>
                      </ActionForm>
                    </span>
                  ))}

                  {memberSchedules.length === 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {member.schedule_required
                        ? "Sin horario: no recibirá llamadas automáticas."
                        : "Sin horario especial: opera al conectarse en su campaña activa."}
                    </span>
                  )}
                </div>

                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-primary">
                    Agregar horario especial (opcional)
                  </summary>
                  <ActionForm
                    action={addCampaignAgentSchedule}
                    success="Horario agregado"
                    className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-background p-2"
                  >
                    <input type="hidden" name="campaign_id" value={id} />
                    <input type="hidden" name="membership_id" value={member.id} />
                    <fieldset className="flex gap-1" aria-label="Días de la semana">
                      {DAY_LABELS.map((day, dayIndex) => (
                        <label
                          key={day}
                          className="flex cursor-pointer flex-col items-center gap-0.5 text-[10px] text-muted-foreground"
                        >
                          <input type="checkbox" name="days_of_week" value={dayIndex} className="accent-primary" />
                          {day}
                        </label>
                      ))}
                    </fieldset>
                    <label className="text-[11px] text-muted-foreground">
                      Desde
                      <input
                        required
                        type="time"
                        name="start_time"
                        className="ml-1 rounded border border-border bg-surface px-1 py-0.5 text-xs text-foreground"
                      />
                    </label>
                    <label className="text-[11px] text-muted-foreground">
                      Hasta
                      <input
                        required
                        type="time"
                        name="end_time"
                        className="ml-1 rounded border border-border bg-surface px-1 py-0.5 text-xs text-foreground"
                      />
                    </label>
                    <ActionSubmit size="sm" pendingLabel="Agregando…">
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
            ? "Usa Ctrl o Cmd + clic para elegir varios. Atlas completa automáticamente la habilitación operativa."
            : "Todos los ejecutivos activos ya están en esta campaña."
        }
      >
        <ActionForm action={addCampaignAgent} success="Ejecutivos agregados" className="max-w-xl p-4">
          <input type="hidden" name="campaign_id" value={id} />
          <select
            name="profile_ids"
            multiple
            size={Math.min(Math.max(availableAgents.length, 2), 8)}
            required
            disabled={availableAgents.length === 0}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
          >
            {availableAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.full_name} ({agent.email})
              </option>
            ))}
          </select>
          <ActionSubmit className="mt-3" disabled={availableAgents.length === 0} pendingLabel="Agregando…">
            Agregar seleccionados
          </ActionSubmit>
        </ActionForm>
      </SectionCard>
    </div>
  );
}
