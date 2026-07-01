"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CalendarClock, CheckCircle2 } from "lucide-react";
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
import { closeCall, discardCallTechnicalError, saveCallAgenda, saveCallProgress } from "@/app/actions/calls";

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

type PendingAction = "progress" | "agenda" | "close" | "discard" | null;

export function CallTypificationForm({
  lead,
  call,
  reasonCatalog,
}: {
  lead: Lead;
  call: Call;
  reasonCatalog?: CallReasonConfig[];
}) {
  const catalog = reasonCatalog && reasonCatalog.length > 0 ? reasonCatalog : CALL_REASONS;
  const initialReason = getReasonConfigFrom(catalog, call.reason);
  const [selectedState, setSelectedState] = useState(initialReason?.stateLabel ?? "");
  const [selectedResult, setSelectedResult] = useState(initialReason?.resultLabel ?? "");
  const [status, setStatus] = useState<CallStatus | null>((call.status as CallStatus | null) ?? initialReason?.status ?? null);
  const [outcome, setOutcome] = useState<CallOutcome | null>((call.outcome as CallOutcome | null) ?? initialReason?.outcome ?? null);
  const [reason, setReason] = useState<string>(call.reason ?? "");
  const [notes, setNotes] = useState<string>(call.notes ?? "");
  const [nextActionAt, setNextActionAt] = useState<string>(isoToLocalInput(call.next_action_at));
  const [nextActionWindow, setNextActionWindow] = useState<string>(call.next_action_window ?? "");
  const [equifaxProducts, setEquifaxProducts] = useState<string[]>(call.equifax_products ?? []);
  const [equifaxUf, setEquifaxUf] = useState<string>(call.equifax_uf_amount?.toString() ?? "");
  const [equifaxEmail, setEquifaxEmail] = useState<string>(call.equifax_recipient_email ?? "");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardReason, setDiscardReason] = useState("");
  const [attemptedClose, setAttemptedClose] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const stateOptions = useMemo(() => getCascadeStateOptionsFrom(catalog), [catalog]);
  const resultOptions = useMemo(() => getCascadeResultOptionsFrom(catalog, selectedState), [catalog, selectedState]);
  const reasonOptions = useMemo(
    () => getCascadeReasonOptionsFrom(catalog, selectedState, selectedResult),
    [catalog, selectedState, selectedResult]
  );
  const reasonConfig = getReasonConfigFrom(catalog, reason);
  const showAgendaBlock = reasonConfig?.agenda === "required" || reasonConfig?.agenda === "optional";
  const showEquifaxBlock = reason === "COTIZACION ENVIADA" || outcome === "sale";

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
      await saveCallProgress({
        callId: call.id,
        leadId: lead.id,
        status,
        outcome,
        reason: reason || null,
        notes: notes || null,
      });
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
      await saveCallAgenda({ callId: call.id, leadId: lead.id, nextActionAt: iso, nextActionWindow: nextActionWindow || null });
      setMessage({ type: "success", text: "Agenda guardada." });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Error al guardar agenda." });
    } finally {
      setPending(null);
    }
  }

  async function handleClose() {
    setAttemptedClose(true);
    if (pendingIssues.length > 0) {
      setMessage({ type: "error", text: "Completa los campos marcados antes de cerrar." });
      return;
    }

    setPending("close");
    setMessage(null);
    try {
      await closeCall({
        callId: call.id,
        leadId: lead.id,
        status,
        outcome,
        reason: reason || null,
        notes: notes || null,
        next_action_at: localInputToIso(nextActionAt),
        next_action_window: nextActionWindow || null,
        equifax_products: equifaxProducts,
        equifax_uf_amount: equifaxUf ? Number(equifaxUf) : null,
        equifax_recipient_email: equifaxEmail || null,
      });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Error al cerrar gestion." });
    } finally {
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
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Error al descartar la llamada." });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Tipificacion rapida Equifax</h2>
            <p className="mt-1 text-xs text-muted-foreground">Flujo definido por la campana. Selecciona motivo y cierra.</p>
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
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Bloque horario</label>
                  <input
                    type="text"
                    value={nextActionWindow}
                    onChange={(e) => setNextActionWindow(e.target.value)}
                    placeholder="Ej: AM / PM, 15:00-16:00"
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleSaveAgenda}
                disabled={pending !== null}
                className="mt-3 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-muted disabled:opacity-50"
              >
                {pending === "agenda" ? "Guardando agenda..." : "Guardar agenda"}
              </button>
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

      <div className="rounded-xl border border-border bg-surface p-5">
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
          <button
            type="button"
            onClick={handleSaveProgress}
            disabled={pending !== null}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-50"
          >
            {pending === "progress" ? "Guardando..." : "Guardar avance"}
          </button>

          <button
            type="button"
            onClick={handleClose}
            disabled={pending !== null}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            {pending === "close" ? "Cerrando..." : "Guardar y terminar"}
          </button>

          <button
            type="button"
            onClick={() => setDiscardOpen((v) => !v)}
            className="ml-auto rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:text-danger"
          >
            Descartar por error tecnico
          </button>
        </div>

        {discardOpen && (
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
    </div>
  );
}
