"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";

import {
  cambiarMiPresenciaDigital,
  obtenerMiPresenciaDigital,
  type CanalDigital,
  type PresenciaDigital,
} from "@/app/actions/presencia-digital";
import { cn } from "@/lib/utils";

const REFRESCO_MS = 30_000;
/** Avisa al indicador de la barra que un canal se prendió o apagó. */
const EVENTO_PRESENCIA = "atlas:presencia-digital";

const CANALES: { canal: CanalDigital; label: string; href: string; icon: typeof Mail }[] = [
  { canal: "correo", label: "Correo", href: "/dashboard/conversaciones/correo", icon: Mail },
  { canal: "whatsapp", label: "WhatsApp", href: "/dashboard/conversaciones/whatsapp", icon: MessageCircle },
];

/**
 * Correo y WhatsApp prendidos o apagados, al lado del estado de voz. Voz la
 * gobierna el estado de siempre; esto decide si la cola le entrega trabajo
 * digital. Una pausa como «Correo / cotizaciones» saca de voz pero deja el
 * correo abierto: la llamada interrumpe y el correo espera.
 */
export function CanalesDigitales({ abierto }: { abierto: boolean }) {
  const [presencia, setPresencia] = useState<PresenciaDigital | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const cargar = useCallback(() => {
    obtenerMiPresenciaDigital()
      .then((dato) => {
        setPresencia(dato);
        setError(null);
      })
      .catch(() => setError("No se pudo leer tus canales."));
  }, []);

  useEffect(() => {
    cargar();
    const id = window.setInterval(cargar, REFRESCO_MS);
    return () => window.clearInterval(id);
  }, [cargar]);

  useEffect(() => {
    if (abierto) cargar();
  }, [abierto, cargar]);

  if (!presencia || (!presencia.tieneCorreo && !presencia.tieneWhatsapp)) return null;

  const visibles = CANALES.filter(({ canal }) => (canal === "correo" ? presencia.tieneCorreo : presencia.tieneWhatsapp));

  function cambiar(canal: CanalDigital, activo: boolean) {
    // Se refleja al tiro; si la base lo rechaza, vuelve a lo que había.
    const anterior = presencia;
    setPresencia((actual) => (actual ? { ...actual, [canal]: activo } : actual));
    startTransition(async () => {
      try {
        const nueva = await cambiarMiPresenciaDigital(canal, activo);
        setPresencia(nueva);
        setError(null);
        window.dispatchEvent(new CustomEvent<PresenciaDigital>(EVENTO_PRESENCIA, { detail: nueva }));
      } catch (e) {
        setPresencia(anterior);
        setError(e instanceof Error ? e.message : "No se pudo cambiar el canal.");
      }
    });
  }

  return (
    <section className="border-b border-border py-1.5 last:border-0">
      <p className="px-2 pb-1 text-xs font-semibold text-muted-foreground">Canales digitales</p>
      {visibles.map(({ canal, label, href, icon: Icon }) => {
        const prendido = canal === "correo" ? presencia.correo : presencia.whatsapp;
        const recibe = canal === "correo" ? presencia.recibeCorreo : presencia.recibeWhatsapp;
        const pendientes = canal === "correo" ? presencia.pendientesCorreo : presencia.pendientesWhatsapp;
        const nota = !prendido
          ? "Apagado: la cola no te entrega nuevos"
          : recibe
            ? "Recibiendo"
            : "Tu estado actual no recibe nuevos";
        return (
          <div key={canal} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            <Icon size={15} className="shrink-0 text-muted-foreground" aria-hidden />
            <Link href={href} className="min-w-0 flex-1 hover:underline">
              <span className="block text-sm text-foreground">
                {label}
                {pendientes > 0 && (
                  <span className="ml-1.5 text-xs font-semibold tabular-nums text-primary">
                    {pendientes}
                  </span>
                )}
              </span>
              <span className={cn("block text-xs", prendido && recibe ? "text-success" : "text-muted-foreground")}>{nota}</span>
            </Link>
            <button
              type="button"
              role="switch"
              aria-checked={prendido}
              aria-label={`${prendido ? "Apagar" : "Prender"} ${label}`}
              disabled={pendiente}
              onClick={() => cambiar(canal, !prendido)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                prendido ? "border-success bg-success" : "border-border-strong bg-surface-muted"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "inline-block size-4 rounded-full bg-white shadow transition-transform",
                  prendido ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          </div>
        );
      })}
      {error && <p role="alert" className="px-2 pt-1 text-xs text-danger">{error}</p>}
    </section>
  );
}

/**
 * Correo y WhatsApp a la vista, junto al estado de voz: verde si la cola le
 * está entregando, ámbar si está prendido pero su estado no recibe, gris si
 * lo apagó. Con el número de clientes que esperan. Un clic abre el menú.
 */
export function IndicadorDigital({ onAbrir }: { onAbrir: () => void }) {
  const [presencia, setPresencia] = useState<PresenciaDigital | null>(null);

  useEffect(() => {
    let vigente = true;
    const cargar = () => {
      obtenerMiPresenciaDigital()
        .then((dato) => {
          if (vigente) setPresencia(dato);
        })
        .catch(() => undefined);
    };
    cargar();
    const id = window.setInterval(cargar, REFRESCO_MS);
    const alCambiar = (evento: Event) => setPresencia((evento as CustomEvent<PresenciaDigital>).detail);
    window.addEventListener(EVENTO_PRESENCIA, alCambiar);
    return () => {
      vigente = false;
      window.clearInterval(id);
      window.removeEventListener(EVENTO_PRESENCIA, alCambiar);
    };
  }, []);

  if (!presencia || (!presencia.tieneCorreo && !presencia.tieneWhatsapp)) return null;
  const visibles = CANALES.filter(({ canal }) => (canal === "correo" ? presencia.tieneCorreo : presencia.tieneWhatsapp));

  return (
    <button
      type="button"
      onClick={onAbrir}
      className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-border bg-surface px-2 text-xs font-medium text-foreground transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={visibles
        .map(({ canal, label }) => {
          const prendido = canal === "correo" ? presencia.correo : presencia.whatsapp;
          const recibe = canal === "correo" ? presencia.recibeCorreo : presencia.recibeWhatsapp;
          const pendientes = canal === "correo" ? presencia.pendientesCorreo : presencia.pendientesWhatsapp;
          return `${label} ${!prendido ? "apagado" : recibe ? "recibiendo" : "sin recibir"}, ${pendientes} pendientes`;
        })
        .join("; ")}
    >
      {visibles.map(({ canal, icon: Icon }) => {
        const prendido = canal === "correo" ? presencia.correo : presencia.whatsapp;
        const recibe = canal === "correo" ? presencia.recibeCorreo : presencia.recibeWhatsapp;
        const pendientes = canal === "correo" ? presencia.pendientesCorreo : presencia.pendientesWhatsapp;
        return (
          <span key={canal} className={cn("inline-flex items-center gap-1", !prendido ? "text-muted-foreground" : recibe ? "text-success" : "text-warning")}>
            <Icon size={14} aria-hidden />
            {pendientes > 0 && <span className="tabular-nums text-foreground">{pendientes}</span>}
          </span>
        );
      })}
    </button>
  );
}
