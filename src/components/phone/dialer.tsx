"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Delete, Grid3X3, LoaderCircle, Phone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MOBILE_SUBSCRIBER_DIGITS,
  contactInitials,
  formatChileMobile,
  formatSubscriber,
  shortcutLabel,
  subscriberFromPhone,
} from "./format";

export type DialerEntry = {
  key: string;
  name: string | null;
  phone: string;
  rut?: string | null;
  source: "Reciente" | "Contacto";
};

const KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

const MAX_RESULTS = 6;

function isNumericQuery(value: string) {
  return /^[\d\s+().-]*$/.test(value);
}

/**
 * Marcador: un solo campo que acepta número, nombre o RUT y mezcla recientes
 * y contactos. Reemplaza las pestañas Teclado / Recientes / Contactos; el
 * teclado numérico se abre solo si se pide.
 */
export function Dialer({
  subscriber,
  selectedName,
  onTarget,
  entries,
  loading,
  campaigns,
  campaignId,
  onCampaignChange,
  onCall,
  callBlockedReason,
  error,
  notice,
  onClose,
}: {
  subscriber: string;
  selectedName: string | null;
  onTarget: (subscriber: string, name: string | null) => void;
  entries: DialerEntry[];
  loading: boolean;
  campaigns: { id: string; name: string }[];
  campaignId: string;
  onCampaignChange: (id: string) => void;
  onCall: () => void;
  /** Por qué no se puede llamar todavía; null si se puede. */
  callBlockedReason: string | null;
  error: string | null;
  /** Aviso de modo (por ejemplo, salir de la cola automática). */
  notice?: ReactNode;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(() => (subscriber ? formatSubscriber(subscriber) : ""));
  const [highlight, setHighlight] = useState(0);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    const seen = new Set<string>();
    const unique = entries.filter((entry) => {
      const key = subscriberFromPhone(entry.phone);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!term) return unique.filter((entry) => entry.source === "Reciente").slice(0, MAX_RESULTS);
    if (isNumericQuery(term)) {
      if (digits.length < 3) return [];
      return unique.filter((entry) => entry.phone.replace(/\D/g, "").includes(digits)).slice(0, MAX_RESULTS);
    }
    return unique
      .filter(
        (entry) =>
          entry.name?.toLowerCase().includes(term) ||
          entry.rut?.toLowerCase().replace(/[.\s]/g, "").includes(term.replace(/[.\s]/g, ""))
      )
      .slice(0, MAX_RESULTS);
  }, [entries, query]);

  const validNumber = subscriber.length === MOBILE_SUBSCRIBER_DIGITS;
  const canCall = validNumber && !callBlockedReason;

  function updateQuery(value: string) {
    setQuery(value);
    setHighlight(0);
    if (isNumericQuery(value)) onTarget(subscriberFromPhone(value), null);
    else onTarget("", null);
  }

  function choose(entry: DialerEntry) {
    const next = subscriberFromPhone(entry.phone);
    setQuery(formatSubscriber(next));
    onTarget(next, entry.name);
    inputRef.current?.focus();
  }

  function pressDigit(digit: string) {
    const next = subscriberFromPhone(`${subscriber}${digit}`);
    if (subscriber.length >= MOBILE_SUBSCRIBER_DIGITS) return;
    setQuery(formatSubscriber(next));
    onTarget(next, null);
  }

  function backspace() {
    const next = subscriber.slice(0, -1);
    setQuery(formatSubscriber(next));
    onTarget(next, null);
  }

  return (
    <div
      role="dialog"
      aria-label="Marcar"
      className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <p className="text-sm font-semibold">Marcar</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar marcador"
          className="rounded-md p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>

      {notice && <div className="border-b border-border px-4 py-3">{notice}</div>}

      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="shrink-0 font-mono text-lg font-semibold text-muted-foreground">+56 9</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && results.length) {
              event.preventDefault();
              setHighlight((index) => Math.min(results.length - 1, index + 1));
            } else if (event.key === "ArrowUp" && results.length) {
              event.preventDefault();
              setHighlight((index) => Math.max(0, index - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              // Con un número completo Enter llama; si no, elige el resultado marcado.
              if (canCall && isNumericQuery(query)) onCall();
              else if (results[highlight]) choose(results[highlight]);
            }
          }}
          placeholder="Número, nombre o RUT"
          aria-label="Número, nombre o RUT"
          inputMode="text"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent font-mono text-lg font-semibold tracking-wide text-foreground outline-none placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-muted-foreground"
        />
        {query && (
          <button
            type="button"
            onClick={() => updateQuery("")}
            aria-label="Borrar"
            className="rounded-md p-1 text-muted-foreground hover:bg-surface-muted"
          >
            <Delete size={16} />
          </button>
        )}
      </div>

      <div className="max-h-64 overflow-y-auto p-1.5">
        {loading && !results.length ? (
          <p className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
            <LoaderCircle size={14} className="animate-spin" /> Cargando contactos…
          </p>
        ) : results.length ? (
          <ul>
            {results.map((entry, index) => (
              <li key={entry.key}>
                <button
                  type="button"
                  onClick={() => choose(entry)}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left",
                    index === highlight ? "bg-surface-muted" : "hover:bg-surface-muted"
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-foreground ring-1 ring-border">
                    {entry.name ? contactInitials(entry.name) || "·" : <Phone size={13} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{entry.name ?? formatChileMobile(entry.phone)}</span>
                    {entry.name && (
                      <span className="block truncate text-xs text-muted-foreground">{formatChileMobile(entry.phone)}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{entry.source}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {query && !isNumericQuery(query)
              ? "Sin contactos con ese nombre o RUT."
              : validNumber
                ? selectedName ?? "Número completo. Presiona Enter para llamar."
                : `Escribe los 8 dígitos del móvil${subscriber ? ` (faltan ${MOBILE_SUBSCRIBER_DIGITS - subscriber.length})` : ""}.`}
          </p>
        )}
      </div>

      {keypadOpen && (
        <div className="grid grid-cols-3 gap-1.5 border-t border-border px-6 py-3">
          {KEYPAD.map((digit) => (
            <KeypadKey key={digit} digit={digit} onPress={pressDigit} />
          ))}
          <span />
          <KeypadKey digit="0" onPress={pressDigit} />
          <button
            type="button"
            onClick={backspace}
            aria-label="Borrar un dígito"
            className="flex h-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-muted"
          >
            <Delete size={18} />
          </button>
        </div>
      )}

      <div className="space-y-2 border-t border-border px-3 py-3">
        {(error || callBlockedReason) && (
          <p role={error ? "alert" : undefined} className={cn("text-xs", error ? "text-danger" : "text-muted-foreground")}>
            {error ?? callBlockedReason}
          </p>
        )}
        <div className="flex items-center gap-2">
          {campaigns.length > 1 ? (
            <select
              value={campaignId}
              onChange={(event) => onCampaignChange(event.target.value)}
              aria-label="Campaña de la llamada"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs font-medium text-foreground"
            >
              <option value="">Campaña…</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          ) : campaigns.length === 1 ? (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              Campaña: <span className="font-medium text-foreground">{campaigns[0].name}</span>
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <button
            type="button"
            onClick={() => setKeypadOpen((open) => !open)}
            aria-pressed={keypadOpen}
            title="Teclado numérico"
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg border border-border",
              keypadOpen ? "bg-surface-muted text-foreground" : "text-muted-foreground hover:bg-surface-muted"
            )}
          >
            <Grid3X3 size={16} />
          </button>
          <button
            type="button"
            onClick={onCall}
            disabled={!canCall}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-success px-4 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Phone size={15} aria-hidden />
            Llamar
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Abre el marcador con {shortcutLabel("D")} · ↑↓ para elegir · Enter para llamar
        </p>
      </div>
    </div>
  );
}

function KeypadKey({ digit, onPress }: { digit: string; onPress: (digit: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPress(digit)}
      className="flex h-11 items-center justify-center rounded-lg bg-surface-muted text-base font-semibold text-foreground transition hover:bg-border active:scale-95"
    >
      {digit}
    </button>
  );
}
