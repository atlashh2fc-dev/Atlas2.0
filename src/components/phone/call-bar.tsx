"use client";

import Link from "next/link";
import { Grid3X3, LoaderCircle, Mic, MicOff, Pause, PhoneOff, Play } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { contactInitials, shortcutLabel } from "./format";

export type CallQuality = "good" | "fair" | "poor" | null;

const QUALITY_LABEL: Record<Exclude<CallQuality, null>, string> = {
  good: "Calidad de audio buena",
  fair: "Calidad de audio regular: puede haber cortes",
  poor: "Calidad de audio mala: revisa tu conexión",
};

const IN_CALL_KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

/**
 * La llamada en curso, en una barra fija sobre la pantalla de trabajo. Solo
 * lleva lo que se necesita para hablar: quién es, cuánto va y los controles.
 * RUT, correo y datos de la base viven en la ficha, justo debajo.
 */
export function CallBar({
  phase,
  name,
  contactPerson,
  phoneLabel,
  campaignName,
  automatic,
  elapsed,
  quality,
  muted,
  held,
  holdPending,
  keypadOpen,
  dtmfSent,
  leadHref,
  onToggleMute,
  onToggleHold,
  onToggleKeypad,
  onDtmf,
  onHangup,
}: {
  phase: "calling" | "ringing" | "in_call" | "ending";
  name: string | null;
  contactPerson: string | null;
  phoneLabel: string | null;
  campaignName: string | null;
  automatic: boolean;
  elapsed: string | null;
  quality: CallQuality;
  muted: boolean;
  held: boolean;
  holdPending: boolean;
  keypadOpen: boolean;
  dtmfSent: string;
  /** Enlace a la ficha cuando el ejecutivo está en otra pantalla. */
  leadHref: string | null;
  onToggleMute: () => void;
  onToggleHold: () => void;
  onToggleKeypad: () => void;
  onDtmf: (tone: string) => void;
  onHangup: () => void;
}) {
  const inCall = phase === "in_call";
  const status =
    phase === "calling"
      ? "Marcando…"
      : phase === "ringing"
        ? automatic ? "Conectando…" : "Timbrando…"
        : phase === "ending"
          ? "Colgando…"
          : held
            ? "En espera"
            : elapsed;
  const details = [
    contactPerson ? `Contacto: ${contactPerson}` : null,
    phoneLabel,
    campaignName ? `${campaignName}${automatic ? " automática" : " manual"}` : null,
  ].filter(Boolean);

  return (
    <div className="border-b border-border bg-foreground text-background" role="region" aria-label="Llamada en curso">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background/15 text-sm font-semibold">
            {name ? contactInitials(name) || "·" : <LoaderCircle size={16} className="animate-spin" />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {name ?? (automatic ? "Cargando datos del cliente…" : "Llamada saliente")}
            </p>
            {details.length > 0 && (
              <p className="truncate text-xs text-background/70">{details.join(" · ")}</p>
            )}
          </div>
          {leadHref && (
            <Link
              href={leadHref}
              className="shrink-0 rounded-md border border-background/25 px-2 py-1 text-xs font-semibold hover:bg-background/10"
            >
              Abrir ficha
            </Link>
          )}
        </div>

        <div className="flex items-center gap-2" aria-live="polite">
          {inCall && quality && (
            <span className="flex h-3.5 items-end gap-0.5" title={QUALITY_LABEL[quality]} aria-label={QUALITY_LABEL[quality]} role="img">
              {[0, 1, 2].map((bar) => (
                <span
                  key={bar}
                  className={cn(
                    "w-[3px] rounded-sm",
                    bar === 0 ? "h-1.5" : bar === 1 ? "h-2.5" : "h-3.5",
                    quality === "poor"
                      ? bar === 0 ? "bg-danger" : "bg-background/25"
                      : quality === "fair"
                        ? bar < 2 ? "bg-warning" : "bg-background/25"
                        : "bg-success"
                  )}
                />
              ))}
            </span>
          )}
          <span className={cn("font-mono text-lg font-semibold tabular-nums", held && "text-warning")}>{status}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {inCall && (
            <>
              <CallButton
                label={muted ? "Activar" : "Silenciar"}
                shortcut={shortcutLabel("M")}
                active={muted}
                onClick={onToggleMute}
              >
                {muted ? <MicOff size={17} /> : <Mic size={17} />}
              </CallButton>
              <CallButton
                label={held ? "Retomar" : "Espera"}
                shortcut={shortcutLabel("E")}
                active={held}
                disabled={holdPending}
                onClick={onToggleHold}
              >
                {holdPending ? <LoaderCircle size={17} className="animate-spin" /> : held ? <Play size={17} /> : <Pause size={17} />}
              </CallButton>
              <CallButton label="Teclado" shortcut={shortcutLabel("T")} active={keypadOpen} onClick={onToggleKeypad}>
                <Grid3X3 size={17} />
              </CallButton>
            </>
          )}
          <button
            type="button"
            onClick={onHangup}
            disabled={phase === "ending"}
            title={`Colgar (${shortcutLabel("X")})`}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-danger px-3.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            <PhoneOff size={17} aria-hidden />
            Colgar
          </button>
        </div>
      </div>

      {inCall && keypadOpen && (
        <div className="flex flex-wrap items-center gap-3 border-t border-background/15 px-4 py-2">
          <p className="min-w-24 font-mono text-sm tracking-[0.2em]" aria-live="polite">
            {dtmfSent || <span className="font-sans text-xs tracking-normal text-background/60">Marca la opción del menú</span>}
          </p>
          <div className="flex flex-wrap gap-1">
            {IN_CALL_KEYPAD.map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => onDtmf(digit)}
                aria-label={`Marcar ${digit}`}
                className="size-9 rounded-lg bg-background/10 text-sm font-semibold transition hover:bg-background/20 active:scale-95"
              >
                {digit}
              </button>
            ))}
          </div>
          <p className="text-xs text-background/60">También con el teclado del computador.</p>
        </div>
      )}
    </div>
  );
}

function CallButton({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={`${label} (${shortcut})`}
      className={cn(
        "inline-flex h-10 flex-col items-center justify-center gap-0.5 rounded-lg px-2.5 text-xs font-semibold transition disabled:opacity-60",
        active ? "bg-background text-foreground" : "bg-background/10 hover:bg-background/20"
      )}
    >
      {children}
      <span className="leading-none">{label}</span>
    </button>
  );
}
