"use client";

import { useMemo, useState } from "react";
import type { Call, Interaction, Lead } from "@/lib/types";
import {
  CALL_STATUSES,
  CALL_OUTCOMES_BY_STATUS,
  EQUIFAX_PRODUCTS,
  getAutoReasonForStatus,
  getReasonConfig,
  getReasonsFor,
  validateCallClosure,
  type CallOutcome,
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
  previousCalls,
  interactions,
}: {
  lead: Lead;
  call: Call;
  previousCalls: Call[];
  interactions: Interaction[];
  agentId: string;
}) {
  const [status, setStatus] = useState<CallStatus | "">((call.status as CallStatus) || "");
  const [outcome, setOutcome] = useState<CallOutcome | "">((call.outcome as CallOutcome) || "");
  const [reason, setReason] = useState<string>(call.reason ?? "");
  const [notes, setNotes] = useState<string>(call.notes ?? "");
  const [nextActionAt, setNextActionAt] = useState<string>(isoToLocalInput(call.next_action_at));
  const [nextActionWindow, setNextActionWindow] = useState<string>(call.next_action_window ?? "");
  const [equifaxProducts, setEquifaxProducts] = useState<string[]>(call.equifax_products ?? []);
  const [equifaxUf, setEquifaxUf] = useState<string>(call.equifax_uf_amount?.toString() ?? "");
  const [equifaxEmail, setEquifaxEmail] = useState<string>(call.equifax_recipient_email ?? "");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardReason, setDiscardReason] = useState("");

  const [pending, setPending] = useState<PendingAction>(null);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const reasonConfig = getReasonConfig(reason);
  const agendaRequirement = reasonConfig?.agenda ?? "none";
  const showAgendaBlock = agendaRequirement !== "none";
  const showEquifaxBlock = status === "connected" && (reason === "COTIZACION ENVIADA" || outcome === "sale");
  const outcomeOptions = status === "connected" ? CALL_OUTCOMES_BY_STATUS.connected : [];
  const reasonOptions =
    status === "connected" && outcome ? getReasonsFor(status as CallStatus, outcome as CallOutcome) : [];

  const pendingIssues = useMemo(
    () =>
      validateCallClosure({
        status: status || null,
        outcome: outcome || null,
        reason: reason || null,
        notes,
        next_action_at: localInputToIso(nextActionAt),
        equifax_products: equifaxProducts,
        equifax_uf_amount: equifaxUf ? Number(equifaxUf) : null,
        equifax_recipient_email: equifaxEmail || null,
        lead_email: lead.email,
        contact_email: lead.email,
      }),
    [status, outcome, reason, notes, nextActionAt, equifaxProducts, equifaxUf, equifaxEmail, lead.email]
  );

  function handleStatusChange(value: CallStatus | "") {
    setStatus(value);
    setOutcome("");
    if (value === "out_of_service" || value === "no_answer") {
      setReason(getAutoReasonForStatus(value) ?? "");
    } else {
      setReason("");
    }
  }

  function handleOutcomeChange(value: CallOutcome | "") {
    setOutcome(value);
    setReason("");
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
        status: status || null,
        outcome: outcome || null,
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
    setPending("close");
    setMessage(null);
    try {
      await closeCall({
        callId: call.id,
        leadId: lead.id,
        status: (status || null) as CallStatus | null,
        outcome: (outcome || null) as CallOutcome | null,
        reason: reason || null,
        notes: notes || null,
        next_action_at: localInputToIso(nextActionAt),
        next_action_window: nextActionWindow || null,
        equifax_products: equifaxProducts,
        equifax_uf_amount: equifaxUf ? Number(equifaxUf) : null,
        equifax_recipient_email: equifaxEmail || null,
      });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Error al cerrar gestión." });
    } finally {
      setPending(null);
    }
  }

  async function handleDiscard() {
    if (!discardReason.trim()) {
      setMessage({ type: "error", text: "Indica el motivo del error técnico para descartar." });
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
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Datos del cliente + historial */}
      <div className="space-y-6 lg:col-span-1">
        <div className="rounded-xl border border-border bg-surface p-5">
          <h1 className="text-lg font-semibold text-foreground">{lead.full_name}</h1>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">RUT</dt>
              <dd className="text-foreground">{lead.rut ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Teléfono</dt>
              <dd className="text-foreground">{lead.phone ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Correo</dt>
              <dd className="text-foreground">{lead.email ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Tipificación actual</dt>
              <dd className="text-foreground">{lead.tipificacion_actual ?? "—"}</dd>
            </div>
            {lead.next_action_at && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Próxima agenda</dt>
                <dd className="text-foreground">{new Date(lead.next_action_at).toLocaleString("es-CL")}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Historial previo</h2>
          </div>
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {previousCalls.length === 0 && interactions.length === 0 && (
              <li className="px-5 py-6 text-center text-sm text-muted-foreground">Sin gestiones previas.</li>
            )}
            {previousCalls.map((c) => (
              <li key={c.id} className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{c.reason ?? "—"}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.ended_at ? new Date(c.ended_at).toLocaleString("es-CL") : "—"}
                  </span>
                </div>
                {c.notes && <p className="mt-1 text-sm text-muted-foreground">{c.notes}</p>}
                {c.next_action_at && (
                  <p className="mt-1 text-xs text-accent-foreground">
                    Agenda: {new Date(c.next_action_at).toLocaleString("es-CL")}
                  </p>
                )}
              </li>
            ))}
            {interactions.map((i) => (
              <li key={i.id} className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{i.result}</span>
                  <span className="text-xs text-muted-foreground">{new Date(i.created_at).toLocaleString("es-CL")}</span>
                </div>
                {i.notes && <p className="mt-1 text-sm text-muted-foreground">{i.notes}</p>}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Cascada + agenda + Equifax + resumen */}
      <div className="space-y-6 lg:col-span-2">
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Tipificación de la llamada</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Estado</label>
              <select
                value={status}
                onChange={(e) => handleStatusChange(e.target.value as CallStatus | "")}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Selecciona...</option>
                {CALL_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Resultado</label>
              <select
                value={outcome}
                disabled={status !== "connected"}
                onChange={(e) => handleOutcomeChange(e.target.value as CallOutcome | "")}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Selecciona...</option>
                {outcomeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Motivo</label>
              {status === "connected" ? (
                <select
                  value={reason}
                  disabled={!outcome}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Selecciona...</option>
                  {reasonOptions.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  readOnly
                  value={reason || "—"}
                  className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground"
                />
              )}
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Notas de gestión</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Detalle de la conversación, próximo paso..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {showAgendaBlock && (
            <div className="mt-4 rounded-lg border border-border bg-background p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Agenda</h3>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    agendaRequirement === "required" ? "bg-danger-bg text-danger" : "bg-warning-bg text-warning"
                  }`}
                >
                  {agendaRequirement === "required" ? "Obligatoria" : "Opcional (o deja una observación)"}
                </span>
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
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Bloque horario (opcional)</label>
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
            <div className="mt-4 rounded-lg border border-border bg-background p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Validaciones comerciales Equifax</h3>
              <div className="mb-3">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Productos</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {EQUIFAX_PRODUCTS.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={equifaxProducts.includes(p)}
                        onChange={() => toggleEquifaxProduct(p)}
                        className="rounded border-border"
                      />
                      {p}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">UF mensual de la oportunidad</label>
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
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Email destinatario (si no hay email de contacto/lead)
                    </label>
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
        </div>

        {/* Resumen previo al cierre */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Resumen</h2>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between sm:block">
              <dt className="text-muted-foreground">Estado</dt>
              <dd className="text-foreground">{CALL_STATUSES.find((s) => s.value === status)?.label ?? "—"}</dd>
            </div>
            <div className="flex justify-between sm:block">
              <dt className="text-muted-foreground">Resultado</dt>
              <dd className="text-foreground">{outcomeOptions.find((o) => o.value === outcome)?.label ?? "—"}</dd>
            </div>
            <div className="flex justify-between sm:block">
              <dt className="text-muted-foreground">Motivo</dt>
              <dd className="text-foreground">{reason || "—"}</dd>
            </div>
            <div className="flex justify-between sm:block">
              <dt className="text-muted-foreground">Agenda</dt>
              <dd className="text-foreground">
                {nextActionAt ? new Date(localInputToIso(nextActionAt) ?? "").toLocaleString("es-CL") : "—"}
              </dd>
            </div>
          </dl>
          {notes && <p className="mt-3 text-sm text-muted-foreground">Notas: {notes}</p>}

          {pendingIssues.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-lg bg-warning-bg p-3 text-xs text-warning">
              {pendingIssues.map((issue) => (
                <li key={issue}>• {issue}</li>
              ))}
            </ul>
          )}

          {message && (
            <p className={`mt-3 text-sm font-medium ${message.type === "error" ? "text-danger" : "text-success"}`}>
              {message.text}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
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
              disabled={pending !== null || pendingIssues.length > 0}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            >
              {pending === "close" ? "Cerrando..." : "Guardar y terminar"}
            </button>

            <button
              type="button"
              onClick={() => setDiscardOpen((v) => !v)}
              className="ml-auto rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:text-danger"
            >
              Descartar por error técnico
            </button>
          </div>

          {discardOpen && (
            <div className="mt-3 rounded-lg border border-border bg-background p-3">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Motivo del error técnico (no se escribirá tipificación en el lead)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={discardReason}
                  onChange={(e) => setDiscardReason(e.target.value)}
                  placeholder="Ej: se cortó la llamada por falla de telefonía"
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  type="button"
                  onClick={handleDiscard}
                  disabled={pending !== null}
                  className="rounded-lg bg-danger px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {pending === "discard" ? "Descartando..." : "Confirmar descarte"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
