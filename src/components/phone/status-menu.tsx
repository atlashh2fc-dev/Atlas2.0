"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { avisoParaEjecutiva, estadoDeTope, formatearMinutos, formatearRestante } from "@/lib/tope-de-pausa";
import { formatElapsed } from "./format";
import { useDismiss } from "./use-dismiss";

export type StatusTone = "available" | "pause" | "acw" | "manual" | "neutral";

export type StatusOption = { id: string; label: string };

export type CampaignOption = { id: string; name: string };

const TONE_CLASSES: Record<StatusTone, string> = {
  available: "border-success/40 bg-success-bg text-success",
  pause: "border-danger/40 bg-danger-bg text-danger",
  acw: "border-warning/40 bg-warning-bg text-warning",
  manual: "border-primary/40 bg-primary/10 text-primary",
  neutral: "border-border bg-surface-muted text-muted-foreground",
};

/**
 * El estado del agente en un solo lugar: Disponible o AUX con su tiempo, la
 * cola en la que recibe llamadas y el audio del puesto. Antes el estado se
 * repetía en seis partes del teléfono y la barra de jornada.
 */
export function StatusMenu({
  label,
  tone,
  since,
  countdown,
  pauseCapSeconds,
  open,
  onOpenChange,
  available,
  aux,
  currentId,
  disabled,
  disabledNote,
  onSelect,
  error,
  onRetry,
  campaigns,
  activeCampaignId,
  campaignDisabled,
  campaignLocked,
  campaignNote,
  campaignError,
  onCampaignChange,
  audio,
}: {
  label: string;
  tone: StatusTone;
  /** Desde cuándo está en el estado (cronómetro). */
  since: string | null;
  /** Reemplaza el cronómetro, por ejemplo la interrupción legal. */
  countdown?: string | null;
  /** Tope de la pausa actual en segundos; nulo si no está en una pausa con tope. */
  pauseCapSeconds?: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  available: StatusOption[];
  aux: StatusOption[];
  currentId: string | null;
  disabled: boolean;
  disabledNote?: ReactNode;
  onSelect: (id: string) => void;
  error: string | null;
  onRetry: () => void;
  campaigns: CampaignOption[];
  activeCampaignId: string | null;
  campaignDisabled: boolean;
  campaignLocked: boolean;
  campaignNote: string | null;
  campaignError: string | null;
  onCampaignChange: (id: string) => void;
  audio: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dismiss = useCallback(() => onOpenChange(false), [onOpenChange]);
  useDismiss(open, ref, dismiss);

  return (
    <div ref={ref} className="relative flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-sm font-semibold transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          TONE_CLASSES[tone]
        )}
      >
        <span className={cn("size-2 rounded-full bg-current", tone === "available" && "animate-pulse")} aria-hidden />
        <span className="max-w-48 truncate">{label}</span>
        {countdown ? (
          <span className="font-mono text-xs tabular-nums">{countdown}</span>
        ) : (
          <Elapsed since={since} />
        )}
        <ChevronDown size={14} aria-hidden />
      </button>
      {!countdown && pauseCapSeconds ? <PauseCap since={since} maxSeconds={pauseCapSeconds} /> : null}

      {open && (
        <div
          role="dialog"
          aria-label="Estado, cola y audio"
          className="absolute left-0 top-full z-[60] mt-2 max-h-[min(34rem,calc(100dvh-5rem))] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-2xl"
        >
          <MenuSection title="Estado">
            {disabledNote && <p className="px-2 pb-1.5 text-xs text-muted-foreground">{disabledNote}</p>}
            {available.map((option) => (
              <MenuOption
                key={option.id}
                label={option.label}
                selected={option.id === currentId}
                disabled={disabled}
                tone="available"
                onClick={() => {
                  onSelect(option.id);
                  onOpenChange(false);
                }}
              />
            ))}
            {aux.map((option) => (
              <MenuOption
                key={option.id}
                label={`AUX · ${option.label}`}
                selected={option.id === currentId}
                disabled={disabled}
                tone="pause"
                onClick={() => {
                  onSelect(option.id);
                  onOpenChange(false);
                }}
              />
            ))}
            {available.length === 0 && aux.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">Cargando estados…</p>
            )}
            {error && (
              <div className="mt-1 flex items-center justify-between gap-2 rounded-lg bg-danger-bg px-2 py-1.5">
                <span role="alert" className="text-xs text-danger">{error}</span>
                <button
                  type="button"
                  onClick={onRetry}
                  className="shrink-0 rounded-md border border-danger/30 px-2 py-1 text-xs font-semibold text-danger"
                >
                  Reintentar
                </button>
              </div>
            )}
          </MenuSection>

          {campaigns.length > 0 && (
            <MenuSection title="Cola automática">
              {campaigns.map((campaign) => (
                <MenuOption
                  key={campaign.id}
                  label={campaign.name}
                  selected={campaign.id === activeCampaignId}
                  disabled={campaignDisabled}
                  tone="neutral"
                  trailing={campaignLocked && campaign.id === activeCampaignId ? <Lock size={13} aria-hidden /> : null}
                  onClick={() => onCampaignChange(campaign.id)}
                />
              ))}
              {campaignNote && <p className="px-2 pt-1 text-xs text-muted-foreground">{campaignNote}</p>}
              {campaignError && <p role="alert" className="px-2 pt-1 text-xs text-danger">{campaignError}</p>}
            </MenuSection>
          )}

          <MenuSection title="Audio">
            <div className="px-2 pb-1">{audio}</div>
          </MenuSection>
        </div>
      )}
    </div>
  );
}

function MenuSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border py-1.5 last:border-0">
      <p className="px-2 pb-1 text-xs font-semibold text-muted-foreground">{title}</p>
      {children}
    </section>
  );
}

function MenuOption({
  label,
  selected,
  disabled,
  tone,
  trailing,
  onClick,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  tone: "available" | "pause" | "neutral";
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      disabled={disabled || selected}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-surface-muted disabled:cursor-default",
        selected ? "font-semibold text-foreground" : "text-foreground disabled:opacity-50"
      )}
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          tone === "available" ? "bg-success" : tone === "pause" ? "bg-danger" : "bg-muted-foreground"
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
      {selected && <Check size={14} className="shrink-0 text-primary" aria-hidden />}
    </button>
  );
}

/** Tiene su propio reloj para no redibujar todo el teléfono cada segundo. */
export function Elapsed({ since, className }: { since: string | null; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  if (!since) return null;
  const started = new Date(since).getTime();
  if (Number.isNaN(started)) return null;
  return (
    <span title="Tiempo en el estado actual" className={cn("font-mono text-xs tabular-nums", className)}>
      {formatElapsed(now - started)}
    </span>
  );
}

/**
 * Lo que le queda de pausa y, al pasarse, el aviso. No bloquea nada: la
 * ejecutiva decide cuándo volver y su supervisor ve lo mismo en el monitor.
 *
 * La cuenta regresiva cambia cada segundo y por eso queda fuera de la región
 * aria-live: solo se anuncia el aviso de exceso, que cambia una vez por minuto.
 */
export function PauseCap({ since, maxSeconds }: { since: string | null; maxSeconds: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  const estado = estadoDeTope({ since, maxSeconds, isPause: true, now });
  if (estado.tipo === "sin_tope") return null;
  const aviso = avisoParaEjecutiva(estado);
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      {estado.tipo === "dentro" && (
        <span
          title={`Tope de esta pausa: ${formatearMinutos(estado.topeSegundos)}`}
          className={cn(
            "whitespace-nowrap",
            // El último minuto se anticipa en ámbar para que alcance a volver.
            estado.restanteSegundos <= 60 ? "font-semibold text-warning" : "text-muted-foreground"
          )}
        >
          Quedan <span className="font-mono tabular-nums">{formatearRestante(estado.restanteSegundos)}</span>
        </span>
      )}
      <span
        role="status"
        aria-live="polite"
        className={cn(
          aviso
            ? "whitespace-nowrap rounded-md border border-danger bg-danger-bg px-2 py-1 font-semibold text-danger ring-2 ring-danger/30"
            : "sr-only"
        )}
      >
        {aviso}
      </span>
    </span>
  );
}
