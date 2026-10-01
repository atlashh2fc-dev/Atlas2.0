import { Activity, CheckCircle2, Send } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  createLeadPriorityRule,
  deleteLeadPriorityRule,
  saveLeadOrchestratorConfig,
  toggleLeadPriorityRule,
} from "@/app/actions/lead-orchestrator";
import {
  ActionForm,
  ActionSubmit,
  Avatar,
  Badge,
  Callout,
  EmptyState,
  Field,
  Input,
  SectionCard,
  Select,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@/components/ui";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { FormularioConEncendido } from "../formulario-con-encendido";
import { Conteo, Grupo, PieDeFormulario, fechaLegible } from "../../../_diseno";

/** Estados de lead_orchestrator_assignments en el idioma de quien supervisa. */
const ASSIGNMENT_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  delivered: { label: "Entregado", tone: "info" },
  opened: { label: "Abierto por el ejecutivo", tone: "warning" },
  completed: { label: "Gestionado", tone: "success" },
  expired: { label: "Vencido sin abrir", tone: "danger" },
  cancelled: { label: "Cancelado", tone: "neutral" },
};

const OPERATOR_LABELS: Record<string, string> = {
  eq: "es igual a",
  neq: "es distinto de",
  contains: "contiene",
  gte: "es mayor o igual a",
  lte: "es menor o igual a",
  is_empty: "está vacío",
  is_not_empty: "tiene valor",
};

