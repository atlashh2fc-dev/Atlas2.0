"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCheck, ChevronRight, Clock3, History, Inbox, Mail, MessageCircleReply, MousePointerClick, Phone, UserRound } from "lucide-react";
import { bulkAssignMailEngagementLeads } from "@/app/actions/mail";
import { Badge, Button, Callout, EmptyState, SectionCard, Select, SlideOver, buttonClasses } from "@/components/ui";
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

/** Borde izquierdo y color de la cifra de cada prioridad (baldosa de estado). */
function bucketTone(tone: MailControlBucket["tone"] = "neutral") {
  return tone === "danger"
    ? { edge: "border-l-danger", value: "text-danger" }
    : tone === "warning"
      ? { edge: "border-l-warning", value: "text-warning" }
      : tone === "success"
        ? { edge: "border-l-success", value: "text-success" }
        : tone === "info"
          ? { edge: "border-l-primary", value: "text-primary" }
          : { edge: "border-l-border-strong", value: "text-foreground" };
}

function queueState(row: MailQueueRow) {
  if (row.queue_bucket === "customer_replied") return { label: "Respuesta cliente", tone: "warning" as const, icon: MessageCircleReply };
  if (row.queue_bucket === "agent_replied") return { label: "Respondido", tone: "success" as const, icon: CheckCheck };
  if (row.clicked) return { label: "Click", tone: "success" as const, icon: MousePointerClick };
  return { label: "Apertura", tone: "warning" as const, icon: Mail };
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
      icon={Mail}
      tone="teal"
      actions={
        <Badge tone="info">
          <span className="tabular-nums">{total.toLocaleString("es-CL")}</span>&nbsp;oportunidades priorizadas
        </Badge>
      }
    >
      <div className="border-b border-border px-4 py-4">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {buckets.map((bucket) => {
            const active = activeBucket === bucket.id;
            const style = bucketTone(bucket.tone);
            return (
              <Link
                key={bucket.id}
                href={bucket.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg border border-l-2 px-3 py-2.5 text-left transition-[border-color,background-color,box-shadow] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${style.edge} ${
                  active
                    ? "border-primary/50 bg-primary/10 shadow-sm ring-1 ring-primary/40"
                    : "border-border bg-background hover:border-border-strong hover:bg-surface-muted"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-xs font-medium text-muted-foreground">{bucket.label}</span>
                  <span className={`text-xl font-semibold leading-none tracking-tight tabular-nums ${bucket.count > 0 ? style.value : "text-muted-foreground"}`}>
                    {bucket.count.toLocaleString("es-CL")}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{bucket.description}</p>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="border-b border-border bg-surface-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{rows.length.toLocaleString("es-CL")} listos para gestionar</span>
            <span>ordenados por prioridad</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {rows.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={toggleVisible}>
                {allVisibleSelected ? "Quitar selección" : "Seleccionar bloque"}
              </Button>
            )}
            {selectedIds.length > 0 && (
              <Button type="button" size="sm" onClick={() => openAssignment(selectedIds)}>
                Asignar {selectedIds.length.toLocaleString("es-CL")}
              </Button>
            )}
          </div>
        </div>
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
              <article key={`${row.mail_campaign_id ?? row.campaign_id}-${row.lead_id}`} className="group flex gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/60">
                <label className="mt-1 flex h-5 w-5 flex-none cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLead(row.lead_id)}
                    aria-label={`Seleccionar ${row.full_name}`}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
                  />
                </label>
                <button type="button" onClick={() => setInspected(row)} className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground group-hover:text-primary">{row.full_name}</p>
                    <Badge tone={state.tone}>
                      <StateIcon size={12} className="mr-1" aria-hidden />
                      {state.label}
                    </Badge>
                    {!row.assigned_to && <Badge tone="warning">Sin responsable</Badge>}
                    {row.attention_reason && <Badge tone="info">{row.attention_reason}</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{row.rut ?? "Sin RUT"}</span>
                    <span>{row.phone ?? row.email ?? "Sin contacto"}</span>
                    <span>{row.mail_campaign_name}</span>
                    <span className="inline-flex items-center gap-1"><Clock3 size={12} aria-hidden /> {formatDate(row.last_event_at)}</span>
                  </div>
                </button>
                <div className="hidden shrink-0 items-center gap-2 sm:flex">
                  <span className="max-w-36 truncate text-xs text-muted-foreground">{row.assigned_to_name ?? "Sin asignar"}</span>
                  <ChevronRight size={16} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
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
