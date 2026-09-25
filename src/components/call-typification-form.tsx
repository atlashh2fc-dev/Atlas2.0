"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, CalendarClock, CheckCircle2, Clock3, MessageSquare, PhoneOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { notifyAgentManagementClosed, requestAgentHangup } from "@/lib/agent-control";
import type { Call, Lead } from "@/lib/types";
import {
  EQUIFAX_PRODUCTS,
  describeAgendaPolicy,
  getReasonConfigFrom,
  groupReasonsByState,
  nestReasonOptions,
  validateCallClosure,
  type CallOutcome,
  type CallReasonConfig,
  type AgendaPolicy,
  type CallStatus,
  type ReasonOptionNode,
} from "@/lib/call-typification";
import {
  closeCall,
  discardCallTechnicalError,
  reviseCallManagement,
  superviseCallManagement,
} from "@/app/actions/calls";
import {
  INTERCALL_BREAK_EVENT,
  INTERCALL_BREAK_STORAGE_KEY,
  readLegalIntercallBreakUntil,
} from "@/lib/intercall-break";
import { AppointmentScheduleEmbed } from "@/components/appointment-schedule-embed";

function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function localInputToWindow(value: string): string {
  const hour = Number(value.match(/T(\d{2}):/)?.[1]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "";
  const start = String(hour).padStart(2, "0");
  const end = String((hour + 1) % 24).padStart(2, "0");
  return `${start}:00-${end}:00`;
}

type PendingAction = "close" | "discard" | null;

export function CallTypificationForm({
  lead,
  call,
  reasonCatalog,
  equifaxCommercialFieldsEnabled,
  appointmentScheduleUrl,
  agendaPolicy = null,
  revision: revisionProp = false,
  supervision = null,
}: {
  lead: Lead;
  call: Call;
  reasonCatalog: CallReasonConfig[];
  /**
   * Contrato explícito del workflow. Evita que una opción con el mismo nombre
   * herede los campos Equifax desde el catálogo histórico durante hidratación
   * o corrección de una gestión antigua.
   */
  equifaxCommercialFieldsEnabled: boolean;
  /** Agenda pública específica de la campaña, mostrada dentro del CRM. */
  appointmentScheduleUrl?: string | null;
  /**
   * Franja en que la campaña acepta agendas (Equifax: lunes a viernes, 09:00 a
   * 19:00 hora Chile). Null no restringe; la base valida lo mismo al guardar.
   */
  agendaPolicy?: AgendaPolicy | null;
  /** Corrige una gestión ya cerrada sin crear una llamada ficticia. */
  revision?: boolean;
  /**
   * Supervisión corrige una gestión cerrada (callId) o agrega una tipificación
   * nueva acreditada a un ejecutivo (callId null). Se comporta como una
   * corrección y además pide el motivo y, al agregar, el ejecutivo.
   */
  supervision?: {
    callId: string | null;
    agents: { id: string; name: string }[];
    defaultAgentId: string | null;
  } | null;
}) {
  const revision = revisionProp || supervision !== null;
  const adding = supervision !== null && supervision.callId === null;
  const router = useRouter();
  const fieldId = useId();
  // La ficha siempre recibe el catálogo de su workflow. En campañas que no
  // declaran el contrato Equifax se neutraliza además cualquier bandera
  // heredada en una gestión antigua antes de renderizar o validar.
  const catalog = useMemo(
    () =>
      equifaxCommercialFieldsEnabled
        ? reasonCatalog
        : reasonCatalog.map((option) => ({
            ...option,
            requiresEquifaxData: false,
            notesRequiredWithoutAgenda: false,
            // Sin contrato Equifax la cotizacion no exige agenda, pero si la
            // admite: dejarla en "none" impedia guardar la gestion, porque la
            // base si acepta (y la operacion necesita) un seguimiento.
            agenda:
              option.value === "COTIZACION ENVIADA" && option.requiresEquifaxData
                ? "optional"
                : option.agenda,
          })),
    [equifaxCommercialFieldsEnabled, reasonCatalog]
  );
  const initialReason = getReasonConfigFrom(catalog, call.reason);
  const [status, setStatus] = useState<CallStatus | null>((call.status as CallStatus | null) ?? initialReason?.status ?? null);
  const [outcome, setOutcome] = useState<CallOutcome | null>((call.outcome as CallOutcome | null) ?? initialReason?.outcome ?? null);
  const [reason, setReason] = useState<string>(call.reason ?? "");
  // Cascada como en Atlas 1: primero la categoría (CONTACTO / NO CONTACTO),
  // después el subgrupo y al final solo los motivos de esa rama. Una
  // corrección parte abierta en la rama del motivo que ya tenía.
  const [reasonPath, setReasonPath] = useState<string[]>(() =>
    initialReason ? [initialReason.stateLabel, ...(initialReason.groupPath ?? [])] : []
  );
  const [notes, setNotes] = useState<string>(call.notes ?? "");
  const [nextActionAt, setNextActionAt] = useState<string>(isoToLocalInput(call.next_action_at));
  const [equifaxProducts, setEquifaxProducts] = useState<string[]>(call.equifax_products ?? []);
  const [equifaxUf, setEquifaxUf] = useState<string>(call.equifax_uf_amount?.toString() ?? "");
  const [equifaxEmail, setEquifaxEmail] = useState<string>(call.equifax_recipient_email ?? "");
  const [supervisorNote, setSupervisorNote] = useState("");
  const [creditedAgentId, setCreditedAgentId] = useState<string>(supervision?.defaultAgentId ?? "");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardReason, setDiscardReason] = useState("");
  const [attemptedClose, setAttemptedClose] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [appointmentScheduleOpen, setAppointmentScheduleOpen] = useState(false);
  const [legalBreakUntil, setLegalBreakUntil] = useState(() =>
    readLegalIntercallBreakUntil()
  );
  const [clockNow, setClockNow] = useState(() => Date.now());
  // Tipificación anticipada: el ejecutivo la deja lista durante la llamada y
  // la gestión se cierra sola al colgar, pasada la interrupción legal.
  const [armed, setArmed] = useState(false);
  const [hungUp, setHungUp] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [autoAttempt, setAutoAttempt] = useState(0);
  const closeInFlightRef = useRef(false);
  const handleCloseRef = useRef<(selectedReason?: CallReasonConfig, auto?: boolean) => Promise<void>>(
    async () => {}
  );

  useEffect(() => {
    // Cada interrupción legal nace de una llamada que acaba de terminar.
    function handleBreak(event: Event) {
      setLegalBreakUntil((event as CustomEvent<number>).detail);
      setClockNow(Date.now());
      setHungUp(true);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== INTERCALL_BREAK_STORAGE_KEY) return;
      const until = Number(event.newValue);
      setLegalBreakUntil(Number.isFinite(until) ? until : 0);
      setClockNow(Date.now());
      if (Number.isFinite(until) && until > Date.now()) setHungUp(true);
    }

    window.addEventListener(INTERCALL_BREAK_EVENT, handleBreak);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(INTERCALL_BREAK_EVENT, handleBreak);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (legalBreakUntil <= clockNow) return;
    const id = setInterval(() => setClockNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [legalBreakUntil, clockNow]);

  const reasonGroups = useMemo(() => groupReasonsByState(catalog), [catalog]);
  // Con una sola categoría no hay nada que elegir: se abre sola.
  const selectedStateLabel = reasonGroups.length === 1 ? reasonGroups[0].label : reasonPath[0];
  const selectedState = reasonGroups.find((state) => state.label === selectedStateLabel);
  const reasonConfig = getReasonConfigFrom(catalog, reason);
  const showAgendaBlock = reasonConfig?.agenda === "required" || reasonConfig?.agenda === "optional";
  // Una corrección puede partir de una gestión que sí tenía agenda. Si la
  // nueva tipificación no la admite, la fecha antigua nunca debe viajar oculta
  // en el payload aunque el estado de React todavía no se haya actualizado.
  const closureNextActionAt = reasonConfig?.agenda === "none" ? null : localInputToIso(nextActionAt);
  const showEquifaxBlock = reasonConfig?.requiresEquifaxData === true;
  const inferredNextActionWindow = localInputToWindow(nextActionAt);
  const legalBreakRemaining = Math.max(
    0,
    Math.ceil((legalBreakUntil - clockNow) / 1000)
  );
  const legalBreakActive = !revision && legalBreakRemaining > 0;

  // Al corregir, la agenda original no se vuelve a juzgar si no cambia.
  const closureOptions = useMemo(
    () => ({ agendaPolicy, previousNextActionAt: revision ? call.next_action_at : null }),
    [agendaPolicy, revision, call.next_action_at]
  );
  const notesRequired = reasonConfig?.notesRequiredWithoutAgenda === true && !closureNextActionAt;
  const agendaPolicyText = describeAgendaPolicy(agendaPolicy);

  const pendingIssues = useMemo(
    () =>
      validateCallClosure(
        {
          status,
          outcome,
          reason: reason || null,
          notes,
          next_action_at: closureNextActionAt,
          equifax_products: equifaxProducts,
          equifax_uf_amount: equifaxUf ? Number(equifaxUf) : null,
          equifax_recipient_email: equifaxEmail || null,
          lead_email: lead.email,
          contact_email: lead.email,
        },
        catalog,
        closureOptions
      ),
    [catalog, closureOptions, status, outcome, reason, notes, closureNextActionAt, equifaxProducts, equifaxUf, equifaxEmail, lead.email]
  );

  function handleReasonSelect(option: CallReasonConfig) {
    if (closeInFlightRef.current || pending !== null) return;
    setReason(option.value);
    setStatus(option.status);
    setOutcome(option.outcome);
    if (option.agenda === "none") {
      setNextActionAt("");
      setAppointmentScheduleOpen(false);
    }
    if (appointmentScheduleUrl && option.agenda === "required") {
      // El calendario debe aparecer al tipificar agenda, mientras el agente
      // todavía puede completar la gestión, y nunca como efecto del corte.
      // Se usa el modal interno: una pestaña con window.open puede ser
      // bloqueada por Chrome y deja al ejecutivo sin ninguna señal visible.
      setAppointmentScheduleOpen(true);
    }
    setMessage(null);
    setAttemptedClose(false);
  }

  function toggleEquifaxProduct(product: string) {
    setEquifaxProducts((prev) => (prev.includes(product) ? prev.filter((p) => p !== product) : [...prev, product]));
  }

  async function handleClose(selectedReason?: CallReasonConfig, auto = false) {
    if (closeInFlightRef.current || pending !== null || catalog.length === 0) return;
    if (!auto && (armed || legalBreakActive)) return;
    // El cierre directo usa la opción pulsada, no el estado del render anterior.
    // Las mismas validaciones y la misma acción del servidor protegen ambos caminos.
    const payload = {
      callId: call.id,
      leadId: lead.id,
      status: selectedReason?.status ?? status,
      outcome: selectedReason?.outcome ?? outcome,
      reason: selectedReason?.value ?? (reason || null),
      notes: notes || null,
      next_action_at: selectedReason?.agenda === "none" ? null : closureNextActionAt,
      equifax_products: equifaxProducts,
      equifax_uf_amount: equifaxUf ? Number(equifaxUf) : null,
      equifax_recipient_email: equifaxEmail || null,
    };
    if (selectedReason) handleReasonSelect(selectedReason);
    setAttemptedClose(true);
    const issues = validateCallClosure(
      { ...payload, lead_email: lead.email, contact_email: lead.email },
      catalog,
      closureOptions
    );
    if (issues.length > 0) {
      setArmed(false);
      setMessage({ type: "error", text: "Completa los campos marcados antes de cerrar." });
      return;
    }
    if (supervision && !supervisorNote.trim()) {
      setMessage({ type: "error", text: "Indica por qué corriges o agregas la tipificación." });
      return;
    }
    if (adding && !creditedAgentId) {
      setMessage({ type: "error", text: "Elige a qué ejecutivo se acredita la gestión." });
      return;
    }

    closeInFlightRef.current = true;
    // El intento automático no bloquea la pantalla: el aviso de "lista" ya
    // muestra el estado y el formulario sigue fijo mientras está armada.
    if (!auto) {
      setPending("close");
      setMessage(null);
    }
    let completed = false;
    try {
      const result = supervision
        ? await superviseCallManagement({
            ...payload,
            callId: supervision.callId,
            agentId: adding ? creditedAgentId : null,
            supervisorNote,
          })
        : revision
          ? await reviseCallManagement(payload)
          : await closeCall(payload);
      if (!result.ok) {
        if (!revision && result.code === "call_in_progress") {
          // Válida pero con la llamada viva: queda lista y se cierra al colgar.
          setArmed(true);
          setMessage(null);
          if (auto) setAutoAttempt((n) => n + 1);
          return;
        }
        if (!revision && result.code === "legal_break") {
          setArmed(true);
          setHungUp(true);
          setMessage(null);
          setRetryAt(Date.now() + (result.retryAfterSeconds ?? 1) * 1000);
          if (auto) setAutoAttempt((n) => n + 1);
          return;
        }
        setArmed(false);
        setMessage({ type: "error", text: result.error });
        return;
      }
      completed = true;
      setMessage({ type: "success", text: revision ? "Tipificación guardada." : "Tipificación guardada. Abriendo la siguiente gestión…" });
      if (!revision) notifyAgentManagementClosed();
      // Un cierre confirmado no debe volver a habilitar el botón mientras la
      // navegación de Next termina. Una carga completa evita que una transición
      // lenta deje el mismo formulario visible y haga que el ejecutivo vuelva a
      // guardar una gestión que ya quedó cerrada.
      window.location.assign(revision ? `/dashboard/leads/${lead.id}` : "/dashboard/leads");
    } catch (e) {
      console.error("No se pudo completar la acción de gestión", e);
      setArmed(false);
      setMessage({
        type: "error",
        text: revision
          ? "No se pudo guardar la corrección. Reintenta; si persiste, informa a supervisión."
          : "No se pudo cerrar la gestión. Reintenta; si persiste, informa a supervisión.",
      });
    } finally {
      if (!completed) {
        closeInFlightRef.current = false;
        setPending(null);
      }
    }
  }

  useEffect(() => {
    handleCloseRef.current = handleClose;
  });

  // Mientras la llamada sigue, se revisa cada 5 s por si terminó sin que este
  // navegador lo viera; al colgar, se intenta apenas pasa la interrupción legal.
  useEffect(() => {
    if (!armed) return;
    const waitMs = hungUp
      ? Math.max(legalBreakUntil - Date.now(), retryAt - Date.now(), 0) + (autoAttempt > 0 ? 2000 : 500)
      : 5000;
    const id = setTimeout(() => void handleCloseRef.current(undefined, true), waitMs);
    return () => clearTimeout(id);
  }, [armed, hungUp, legalBreakUntil, retryAt, autoAttempt]);

  async function handleDiscard() {
    if (closeInFlightRef.current || pending !== null || legalBreakActive) return;
    if (!discardReason.trim()) {
      setMessage({ type: "error", text: "Indica el motivo del error tecnico para descartar." });
      return;
    }
    closeInFlightRef.current = true;
    setPending("discard");
    setMessage(null);
    let completed = false;
    try {
      await discardCallTechnicalError({ callId: call.id, leadId: lead.id, reason: discardReason.trim() });
      completed = true;
      notifyAgentManagementClosed();
      router.push("/dashboard/leads");
      router.refresh();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Error al descartar la llamada." });
    } finally {
      if (!completed) {
        closeInFlightRef.current = false;
        setPending(null);
      }
    }
  }

  function renderReasonOption(option: CallReasonConfig) {
    return (
      <div
        key={`${option.stateLabel}-${option.resultLabel}-${(option.groupPath ?? []).join(">")}-${option.value}`}
        className="flex min-w-0 gap-1"
      >
        <button
          type="button"
          onClick={() => handleReasonSelect(option)}
          aria-pressed={reason === option.value}
          className={`min-h-11 min-w-0 flex-1 rounded-lg border px-3 py-2 text-left text-xs font-semibold uppercase transition-colors ${
            reason === option.value
              ? "border-primary bg-primary text-primary-foreground shadow-sm"
              : "border-border bg-background text-foreground hover:border-primary/50 hover:bg-surface-muted"
          }`}
        >
          {option.label}
        </button>
        {appointmentScheduleUrl && !revision && option.agenda === "none" && option.outcome !== "sale" && (
          <button
            type="button"
            aria-label={`Cerrar: ${option.label}`}
            title={`Guardar y cerrar: ${option.label}`}
            onClick={() => void handleClose(option)}
            className="rounded-lg border border-border px-2 text-xs font-semibold text-primary hover:border-primary hover:bg-primary/10"
          >
            Cerrar
          </button>
        )}
      </div>
    );
  }

  // Dibuja el árbol que armó el administrador: una opción con paso propio es
  // un grupo con sus sub-opciones, en su lugar dentro del flujo. Antes esas
  // opciones desaparecían y sus hijas quedaban sueltas.
  function renderReasonNodes(nodes: ReasonOptionNode[], keyPrefix: string): ReactNode {
    const blocks: ReactNode[] = [];
    let run: CallReasonConfig[] = [];
    const flushRun = () => {
      if (run.length === 0) return;
      blocks.push(
        <div key={`${keyPrefix}-options-${blocks.length}`} className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {run.map((option) => renderReasonOption(option))}
        </div>
      );
      run = [];
    };
    for (const node of nodes) {
      if (node.kind === "reason") {
        run.push(node.option);
        continue;
      }
      flushRun();
      blocks.push(
        <div
          key={`${keyPrefix}-group-${node.label}`}
          role="group"
          aria-label={node.label}
          className="rounded-xl border border-border/70 bg-surface-muted/40 p-3"
        >
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{node.label}</p>
          {renderReasonNodes(node.children, `${keyPrefix}-${node.label}`)}
        </div>
      );
    }
    flushRun();
    return <div className="space-y-2">{blocks}</div>;
  }

  function renderStepChips(labels: string[], selected: string | undefined, depth: number, title: string) {
    return (
      <div role="group" aria-label={title} className="flex flex-wrap gap-2">
        {labels.map((label) => (
          <button
            key={`${depth}-${label}`}
            type="button"
            aria-pressed={selected === label}
            onClick={() =>
              setReasonPath((current) =>
                depth === 0 ? [label] : [selectedStateLabel ?? "", ...current.slice(1, depth), label]
              )
            }
            className={`min-h-10 rounded-full border px-4 py-1.5 text-xs font-bold uppercase transition-colors ${
              selected === label
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-background text-foreground hover:border-primary/50 hover:bg-surface-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    );
  }

  // Un nivel de la cascada: los subgrupos se eligen como pastillas y solo se
  // despliega el elegido; los motivos sueltos de ese nivel se ven de inmediato.
  function renderCascadeLevel(nodes: ReasonOptionNode[], depth: number): ReactNode {
    const groups = nodes.filter((node): node is Extract<ReasonOptionNode, { kind: "group" }> => node.kind === "group");
    const reasons = nodes.filter((node) => node.kind === "reason");
    const selectedGroup = groups.find((group) => group.label === reasonPath[depth]);
    return (
      <div className="space-y-3">
        {groups.length > 0 && renderStepChips(groups.map((group) => group.label), selectedGroup?.label, depth, "Subcategoría")}
        {reasons.length > 0 && renderReasonNodes(reasons, `cascade-${depth}`)}
        {selectedGroup && (
          <div className="border-l-2 border-primary/30 pl-3">{renderCascadeLevel(selectedGroup.children, depth + 1)}</div>
        )}
      </div>
    );
  }

  return (
    <div
      className="space-y-4"
      aria-label={revision ? "Corrección de tipificación" : "Tipificación de llamada"}
      aria-busy={pending !== null}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.repeat && !appointmentScheduleOpen) {
          event.preventDefault();
          void handleClose();
        }
      }}
    >
      {supervision && (
        <div className="space-y-3 rounded-2xl border border-warning/30 bg-warning-bg px-4 py-3 text-foreground">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning text-white">
              <CalendarClock size={17} />
            </span>
            <div>
              <p className="text-sm font-bold">
                {adding ? "Agregar tipificación (supervisión)" : "Corregir tipificación (supervisión)"}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {adding
                  ? "Queda como la última gestión del registro, a nombre del ejecutivo que elijas. No genera una llamada."
                  : "La gestión sigue siendo del ejecutivo que la hizo; la versión anterior queda en la auditoría."}{" "}
                Si la marcas como VENTA EN VALIDACION, entra a la validación de ventas.
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {adding && (
              <label className="block text-xs font-medium text-muted-foreground">
                Ejecutivo al que se acredita
                <select
                  value={creditedAgentId}
                  onChange={(event) => setCreditedAgentId(event.target.value)}
                  className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Elige un ejecutivo</option>
                  {supervision.agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className={`block text-xs font-medium text-muted-foreground ${adding ? "" : "sm:col-span-2"}`}>
              Motivo de supervisión
              <input
                type="text"
                value={supervisorNote}
                onChange={(event) => setSupervisorNote(event.target.value)}
                placeholder="Ej.: el ejecutivo cerró como cotización una venta"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
              />
            </label>
          </div>
        </div>
      )}
      {revision && !supervision && (
        <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning-bg px-4 py-3 text-foreground">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning text-white">
            <CalendarClock size={17} />
          </span>
          <div>
            <p className="text-sm font-bold">Corregir tipificación y agenda</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              La versión anterior quedará en la auditoría. Esta acción no genera una llamada nueva.
            </p>
          </div>
        </div>
      )}
      {!revision && !call.notes && lead.observacion_actual?.trim() && (
        <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface-muted px-4 py-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-primary">
            <MessageSquare size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">Última observación registrada</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {lead.tipificacion_actual ?? "Gestión anterior"}
              {lead.managed_at ? ` · ${new Date(lead.managed_at).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" })}` : ""}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{lead.observacion_actual}</p>
          </div>
        </div>
      )}
      {armed && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/[0.06] px-4 py-3"
        >
          <CheckCircle2 className="shrink-0 text-primary" size={20} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {!hungUp
                ? "Tipificación lista. Se guarda sola al colgar."
                : legalBreakActive
                  ? `Llamada terminada. Se guarda en ${legalBreakRemaining}s`
                  : "Guardando tipificación…"}
            </p>
            {reasonConfig && <p className="mt-0.5 text-xs text-muted-foreground">{reasonConfig.label}</p>}
          </div>
          {!hungUp && (
            <button
              type="button"
              onClick={() => requestAgentHangup()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
            >
              <PhoneOff size={14} aria-hidden="true" />
              Colgar y cerrar
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setArmed(false);
              setAutoAttempt(0);
            }}
            className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Seguir editando
          </button>
        </div>
      )}

      {legalBreakActive && !armed && (
        <div className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning-bg px-4 py-3 text-warning">
          <Clock3 className="shrink-0" size={20} />
          <p className="text-sm font-semibold">Disponible en {legalBreakRemaining}s</p>
        </div>
      )}

      {catalog.length === 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-danger">
          <AlertCircle className="mt-0.5 shrink-0" size={20} />
          <div>
            <p className="text-sm font-semibold">La campaña no tiene una tipificación válida configurada.</p>
            <p className="mt-0.5 text-xs">Informa a supervisión; no se guardará una categoría ajena a este flujo.</p>
          </div>
        </div>
      )}

      <fieldset
        disabled={pending !== null || legalBreakActive || armed || catalog.length === 0}
        className="flex flex-col gap-4 border-0 p-0 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="sticky top-2 z-10 rounded-2xl border border-border bg-surface p-3 shadow-lg">
        {attemptedClose && pendingIssues.length > 0 && (
          <ul className="mb-3 space-y-1 rounded-lg bg-warning-bg p-3 text-xs text-warning">
            {pendingIssues.map((issue) => (
              <li key={issue}>- {issue}</li>
            ))}
          </ul>
        )}

        {message && (
          <div
            role={message.type === "error" ? "alert" : "status"}
            className={`mb-3 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium ${
              message.type === "error" ? "bg-danger-bg text-danger" : "bg-success-bg text-success"
            }`}
          >
            {message.type === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            {message.text}
          </div>
        )}

        {/* pr-16: el teléfono flotante vive en esta misma esquina; incluso
            minimizado a burbuja hay que dejarle su hueco para no tapar las
            acciones de la derecha. */}
        <div className="flex flex-wrap items-center gap-2 pr-16">
          <button
            type="button"
            onClick={() => void handleClose()}
            disabled={pending !== null}
            title="Ctrl + Enter / ⌘ + Enter"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            {pending === "close"
              ? revision
                ? "Guardando corrección..."
                : "Cerrando..."
              : adding
                ? "Guardar tipificación"
                : revision
                  ? "Guardar corrección"
                  : "Guardar y cerrar"}
          </button>
          {reasonConfig && <span className="text-xs font-medium text-muted-foreground">{reasonConfig.label}</span>}

          {!revision && (
            <button
              type="button"
              onClick={() => setDiscardOpen((v) => !v)}
              className="ml-auto rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:text-danger"
            >
              Descartar por error tecnico
            </button>
          )}
        </div>

        {!revision && discardOpen && (
          <div className="mt-3 rounded-lg border border-border bg-background p-3">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Motivo del error tecnico
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={discardReason}
                onChange={(e) => setDiscardReason(e.target.value)}
                placeholder="Ej: se corto la llamada por falla de telefonia"
                className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="button"
                onClick={handleDiscard}
                disabled={pending !== null}
                className="rounded-lg bg-danger px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending === "discard" ? "Descartando..." : "Confirmar"}
              </button>
            </div>
          </div>
        )}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-foreground">
          {adding ? "Nueva tipificación" : revision ? "Corregir tipificación" : "Tipificar"}
        </h2>

        <div className="space-y-5">
          <section aria-labelledby={`${fieldId}-state`} className="space-y-3">
            <h3 id={`${fieldId}-state`} className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Categoría
            </h3>
            {renderStepChips(
              reasonGroups.map((state) => state.label),
              selectedStateLabel,
              0,
              "Categoría"
            )}
            {selectedState ? (
              <div className="border-l-2 border-primary/30 pl-3">
                {renderCascadeLevel(nestReasonOptions(selectedState.reasons), 1)}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Elige la categoría para ver sus motivos.</p>
            )}
          </section>

          {showAgendaBlock && (
            <div className="rounded-lg border border-border bg-background p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CalendarClock size={16} className="text-warning" />
                  <h3 className="text-sm font-semibold text-foreground">Agenda</h3>
                  {reasonConfig?.agenda === "optional" && (
                    <span className="text-xs font-medium text-muted-foreground">Opcional</span>
                  )}
                </div>
                {appointmentScheduleUrl && (
                  <AppointmentScheduleEmbed
                    title="Disponibilidad · Abogado Legal"
                    url={appointmentScheduleUrl}
                    open={appointmentScheduleOpen}
                    onOpenChange={setAppointmentScheduleOpen}
                  />
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${fieldId}-schedule`} className="mb-1.5 block text-xs font-medium text-muted-foreground">Fecha y hora</label>
                  <input
                    id={`${fieldId}-schedule`}
                    type="datetime-local"
                    value={nextActionAt}
                    // Bloques de 30 minutos como en Atlas 1; el navegador solo
                    // sugiere, la validación de la franja es la que manda.
                    step={agendaPolicy ? 1800 : undefined}
                    aria-describedby={agendaPolicyText ? `${fieldId}-schedule-policy` : undefined}
                    onChange={(e) => setNextActionAt(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  {agendaPolicyText && (
                    <p id={`${fieldId}-schedule-policy`} className="mt-1 text-xs text-muted-foreground">
                      {agendaPolicyText}
                    </p>
                  )}
                </div>
                <div>
                  <p className="mb-1.5 block text-xs font-medium text-muted-foreground">Bloque inferido</p>
                  <div className="min-h-10 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground">
                    {inferredNextActionWindow || "Selecciona fecha y hora"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {showEquifaxBlock && (
            <div className="rounded-lg border border-border bg-background p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Datos comerciales Equifax</h3>
              <div className="mb-3">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Productos</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {EQUIFAX_PRODUCTS.map((product) => (
                    <label key={product} className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={equifaxProducts.includes(product)}
                        onChange={() => toggleEquifaxProduct(product)}
                        className="rounded border-border"
                      />
                      {product}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">UF mensual</label>
                  <input
                    type="number"
                    step="0.01"
                    value={equifaxUf}
                    onChange={(e) => setEquifaxUf(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                {reason === "COTIZACION ENVIADA" && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Email destinatario</label>
                    <input
                      type="email"
                      value={equifaxEmail}
                      onChange={(e) => setEquifaxEmail(e.target.value)}
                      placeholder={lead.email ?? "correo@ejemplo.com"}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <label htmlFor={`${fieldId}-notes`} className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {notesRequired ? "Nota (obligatoria sin agenda)" : "Nota"}
            </label>
            <textarea
              id={`${fieldId}-notes`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              aria-required={notesRequired}
              placeholder={notesRequired ? "Obligatoria sin agenda: qué se envió y a quién" : "Opcional"}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      </div>
      </fieldset>
    </div>
  );
}
