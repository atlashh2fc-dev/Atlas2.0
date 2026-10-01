"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCheck, ChevronRight, Clock3, History, Inbox, Mail, MessageCircleReply, MousePointerClick, Phone, UserRound } from "lucide-react";
import { bulkAssignMailEngagementLeads } from "@/app/actions/mail";
import { Avatar, Badge, Button, Callout, EmptyState, SectionCard, Select, SlideOver, buttonClasses } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

export type MailQueueRow = {
  mail_campaign_id: string | null;
  mail_campaign_name: string;
  campaign_id: string;
  campaign_name: string;
  lead_id: string;
  full_name: string;
  rut: string | null;
  phone: string | null;
  email: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  team_id?: string | null;
  opened: boolean;
  clicked: boolean;
  last_event_at: string;
  priority_rank: number;
  work_rank?: number | null;
  priority_reason: string;
  /** Grupo operativo ya calculado por el read model, con precedencia de SLA. */
  queue_bucket?: string | null;
  attention_reason?: string | null;
  last_interaction_at?: string | null;
  next_action_at?: string | null;
};

export type MailControlAgent = {
  id: string;
  full_name: string;
  email: string;
  team_id: string | null;
  campaign_ids: string[];
};

/**
 * Los conteos vienen del mismo read model que alimenta la reportería: no se
 * infieren desde la página actual de resultados.
 */