export default async function CampaignPriorityPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: config }, { data: rules }, assignments, activeAssignments] = await Promise.all([
    supabase.from("lead_orchestrator_configs").select("*").eq("campaign_id", id).maybeSingle(),
    supabase.from("lead_priority_rules").select("*").eq("campaign_id", id).order("position"),
    supabase
      .from("lead_orchestrator_assignments")
      .select("id, status, priority_reason, claimed_at, leads(full_name), profiles(full_name)")
      .eq("campaign_id", id)
      .order("claimed_at", { ascending: false })
      .limit(10),
    supabase
      .from("lead_orchestrator_assignments")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", id)
      .in("status", ["delivered", "opened"]),
  ]);

  const deliveredCount = (assignments.data ?? []).filter((assignment) => assignment.status === "completed").length;
  const defaultPosition = Math.max(0, ...(rules ?? []).map((rule) => rule.position)) + 1;

  return (
    <div className="space-y-5">
      <Callout tone="info">
        Este motor asigna el siguiente lead dentro de Atlas. No inicia llamadas, no se conecta a Asterisk y no utiliza la instancia del discador telefónico.
      </Callout>

      <KpiStrip columns={3}>
        <KpiStripItem
          label="Motor de leads"
          icon={Activity}
          value={config?.is_active ? "En ejecución" : "Detenido"}
          tone={config?.is_active ? "good" : "warn"}
        />
        <KpiStripItem label="Asignaciones activas" icon={Send} value={(activeAssignments.count ?? 0).toLocaleString("es-CL")} />
        <KpiStripItem
          label="Últimas completadas"
          icon={CheckCircle2}
          value={deliveredCount.toLocaleString("es-CL")}
          detail="Dentro de las 10 entregas más recientes"
        />
      </KpiStrip>

      <SectionCard
        title="Motor de asignación"
        description="Solo entrega registros a ejecutivos asignados a esta campaña, disponibles y con Atlas abierto."
      >
        <FormularioConEncendido
          action={saveLeadOrchestratorConfig}
          success="Configuración del motor guardada"
          className="divide-y divide-border border-t border-border"
          toggleName="is_active"
          savedOn={config?.is_active ?? false}
          turnOn={{
            title: "¿Encender el motor de leads?",
            description:
              "Al guardar, el motor empezará a entregar registros de esta campaña a los ejecutivos asignados que estén disponibles.",
            confirmLabel: "Guardar y encender motor",
            tone: "primary",
          }}
          turnOff={{
            title: "¿Detener el motor de leads?",
            description:
              "Al guardar, el motor deja de entregar registros nuevos de esta campaña. Lo que ya está entregado sigue en manos de cada ejecutivo.",
            confirmLabel: "Guardar y detener motor",
            tone: "danger",
          }}
        >
          <input type="hidden" name="campaign_id" value={id} />
          <Grupo titulo="Ritmo de entrega" descripcion="Cada cuánto revisa el motor, cuánto reserva un registro antes de que el ejecutivo lo abra y cuántos entrega por vuelta.">
          <Field label="Intervalo de revisión (segundos)">
            <Input type="number" name="tick_seconds" min="2" max="300" defaultValue={config?.tick_seconds ?? 5} />
          </Field>
          <Field label="Reserva antes de abrir (segundos)">
            <Input type="number" name="assignment_ttl_seconds" min="60" max="14400" defaultValue={config?.assignment_ttl_seconds ?? 300} />
          </Field>
          <Field label="Máximo de entregas por ciclo">
            <Input type="number" name="max_dispatch_per_tick" min="1" max="100" defaultValue={config?.max_dispatch_per_tick ?? 10} />
          </Field>
          </Grupo>
          <Grupo titulo="Orden y encendido" descripcion="El desempate es el fallback: se aplica a lo que no coincide con ninguna regla de abajo.">
          <Field label="Desempate por defecto">
            <Select name="fallback_order" defaultValue={config?.fallback_order ?? "oldest_first"}>
              <option value="oldest_first">Más antiguo primero</option>
              <option value="newest_first">Más reciente primero</option>
            </Select>
          </Field>
          <label className="flex min-h-11 items-center gap-2.5 text-sm text-foreground sm:col-span-2">
            <input type="checkbox" name="is_active" value="true" defaultChecked={config?.is_active ?? false} className="size-4 accent-primary" />
            Motor activo para esta campaña
          </label>
          </Grupo>
          <PieDeFormulario>
            <ActionSubmit pendingLabel="Guardando…">Guardar configuración</ActionSubmit>
          </PieDeFormulario>
        </FormularioConEncendido>
      </SectionCard>

      <SectionCard
        title={
          <>
            Orden de prioridad
            <Conteo>{(rules ?? []).length}</Conteo>
          </>
        }
        description="Se evalúa desde el número más bajo. Si un lead no coincide con ninguna regla, entra al fallback configurado arriba."
      >
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Th className="w-16">Orden</Th>
              <Th>Regla</Th>
              <Th>Estado</Th>
              <Th />
            </Thead>
            <Tbody>
              {(rules ?? []).map((rule) => (
                <Tr key={rule.id}>
                  <Td>
                    <span className="inline-flex size-7 items-center justify-center rounded-md bg-surface-muted text-xs font-semibold tabular-nums text-foreground">
                      {rule.position}
                    </span>
                  </Td>
                  <Td>
                    <span className="block font-medium text-foreground">{rule.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {rule.field_name} {OPERATOR_LABELS[rule.operator] ?? rule.operator}{" "}
                      {rule.comparison_value ?? ""}
                    </span>
                  </Td>
                  <Td><Badge tone={rule.is_active ? "success" : "neutral"}>{rule.is_active ? "Activa" : "Pausada"}</Badge></Td>
                  <Td align="right">
                    {/* Eliminar va separado de Pausar y pide confirmar: no se deshace. */}
                    <div className="flex justify-end gap-5">
                      <ActionForm action={toggleLeadPriorityRule} success={rule.is_active ? "Regla pausada" : "Regla activada"}>
                        <input type="hidden" name="campaign_id" value={id} />
                        <input type="hidden" name="rule_id" value={rule.id} />
                        <input type="hidden" name="active" value={String(rule.is_active)} />
                        <ActionSubmit variant="secondary" size="sm" pendingLabel="…">{rule.is_active ? "Pausar" : "Activar"}</ActionSubmit>
                      </ActionForm>
                      <ActionForm
                        action={deleteLeadPriorityRule}
                        success="Regla eliminada"
                        confirm={{
                          title: `¿Eliminar la regla «${rule.name}»?`,
                          description:
                            "Los registros que priorizaba pasan a la siguiente regla o al fallback. No se puede deshacer: si la necesitas de nuevo, tendrás que crearla otra vez. Para dejarla sin efecto por un tiempo, usa Pausar.",
                          confirmLabel: "Eliminar regla",
                          tone: "danger",
                        }}
                      >
                        <input type="hidden" name="campaign_id" value={id} />
                        <input type="hidden" name="rule_id" value={rule.id} />
                        <ActionSubmit variant="ghost" size="sm" pendingLabel="…" className="text-danger hover:text-danger">
                          Eliminar
                        </ActionSubmit>
                      </ActionForm>
                    </div>
                  </Td>
                </Tr>
              ))}
              <Tr>
                <Td>
                  <span className="inline-flex size-7 items-center justify-center rounded-md bg-surface-muted text-xs text-muted-foreground">—</span>
                </Td>
                <Td>
                  <span className="block font-medium text-foreground">Fallback</span>
                  <span className="block text-xs text-muted-foreground">
                    Todo lo demás · {config?.fallback_order === "newest_first" ? "más reciente primero" : "más antiguo primero"}
                  </span>
                </Td>
                <Td><Badge>Siempre activo</Badge></Td>
                <Td />
              </Tr>
            </Tbody>
          </Table>
        </div>

        <ActionForm
          action={createLeadPriorityRule}
          success="Regla de prioridad creada"
          className="divide-y divide-border border-t border-border"
        >
          <input type="hidden" name="campaign_id" value={id} />
          <Grupo titulo="Nueva regla" descripcion="Prioriza los registros cuyo campo cumple la condición. Se ubica según su número de orden.">
          <Field label="Orden">
            <Input type="number" name="position" min="1" max="1000" defaultValue={defaultPosition} />
          </Field>
          <Field label="Nombre">
            <Input name="name" required placeholder="Scoring alto" />
          </Field>
          <Field label="Campo">
            <Input name="field_name" required placeholder="Scoring o Ciudad" />
          </Field>
          <Field label="Operador">
            <Select name="operator" defaultValue="eq">
              <option value="eq">Es igual a</option>
              <option value="neq">Es distinto de</option>
              <option value="contains">Contiene</option>
              <option value="gte">Mayor o igual a</option>
              <option value="lte">Menor o igual a</option>
              <option value="is_empty">Está vacío</option>
              <option value="is_not_empty">Tiene valor</option>
            </Select>
          </Field>
          <Field label="Valor">
            <Input name="comparison_value" placeholder="80" />
          </Field>
          </Grupo>
          <PieDeFormulario>
            <ActionSubmit variant="secondary" pendingLabel="Agregando…">Agregar regla</ActionSubmit>
          </PieDeFormulario>
        </ActionForm>
      </SectionCard>

      <SectionCard title="Últimas entregas" description="Trazabilidad del motor, aunque el ejecutivo todavía no haya gestionado el registro.">
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Th>Fecha</Th>
              <Th>Lead</Th>
              <Th>Ejecutivo</Th>
              <Th>Motivo</Th>
              <Th>Estado</Th>
            </Thead>
            <Tbody>
              {(assignments.data ?? []).map((assignment) => {
                const lead = Array.isArray(assignment.leads) ? assignment.leads[0] : assignment.leads;
                const agent = Array.isArray(assignment.profiles) ? assignment.profiles[0] : assignment.profiles;
                return (
                  <Tr key={assignment.id}>
                    <Td muted className="whitespace-nowrap">{fechaLegible(assignment.claimed_at)}</Td>
                    <Td strong>{lead?.full_name ?? "—"}</Td>
                    <Td>
                      {agent?.full_name ? (
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <Avatar name={agent.full_name} size="xs" />
                          {agent.full_name}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td muted>{assignment.priority_reason}</Td>
                    <Td>
                      <Badge tone={ASSIGNMENT_STATUS[assignment.status]?.tone ?? "neutral"}>
                        {ASSIGNMENT_STATUS[assignment.status]?.label ?? assignment.status}
                      </Badge>
                    </Td>
                  </Tr>
                );
              })}
              {(assignments.data ?? []).length === 0 && (
                <Tr>
                  <Td colSpan={5}>
                    <EmptyState
                      icon={Send}
                      title="Todavía no hay entregas."
                      description="El motor queda seguro y detenido hasta que cargues base, asignes ejecutivos y lo actives."
                      className="py-6"
                    />
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </div>
      </SectionCard>
    </div>
  );
}

