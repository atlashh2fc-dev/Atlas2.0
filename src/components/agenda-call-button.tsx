"use client";

import { useState } from "react";
import { Phone } from "lucide-react";
import { buttonClasses } from "@/components/ui";
import { requestAgentDial } from "@/lib/agent-control";
import { listLeadDialPhones, type LeadDialPhone } from "@/app/actions/lead-phones";
import { formatDialDigits } from "@/lib/phone-format";

/**
 * Marca un compromiso de la agenda propia.
 *
 * Antes esto era un enlace a la ficha, que no tiene forma de llamar: si el
 * discador no alcanzó a entregar el callback dentro de su ventana, el
 * compromiso quedaba visible pero incallable, porque el marcado manual del CTI
 * está bloqueado en campañas automáticas. El botón le pide al teléfono —lo
 * único que habla SIP— que origine; el servidor abre la gestión.
 *
 * Si la ficha tiene más de un número (los que agregó supervisión), primero se
 * elige a cuál llamar. El principal va siempre primero.
 */
export function AgendaCallButton({
  leadId,
  fullName,
  variant = "primary",
  label = "Llamar ahora",
  source = "agenda",
}: {
  leadId: string;
  fullName: string;
  variant?: "primary" | "secondary";
  label?: string;
  source?: "agenda" | "assigned_lead";
}) {
  const [dialing, setDialing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<LeadDialPhone[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function dial(phone: string | null) {
    setOptions(null);
    setDialing(true);
    requestAgentDial({ leadId, fullName, source, phone });
    // Desde aquí manda el CTI, incluido el screen-pop. El bloqueo es solo
    // para que un doble clic no dispare dos gestiones.
    window.setTimeout(() => setDialing(false), 4000);
  }

  async function start() {
    setError(null);
    setLoading(true);
    try {
      const phones = await listLeadDialPhones(leadId);
      const callable = phones.filter((phone) => !phone.blockedReason);
      if (phones.length <= 1) {
        // Un solo número (o ninguno válido): el servidor usa el principal y
        // explica si no se puede.
        dial(callable[0]?.dialDigits ?? null);
      } else if (callable.length === 0) {
        setError("Todos los números de esta ficha están en la lista de no llamar.");
      } else {
        setOptions(phones);
      }
    } catch (err) {
      // Sin la lista igual se puede llamar al principal, como antes.
      console.error("No se pudieron leer los números de la ficha", err);
      dial(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        disabled={dialing || loading}
        onClick={(event) => {
          // En la agenda la fila completa navega a la ficha; el botón solo marca.
          event.preventDefault();
          event.stopPropagation();
          if (options) {
            setOptions(null);
            return;
          }
          void start();
        }}
        className={buttonClasses({ size: "sm", variant })}
      >
        <Phone size={14} />
        {dialing ? "Marcando…" : loading ? "Buscando números…" : label}
      </button>

      {error && (
        <span role="alert" className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger shadow-lg">
          {error}
        </span>
      )}

      {options && (
        <span
          role="menu"
          aria-label="Elige el número a marcar"
          className="absolute right-0 top-full z-30 mt-1 block w-72 rounded-xl border border-border bg-surface p-1.5 text-left shadow-lg"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <span className="block px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            ¿A qué número llamas?
          </span>
          {options.map((option, index) => (
            <button
              key={option.dialDigits}
              type="button"
              role="menuitem"
              disabled={Boolean(option.blockedReason)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                dial(option.dialDigits);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="block font-medium tabular-nums text-foreground">
                  {index + 1}. {formatDialDigits(option.dialDigits)}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {option.blockedReason ? "No llamar" : option.isPrimary ? "Principal" : option.label ?? "Adicional"}
                </span>
              </span>
              <Phone size={14} className="shrink-0 text-primary" />
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