export type MailControlBucket = {
  id: string;
  label: string;
  count: number;
  description: string;
  href: string;
  tone?: "neutral" | "info" | "warning" | "danger" | "success";
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Punto y color de la cifra de cada prioridad. El color solo aparece cuando
 *  hay algo que atender: una baldosa en cero queda gris. */
function bucketTone(tone: MailControlBucket["tone"] = "neutral") {
  return tone === "danger"
    ? { dot: "bg-danger", value: "text-danger" }
    : tone === "warning"
      ? { dot: "bg-warning", value: "text-warning" }
      : tone === "success"
        ? { dot: "bg-success", value: "text-success" }
        : tone === "info"
          ? { dot: "bg-primary", value: "text-foreground" }
          : { dot: "bg-muted-foreground/50", value: "text-foreground" };
}

function queueState(row: MailQueueRow) {
  if (row.queue_bucket === "customer_replied") return { label: "Respuesta cliente", chip: "amber", icon: MessageCircleReply };
  if (row.queue_bucket === "agent_replied") return { label: "Respondido", chip: "green", icon: CheckCheck };
  if (row.clicked) return { label: "Click", chip: "violet", icon: MousePointerClick };
  return { label: "Apertura", chip: "blue", icon: Mail };
}

/**
 * Consola de trabajo Mail: una supervisora escoge una cola, inspecciona el
 * contexto y distribuye una selección. No replica la reportería ni presenta
 * una tabla interminable de registros sin prioridad.
 */
export function MailControlCenter({
  rows,
  agents,
  buckets,
  activeBucket,
  total,
  nextHref,
  resetHref,
}: {
  rows: MailQueueRow[];
  agents: MailControlAgent[];
  buckets: MailControlBucket[];
  activeBucket: string;
  total: number;
  nextHref: string | null;
  resetHref: string;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [inspected, setInspected] = useState<MailQueueRow | null>(null);
  const [assigningIds, setAssigningIds] = useState<string[] | null>(null);
  const [agentId, setAgentId] = useState("");
  const [pending, startTransition] = useTransition();

  const visibleIds = rows.map((row) => row.lead_id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const assignmentCampaignIds = [...new Set(
    rows
      .filter((row) => (assigningIds ?? []).includes(row.lead_id))
      .map((row) => row.campaign_id)
  )];
  const assignmentTeamIds = [...new Set(
    rows
      .filter((row) => (assigningIds ?? []).includes(row.lead_id))
      .map((row) => row.team_id)
      .filter((teamId): teamId is string => Boolean(teamId))
  )];
  const assignmentAgents = agents.filter((agent) =>
    assignmentCampaignIds.every((campaignId) => agent.campaign_ids.includes(campaignId))
    && assignmentTeamIds.every((teamId) => agent.team_id === teamId)
  );

  function toggleLead(leadId: string) {
    setSelectedIds((current) => (current.includes(leadId) ? current.filter((id) => id !== leadId) : [...current, leadId]));
  }

  function toggleVisible() {
    setSelectedIds((current) => {
      if (allVisibleSelected) return current.filter((id) => !visibleIds.includes(id));
      return [...new Set([...current, ...visibleIds])];
    });
  }

  function openAssignment(ids: string[]) {
    setInspected(null);
    setAssigningIds(ids);
    setAgentId("");
  }

  function submitBulkAssignment() {
    const ids = assigningIds ?? [];
    if (!agentId || ids.length === 0) return;

    startTransition(async () => {
      const result = await bulkAssignMailEngagementLeads(ids, agentId);
      if (result.error) {
        toast({ tone: "danger", message: `No se pudo asignar la selección: ${result.error}` });
        return;
      }
      toast({
        tone: "success",
        message: `${result.ok} leads asignados correctamente.`,
      });
      setAssigningIds(null);
      setSelectedIds([]);
      router.refresh();
    });
  }

  return (
    <SectionCard
      title="Centro de control mail"
      description="Elige una prioridad, revisa el contexto y asigna trabajo en bloque."
    >
      <div className="grid gap-px border-y border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
        {buckets.map((bucket) => {
          const active = activeBucket === bucket.id;
          const style = bucketTone(bucket.tone);
          return (
            <Link
              key={bucket.id}
              href={bucket.href}
              aria-current={active ? "page" : undefined}
              className={`group relative flex flex-col gap-2 px-4 py-3.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                active ? "bg-primary/[0.07]" : "bg-surface hover:bg-surface-muted/70"
              }`}
            >
              {active && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
              <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground group-hover:text-foreground">
                <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${bucket.count > 0 ? style.dot : "bg-muted-foreground/30"}`} />
                <span className={active ? "text-foreground" : undefined}>{bucket.label}</span>
              </span>
              <span className={`text-2xl font-semibold leading-none tracking-tight tabular-nums ${bucket.count > 0 ? style.value : "text-muted-foreground/60"}`}>
                {bucket.count.toLocaleString("es-CL")}
              </span>
              <span className="truncate text-[11px] text-muted-foreground" title={bucket.description}>
                {bucket.description}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-raised px-4 py-2.5">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {rows.length > 0 && (
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleVisible}
              aria-label="Seleccionar el bloque cargado"
              className="accent-primary"
            />
          )}
          <span>
            <span className="font-medium text-foreground">{rows.length.toLocaleString("es-CL")} listos para gestionar</span>
            {" · "}ordenados por prioridad, de {total.toLocaleString("es-CL")} en la cola
          </span>
        </div>
        {selectedIds.length > 0 && (
          <Button type="button" size="sm" onClick={() => openAssignment(selectedIds)}>
            Asignar {selectedIds.length.toLocaleString("es-CL")}
          </Button>
        )}
      </div>

      <div className="max-h-[34rem] divide-y divide-border overflow-y-auto">
        {rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No hay oportunidades pendientes en esta prioridad."
            description="El trabajo ya fue gestionado o no hay señales que requieran intervención."
          />
        ) : (
          rows.map((row) => {
            const state = queueState(row);
            const StateIcon = state.icon;
            const checked = selectedIds.includes(row.lead_id);
            return (
              <article key={`${row.mail_campaign_id ?? row.campaign_id}-${row.lead_id}`} className={`group flex items-center gap-3 px-4 py-3 transition-colors ${checked ? "bg-primary/[0.06]" : "hover:bg-surface-muted/55"}`}>
                <label className="flex size-5 flex-none cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLead(row.lead_id)}
                    aria-label={`Seleccionar ${row.full_name}`}
                    className="accent-primary"
                  />
                </label>
                <button type="button" onClick={() => setInspected(row)} className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar name={row.full_name} seed={row.rut ?? row.full_name} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="truncate font-medium text-foreground group-hover:text-primary">{row.full_name}</span>
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <span className="icon-chip size-5 rounded-md" data-tone={state.chip}>
                          <StateIcon size={11} aria-hidden />
                        </span>
                        {state.label}
                      </span>
                      {row.attention_reason && <span className="text-xs text-muted-foreground">{row.attention_reason}</span>}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="tabular-nums">{row.rut ?? "Sin RUT"}</span>
                      <span className="tabular-nums">{row.phone ?? row.email ?? "Sin contacto"}</span>
                      <span className="truncate">{row.mail_campaign_name}</span>
                      <span className="inline-flex items-center gap-1 tabular-nums"><Clock3 size={12} aria-hidden /> {formatDate(row.last_event_at)}</span>
                    </span>
                  </span>
                </button>
                <div className="hidden shrink-0 items-center gap-2 sm:flex">
                  {row.assigned_to_name ? (
                    <span className="flex max-w-44 items-center gap-2 text-xs text-foreground">
                      <Avatar name={row.assigned_to_name} size="xs" />
                      <span className="truncate">{row.assigned_to_name}</span>
                    </span>
                  ) : (
                    <Badge tone="warning">Sin responsable</Badge>
                  )}
                  <ChevronRight size={16} className="text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <span>La lista contiene el bloque de trabajo ya cargado; los contadores conservan el total de la cola.</span>
        <div className="flex items-center gap-2">
          {nextHref && (
            <Link href={nextHref} className="rounded-lg border border-border bg-surface px-2.5 py-1 font-medium text-foreground shadow-sm hover:bg-surface-muted">
              Cargar siguientes
            </Link>
          )}
          {nextHref && (
            <Link href={resetHref} className="rounded-lg px-2.5 py-1 font-medium text-muted-foreground hover:bg-surface-muted hover:text-foreground">
              Volver al inicio
            </Link>
          )}
        </div>
      </div>

      <SlideOver
        open={inspected !== null}
        onClose={() => setInspected(null)}
        title={inspected?.full_name ?? "Detalle de oportunidad"}
        description={inspected?.priority_reason}
        width="md"
      >
        {inspected && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Detail label="Responsable" value={inspected.assigned_to_name ?? "Sin asignar"} icon={UserRound} tone="blue" />
              <Detail label="Última señal" value={formatDate(inspected.last_event_at)} icon={Clock3} tone="teal" />
              <Detail label="Última gestión" value={formatDate(inspected.last_interaction_at)} icon={History} tone="slate" />
              <Detail label="Próxima acción" value={formatDate(inspected.next_action_at)} icon={CalendarClock} tone="amber" />
            </div>
            <div className="rounded-xl border border-border bg-background p-4 text-sm shadow-sm">
              <p className="flex items-center gap-2 font-medium text-foreground">
                <Phone size={16} className="text-muted-foreground" aria-hidden="true" />
                Contacto
              </p>
              <p className="mt-1 text-muted-foreground">{inspected.phone ?? inspected.email ?? "No hay teléfono ni correo registrado."}</p>
              <p className="mt-2 text-xs text-muted-foreground">Campaña: {inspected.mail_campaign_name} · {inspected.campaign_name}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/dashboard/leads/${inspected.lead_id}`} className={buttonClasses({ variant: "secondary" })}>
                Abrir ficha completa
              </Link>
              <Button type="button" onClick={() => openAssignment([inspected.lead_id])}>
                {inspected.assigned_to ? "Reasignar" : "Asignar"}
              </Button>
            </div>
          </div>
        )}
      </SlideOver>

      <SlideOver
        open={assigningIds !== null}
        onClose={() => setAssigningIds(null)}
        title="Asignar oportunidades"
        description={`${assigningIds?.length ?? 0} lead${(assigningIds?.length ?? 0) === 1 ? "" : "s"} seleccionados`}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setAssigningIds(null)}>Cancelar</Button>
            <Button type="button" disabled={!agentId || pending} onClick={submitBulkAssignment}>
              {pending ? "Asignando…" : "Confirmar asignación"}
            </Button>
          </>
        }
      >
        <label className="block text-sm font-medium text-foreground">
          Ejecutivo responsable
          <Select value={agentId} onChange={(event) => setAgentId(event.target.value)} data-autofocus className="mt-1.5 w-full">
            <option value="">Selecciona un ejecutivo</option>
            {assignmentAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.full_name || agent.email}</option>
            ))}
          </Select>
        </label>
        {assignmentCampaignIds.length > 0 && assignmentAgents.length === 0 && (
          <Callout tone="warning" className="mt-3 px-3 py-2 text-xs">
            No hay un ejecutivo del mismo equipo habilitado en todas las campañas de la selección. Ajusta el bloque o la membresía de campaña.
          </Callout>
        )}
        <p className="mt-4 text-xs text-muted-foreground">La asignación conserva el historial operativo y actualiza la cola, los registros y el control de equipo.</p>
      </SlideOver>
    </SectionCard>
  );
}

function Detail({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: typeof Clock3;
  tone?: "blue" | "teal" | "amber" | "slate";
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-background p-3">
      {Icon && <Icon size={16} className="mt-0.5 flex-shrink-0 text-muted-foreground" aria-hidden="true" />}
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}
