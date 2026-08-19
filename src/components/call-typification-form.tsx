"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CalendarClock, CheckCircle2, Clock3, MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { notifyAgentManagementClosed } from "@/lib/agent-control";
import type { Call, Lead } from "@/lib/types";
import {
  CALL_REASONS,
  EQUIFAX_PRODUCTS,
  getReasonConfigFrom,
  validateCallClosure,
  type CallOutcome,
  type CallReasonConfig,
  type CallStatus,
} from "@/lib/call-typification";
import {
  closeCall,
  discardCallTechnicalError,
  reviseCallManagement,
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
  appointmentScheduleUrl,
  revision = false,
}: {
  lead: Lead;
  call: Call;
  reasonCatalog?: CallReasonConfig[];
  /** Agenda pública específica de la campaña, mostrada dentro del CRM. */
  appointmentScheduleUrl?: string | null;
  /** Corrige una gestión ya cerrada sin crear una llamada ficticia. */
  revision?: boolean;
}) {
  const router = useRouter();
  // `undefined` significa que el lead no tiene workflow y usa el catálogo
  // histórico. Un arreglo vacío es un workflow inválido y nunca debe caer a
  // Equifax, porque ofrecería tipificaciones que la base luego rechazará.
  const catalog = reasonCatalog === undefined ? CALL_REASONS : reasonCatalog;
  const initialReason = getReasonConfigFrom(catalog, call.reason);
  const [status, setStatus] = useState<CallStatus | null>((call.status as CallStatus | null) ?? initialReason?.status ?? null);
  const [outcome, setOutcome] = useState<CallOutcome | null>((call.outcome as CallOutcome | null) ?? initialReason?.outcome ?? null);
  const [reason, setReason] = useState<string>(call.reason ?? "");
  const [notes, setNotes] = useState<string>(call.notes ?? "");
  const [nextActionAt, setNextActionAt] = useState<string>(isoToLocalInput(call.next_action_at));
  const [equifaxProducts, setEquifaxProducts] = useState<string[]>(call.equifax_products ?? []);
  const [equifaxUf, setEquifaxUf] = useState<string>(call.equifax_uf_amount?.toString() ?? "");
  const [equifaxEmail, setEquifaxEmail] = useState<string>(call.equifax_recipient_email ?? "");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardReason, setDiscardReason] = useState("");
  const [attemptedClose, setAttemptedClose] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [legalBreakUntil, setLegalBreakUntil] = useState(() =>
    readLegalIntercallBreakUntil()
  );
  const [clockNow, setClockNow] = useState(() => Date.now());
  const closeInFlightRef = useRef(false);

  useEffect(() => {
    function handleBreak(event: Event) {
      setLegalBreakUntil((event as CustomEvent<number>).detail);
      setClockNow(Date.now());
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== INTERCALL_BREAK_STORAGE_KEY) return;
      const until = Number(event.newValue);
      setLegalBreakUntil(Number.isFinite(until) ? until : 0);
      setClockNow(Date.now());
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

  const reasonGroups = useMemo(() => {
    const states = new Map<
      string,
      { label: string; orderIndex: number; reasons: CallReasonConfig[] }
    >();

    for (const option of catalog) {
      const state = states.get(option.stateLabel) ?? {
        label: option.stateLabel,
        orderIndex: option.stateOrderIndex,
        reasons: [],
      };
      state.reasons.push(option);
      states.set(option.stateLabel, state);
    }

    return Array.from(states.values())
      .sort((a, b) => a.orderIndex - b.orderIndex || a.label.localeCompare(b.label, "es"))
      .map((state) => ({
        ...state,
        reasons: state.reasons.sort(
          (a, b) =>
            a.resultOrderIndex - b.resultOrderIndex ||
            a.reasonOrderIndex - b.reasonOrderIndex ||
            a.label.localeCompare(b.label, "es")
        ),
      }));
  }, [catalog]);
  const reasonConfig = getReasonConfigFrom(catalog, reason);
  const showAgendaBlock = reasonConfig?.agenda === "required" || reasonConfig?.agenda === "optional";
  // Una corrección puede partir de una gestión que sí tenía agenda. Si la
  // nueva tipificación no la admite, la fecha antigua nunca debe viajar oculta
  // en el payload aunque el estado de React todavía no se haya actualizado.
  const closureNextActionAt = reasonConfig?.agenda === "none" ? null : localInputToIso(nextActionAt);
  const showEquifaxBlock = reason === "COTIZACION ENVIADA" || outcome === "sale";
  const inferredNextActionWindow = localInputToWindow(nextActionAt);
  const legalBreakRemaining = Math.max(
    0,
    Math.ceil((legalBreakUntil - clockNow) / 1000)
  );
  const legalBreakActive = !revision && legalBreakRemaining > 0;

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
        catalog
      ),
    [catalog, status, outcome, reason, notes, closureNextActionAt, equifaxProducts, equifaxUf, equifaxEmail, lead.email]
  );

  function handleReasonSelect(option: CallReasonConfig) {
    setReason(option.value);
    setStatus(option.status);
    setOutcome(option.outcome);
    if (option.agenda === "none") setNextActionAt("");
    setMessage(null);
    setAttemptedClose(false);
  }

  function toggleEquifaxProduct(product: string) {
    setEquifaxProducts((prev) => (prev.includes(product) ? prev.filter((p) => p !== product) : [...prev, product]));
  }

  async function handleClose() {
    if (closeInFlightRef.current) return;
    setAttemptedClose(true);
    if (pendingIssues.length > 0) {
      setMessage({ type: "error", text: "Completa los campos marcados antes de cerrar." });
      return;
    }

    closeInFlightRef.current = true;
    setPending("close");
    setMessage(null);
    let completed = false;
    try {
      const payload = {
        callId: call.id,
        leadId: lead.id,
        status,
        outcome,
        reason: reason || null,
        notes: notes || null,
        next_action_at: closureNextActionAt,
        equifax_products: equifaxProducts,
        equifax_uf_amount: equifaxUf ? Number(equifaxUf) : null,
        equifax_recipient_email: equifaxEmail || null,
      };
      const result = revision
        ? await reviseCallManagement(payload)
        : await closeCall(payload);
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      completed = true;
      setMessage({ type: "success", text: "Tipificación guardada. Abriendo la siguiente gestión…" });
      if (!revision) notifyAgentManagementClosed();
      // Un cierre confirmado no debe volver a habilitar el botón mientras la
      // navegación de Next termina. Una carga completa evita que una transición
      // lenta deje el mismo formulario visible y haga que el ejecutivo vuelva a
      // guardar una gestión que ya quedó cerrada.
      window.location.assign(revision ? `/dashboard/leads/${lead.id}` : "/dashboard/leads");
    } catch (e) {
      console.error("No se pudo completar la acción de gestión", e);
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

  async function handleDiscard() {
    if (!discardReason.trim()) {
      setMessage({ type: "error", text: "Indica el motivo del error tecnico para descartar." });
      return;
    }
    setPending("discard");
    setMessage(null);
    try {
      await discardCallTechnicalError({ callId: call.id, leadId: lead.id, reason: discardReason.trim() });
      notifyAgentManagementClosed();
      router.push("/dashboard/leads");
      router.refresh();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Error al descartar la llamada." });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4" aria-label={revision ? "Corrección de tipificación" : "Tipificación de llamada"}>
      {revision && (
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
      {legalBreakActive && (
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
        disabled={legalBreakActive || catalog.length === 0}
        className="space-y-4 border-0 p-0 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-foreground">
          {revision ? "Corregir tipificación" : "Tipificar"}
        </h2>

        <div className="space-y-5">
          {reasonGroups.map((state) => (
            <section key={state.label} aria-labelledby={`tipificacion-${state.label}`}>
              <h3
                id={`tipificacion-${state.label}`}
                className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground"
              >
                {state.label}
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {state.reasons.map((option) => (
                  <button
                    key={`${option.stateLabel}-${option.resultLabel}-${option.value}`}
                    type="button"
                    onClick={() => handleReasonSelect(option)}
                    aria-pressed={reason === option.value}
                    className={`min-h-11 rounded-lg border px-3 py-2 text-left text-xs font-semibold uppercase transition-colors ${
                      reason === option.value
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-background text-foreground hover:border-primary/50 hover:bg-surface-muted"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>
          ))}

          {showAgendaBlock && (
            <div className="rounded-lg border border-border bg-background p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CalendarClock size={16} className="text-warning" />
                  <h3 className="text-sm font-semibold text-foreground">Agenda</h3>
                </div>
                {appointmentScheduleUrl && (
                  <AppointmentScheduleEmbed
                    title="Disponibilidad · Abogado Legal"
                    url={appointmentScheduleUrl}
                  />
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Fecha y hora</label>
                  <input
                    type="datetime-local"
                    value={nextActionAt}
                    onChange={(e) => setNextActionAt(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
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
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nota</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Opcional"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      </div>

        <div className="sticky bottom-3 z-10 rounded-2xl border border-border bg-surface p-5 shadow-lg">
        {attemptedClose && pendingIssues.length > 0 && (
          <ul className="mb-3 space-y-1 rounded-lg bg-warning-bg p-3 text-xs text-warning">
            {pendingIssues.map((issue) => (
              <li key={issue}>- {issue}</li>
            ))}
          </ul>
        )}

        {message && (
          <div
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
            onClick={handleClose}
            disabled={pending !== null}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            {pending === "close"
              ? revision
                ? "Guardando corrección..."
                : "Cerrando..."
              : revision
                ? "Confirmar"
                : "Confirmar"}
          </button>

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
      </fieldset>
    </div>
  );
}
