"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CalendarClock, CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Call, Lead } from "@/lib/types";
import {
  CALL_REASONS,
  EQUIFAX_PRODUCTS,
  getCascadeReasonOptionsFrom,
  getCascadeResultOptionsFrom,
  getCascadeStateOptionsFrom,
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
  saveCallAgenda,
  saveCallProgress,
} from "@/app/actions/calls";
import {
  INTERCALL_BREAK_EVENT,
  INTERCALL_BREAK_STORAGE_KEY,
  readLegalIntercallBreakUntil,
} from "@/lib/intercall-break";

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

type PendingAction = "progress" | "agenda" | "close" | "discard" | null;

export function CallTypificationForm({
  lead,
  call,
  reasonCatalog,
  priority = false,
  revision = false,
}: {
  lead: Lead;
  call: Call;
  reasonCatalog?: CallReasonConfig[];
  /** La gestión llegó desde una llamada: debe dominar la pantalla. */
  priority?: boolean;
  /** Corrige una gestión ya cerrada sin crear una llamada ficticia. */
  revision?: boolean;
}) {
  const router = useRouter();
  // `undefined` significa que el lead no tiene workflow y usa el catálogo
  // histórico. Un arreglo vacío es un workflow inválido y nunca debe caer a
  // Equifax, porque ofrecería tipificaciones que la base luego rechazará.
  const catalog = reasonCatalog === undefined ? CALL_REASONS : reasonCatalog;
  const initialReason = getReasonConfigFrom(catalog, call.reason);
  const [selectedState, setSelectedState] = useState(initialReason?.stateLabel ?? "");
  const [selectedResult, setSelectedResult] = useState(initialReason?.resultLabel ?? "");
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

  const stateOptions = useMemo(() => getCascadeStateOptionsFrom(catalog), [catalog]);
  const resultOptions = useMemo(() => getCascadeResultOptionsFrom(catalog, selectedState), [catalog, selectedState]);
  const reasonOptions = useMemo(
    () => getCascadeReasonOptionsFrom(catalog, selectedState, selectedResult),
    [catalog, selectedState, selectedResult]
  );
  const reasonConfig = getReasonConfigFrom(catalog, reason);
  const showAgendaBlock = reasonConfig?.agenda === "required" || reasonConfig?.agenda === "optional";
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
          next_action_at: localInputToIso(nextActionAt),
          equifax_products: equifaxProducts,
          equifax_uf_amount: equifaxUf ? Number(equifaxUf) : null,
          equifax_recipient_email: equifaxEmail || null,
          lead_email: lead.email,
          contact_email: lead.email,
        },
        catalog
      ),
    [catalog, status, outcome, reason, notes, nextActionAt, equifaxProducts, equifaxUf, equifaxEmail, lead.email]
  );

  function resetSelection() {
    setStatus(null);
    setOutcome(null);
    setReason("");
    setMessage(null);
    setAttemptedClose(false);
  }

  function handleStateSelect(value: string) {
    setSelectedState(value);
    const nextResults = getCascadeResultOptionsFrom(catalog, value);
    setSelectedResult(nextResults.length === 1 ? nextResults[0].label : "");
    resetSelection();
  }

  function handleResultSelect(value: string) {
    setSelectedResult(value);
    resetSelection();
  }

  function handleReasonSelect(option: CallReasonConfig) {
    setReason(option.value);
    setStatus(option.status);
    setOutcome(option.outcome);
    setMessage(null);
    setAttemptedClose(false);
  }

  function toggleEquifaxProduct(product: string) {
    setEquifaxProducts((prev) => (prev.includes(product) ? prev.filter((p) => p !== product) : [...prev, product]));
  }

  async function handleSaveProgress() {
    setPending("progress");
    setMessage(null);
    try {
      const result = await saveCallProgress({
        callId: call.id,
        leadId: lead.id,
        status,
        outcome,
        reason: reason || null,
        notes: notes || null,
      });
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setMessage({ type: "success", text: "Avance guardado." });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Error al guardar avance." });
    } finally {
      setPending(null);
    }
  }

  async function handleSaveAgenda() {
    const iso = localInputToIso(nextActionAt);
    if (!iso) {
      setMessage({ type: "error", text: "Selecciona fecha y hora antes de guardar la agenda." });
      return;
    }
    setPending("agenda");
    setMessage(null);
    try {
      const result = await saveCallAgenda({ callId: call.id, leadId: lead.id, nextActionAt: iso });
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setMessage({ type: "success", text: "Agenda guardada." });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Error al guardar agenda." });
    } finally {
      setPending(null);
    }
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
    try {
      const payload = {
        callId: call.id,
        leadId: lead.id,
        status,
        outcome,
        reason: reason || null,
        notes: notes || null,
        next_action_at: localInputToIso(nextActionAt),
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
      router.replace(revision ? `/dashboard/leads/${lead.id}` : "/dashboard/leads");
      router.refresh();
    } catch (e) {
      console.error("No se pudo completar la acción de gestión", e);
      setMessage({
        type: "error",
        text: revision
          ? "No se pudo guardar la corrección. Reintenta; si persiste, informa a supervisión."
          : "No se pudo cerrar la gestión. Reintenta; si persiste, informa a supervisión.",
      });
    } finally {
      closeInFlightRef.current = false;
      setPending(null);
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
      {priority && (
        <div className="flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3 text-foreground">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <ShieldCheck size={17} />
          </span>
          <div>
            <p className="text-sm font-bold">Tipificación pendiente</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Esta llamada queda en cierre hasta que selecciones un motivo y guardes la gestión.
            </p>
          </div>
        </div>
      )}
      {legalBreakActive && (
        <div className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning-bg px-4 py-3 text-warning">
          <Clock3 className="shrink-0" size={20} />
          <div>
            <p className="text-sm font-semibold">
              Interrupción legal · {legalBreakRemaining}s
            </p>
            <p className="mt-0.5 text-xs">
              La tipificación se habilitará al completar los 10 segundos de descanso efectivo.
            </p>
          </div>
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
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {revision ? "Nueva tipificación" : "Tipificacion rapida Equifax"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {revision
                ? "Selecciona el motivo correcto y agrega una agenda si deben volver a llamar."
                : "Flujo definido por la campana. Selecciona motivo y cierra."}
            </p>
          </div>
          {reasonConfig && (
            <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
              {reasonConfig.agenda === "required" ? "Requiere agenda" : "Lista para cerrar"}
            </span>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">1. Estado</p>
            <div className="grid grid-cols-2 gap-2">
              {stateOptions.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => handleStateSelect(option.label)}
                  className={`rounded-lg border px-4 py-3 text-left text-sm font-semibold transition-colors ${
                    selectedState === option.label
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground hover:bg-surface-muted"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {selectedState && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">2. Resultado</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {resultOptions.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => handleResultSelect(option.label)}
                    className={`rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                      selectedResult === option.label
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-background text-foreground hover:bg-surface-muted"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedResult && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">3. Motivo</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {reasonOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleReasonSelect(option)}
                    className={`min-h-11 rounded-lg border px-3 py-2 text-left text-xs font-semibold uppercase transition-colors ${
                      reason === option.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-foreground hover:bg-surface-muted"
                    }`}
                  >
                    {option.value}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showAgendaBlock && (
            <div className="rounded-lg border border-border bg-background p-4">
              <div className="mb-3 flex items-center gap-2">
                <CalendarClock size={16} className="text-warning" />
                <h3 className="text-sm font-semibold text-foreground">Agenda requerida</h3>
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
              {!revision && (
                <button
                  type="button"
                  onClick={handleSaveAgenda}
                  disabled={pending !== null}
                  className="mt-3 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-muted disabled:opacity-50"
                >
                  {pending === "agenda" ? "Guardando agenda..." : "Guardar agenda"}
                </button>
              )}
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
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Notas de gestion</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Detalle breve o proximo paso..."
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

        <div className="flex flex-wrap items-center gap-2">
          {!revision && (
            <button
              type="button"
              onClick={handleSaveProgress}
              disabled={pending !== null}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-50"
            >
              {pending === "progress" ? "Guardando..." : "Guardar avance"}
            </button>
          )}

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
                ? "Guardar corrección y agenda"
                : "Guardar y terminar"}
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
