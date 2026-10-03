"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Radio } from "lucide-react";

import {
  ESTADO_AGENTE_INFO,
  ESTADOS_AGENTE,
  TIPO_CONEXION_INFO,
  TIPO_EVENTO_INFO,
  colorDelAgente,
  haceCuanto,
  horaExacta,
  type AgenteOrbita,
  type EstadoAgente,
  type EventoOrbita,
} from "@/lib/orbita";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { ChipDeAgente } from "./chip-de-agente";
import { PanelDelAgente } from "./panel-del-agente";
import { RedDeAgentes } from "./red-de-agentes";

/**
 * Órbita en vivo: la red (escritorio), la lista de agentes (teléfono), la
 * actividad en vivo y el panel de cada agente.
 *
 * Se mantiene al día sola: escucha los eventos nuevos por Supabase Realtime y,
 * por si el canal se cae, vuelve a leer cada 15 s mientras la pestaña está a
 * la vista. Lo que se relee es la página del servidor (cifras incluidas); el
 * agente abierto en el panel sigue abierto.
 */

const REFRESCO_MS = 15_000;

const consultaMovimiento = "(prefers-reduced-motion: reduce)";
function suscribirMovimiento(avisar: () => void) {
  const medio = window.matchMedia(consultaMovimiento);
  medio.addEventListener("change", avisar);
  return () => medio.removeEventListener("change", avisar);
}
function useMovimientoReducido(): boolean {
  return useSyncExternalStore(
    suscribirMovimiento,
    () => window.matchMedia(consultaMovimiento).matches,
    () => false,
  );
}

/** Lo urgente primero en la lista del teléfono; dentro de cada estado, por código. */
const PRIORIDAD: Record<EstadoAgente, number> = { error: 0, atrasado: 1, corriendo: 2, ok: 3, inactivo: 4 };

export function MonitorOrbita({
  agentes,
  actividad,
  pulsos,
  ahora: ahoraServidor,
  enVivo = true,
}: {
  agentes: AgenteOrbita[];
  /** Últimos eventos para la columna de actividad (sin latidos). */
  actividad: EventoOrbita[];
  /** Eventos con destino de los últimos minutos, para los pulsos de la red. */
  pulsos: EventoOrbita[];
  ahora: string;
  enVivo?: boolean;
}) {
  const router = useRouter();
  const [actualizando, startTransition] = useTransition();
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [reloj, setReloj] = useState(() => Date.parse(ahoraServidor));
  const reducirMovimiento = useMovimientoReducido();
  const origenDelFoco = useRef<HTMLElement | null>(null);
  const ahora = Math.max(reloj, Date.parse(ahoraServidor));

  useEffect(() => {
    const id = window.setInterval(() => setReloj(Date.now()), REFRESCO_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!enVivo) return;
    const supabase = createClient();
    let espera: ReturnType<typeof setTimeout> | null = null;
    const refrescar = () => {
      if (espera) clearTimeout(espera);
      espera = setTimeout(() => startTransition(() => router.refresh()), 400);
    };
    const canal = supabase
      .channel("orbita-en-vivo")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orbita_eventos" }, refrescar)
      .on("postgres_changes", { event: "*", schema: "public", table: "orbita_agentes" }, refrescar)
      .subscribe();
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === "visible") refrescar();
    }, REFRESCO_MS);
    return () => {
      if (espera) clearTimeout(espera);
      window.clearInterval(intervalo);
      void supabase.removeChannel(canal);
    };
  }, [enVivo, router]);

  const porCodigo = useMemo(() => new Map(agentes.map((agente) => [agente.codigo, agente])), [agentes]);
  const elegido = seleccionado ? porCodigo.get(seleccionado) ?? null : null;

  const seleccionar = useCallback((codigo: string) => {
    if (!origenDelFoco.current && document.activeElement instanceof HTMLElement) origenDelFoco.current = document.activeElement;
    setSeleccionado(codigo);
  }, []);
  const cerrar = useCallback(() => {
    setSeleccionado(null);
    // El foco vuelve a donde estaba (el nodo, la tarjeta, el evento).
    const origen = origenDelFoco.current;
    origenDelFoco.current = null;
    window.setTimeout(() => origen?.focus(), 0);
  }, []);

  const enLista = useMemo(
    () => [...agentes].sort((a, b) => PRIORIDAD[a.ultimo_estado] - PRIORIDAD[b.ultimo_estado] || a.codigo.localeCompare(b.codigo, "es", { numeric: true })),
    [agentes],
  );
  const version = `${actividad[0]?.id ?? ""}|${elegido?.ultimo_evento_at ?? ""}`;
  const vivo = <IndicadorEnVivo enVivo={enVivo} actualizando={actualizando} oscuro={false} />;

  return (
    <>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Escritorio y tableta: la red. */}
        <section
          aria-labelledby="orbita-red-titulo"
          className="relative hidden overflow-hidden rounded-2xl border border-white/10 text-slate-200 shadow-[0_20px_60px_-30px_rgba(2,6,23,0.9)] md:block"
          style={{
            backgroundColor: "#060a14",
            backgroundImage:
              "radial-gradient(ellipse 60% 55% at 50% 48%, rgba(56,189,248,0.10), transparent 70%), radial-gradient(ellipse 40% 40% at 82% 12%, rgba(167,139,250,0.10), transparent 70%), radial-gradient(circle at 1px 1px, rgba(148,163,184,0.10) 1px, transparent 0)",
            backgroundSize: "auto, auto, 22px 22px",
          }}
        >
          <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
            <div>
              <h2 id="orbita-red-titulo" className="text-sm font-semibold text-slate-100">
                Red de agentes
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">Toca un agente para ver qué hace, cómo está y con quién se conecta.</p>
            </div>
            <IndicadorEnVivo enVivo={enVivo} actualizando={actualizando} oscuro />
          </header>
          <div className="px-1 lg:px-3">
            <RedDeAgentes
              agentes={agentes}
              pulsos={pulsos}
              ahora={ahora}
              seleccionado={seleccionado}
              onSeleccionar={seleccionar}
              reducirMovimiento={reducirMovimiento}
            />
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-white/[0.06] px-5 py-3 text-[11px] text-slate-400">
            <ul aria-label="Estados" className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {ESTADOS_AGENTE.map((estado) => (
                <li key={estado} className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2 rounded-full" style={{ background: ESTADO_AGENTE_INFO[estado].color }} />
                  {ESTADO_AGENTE_INFO[estado].label}
                </li>
              ))}
            </ul>
            <ul aria-label="Conexiones" className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {(["ordena", "datos", "reporta"] as const).map((tipo) => (
                <li key={tipo} className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-0.5 w-4 rounded-full" style={{ background: TIPO_CONEXION_INFO[tipo].color }} />
                  {TIPO_CONEXION_INFO[tipo].label}
                </li>
              ))}
              <li className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-0 w-4 border-t border-dashed border-slate-400" />
                Órbita vigilada
              </li>
              <li className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-white shadow-[0_0_6px_2px_rgba(56,189,248,0.7)]" />
                Pulso (últimos 10 min)
              </li>
            </ul>
          </footer>
        </section>

        {/* Teléfono: la red no cabe; los agentes van en lista, lo urgente arriba. */}
        <section aria-labelledby="orbita-lista-titulo" className="min-w-0 space-y-3 md:hidden">
          <div className="flex items-center justify-between gap-3">
            <h2 id="orbita-lista-titulo" className="text-sm font-semibold text-foreground">
              Agentes
            </h2>
            {vivo}
          </div>
          <ul className="space-y-2">
            {enLista.map((agente) => {
              const estado = ESTADO_AGENTE_INFO[agente.ultimo_estado] ?? ESTADO_AGENTE_INFO.inactivo;
              return (
                <li key={agente.codigo}>
                  <button
                    type="button"
                    onClick={() => seleccionar(agente.codigo)}
                    className="atlas-panel flex min-h-11 w-full items-start gap-3 rounded-xl border border-border bg-surface p-3.5 text-left shadow-sm transition-colors hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ borderLeft: `3px solid ${colorDelAgente(agente)}` }}
                  >
                    <ChipDeAgente agente={agente} tamano="lg" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">{agente.nombre}</span>
                      {agente.rol && <span className="block truncate text-xs text-muted-foreground">{agente.rol}</span>}
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                          <span
                            aria-hidden="true"
                            className={cn("size-2 rounded-full", agente.ultimo_estado === "corriendo" && "orbita-vivo")}
                            style={{ background: estado.color }}
                          />
                          {estado.label}
                        </span>
                        <span className="text-muted-foreground">{haceCuanto(agente.ultimo_evento_at, ahora)}</span>
                        {agente.horario && <span className="text-muted-foreground">· {agente.horario}</span>}
                      </span>
                      {agente.ultimo_resumen && <span className="mt-1 line-clamp-2 block text-[13px] leading-snug text-muted-foreground">{agente.ultimo_resumen}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Actividad en vivo: lo último que hicieron, del más nuevo al más viejo. */}
        <section aria-labelledby="orbita-actividad-titulo" className="relative min-h-[320px] min-w-0 md:min-h-[420px]">
          <div className="atlas-panel flex h-full max-h-[560px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm xl:absolute xl:inset-0 xl:max-h-none">
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <h2 id="orbita-actividad-titulo" className="text-sm font-semibold text-foreground">
                  Actividad en vivo
                </h2>
                <p className="text-xs text-muted-foreground">Inicios, fines, decisiones, alertas y recuperaciones</p>
              </div>
              <span className="hidden md:inline-flex">{vivo}</span>
            </header>
            {actividad.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 py-10 text-center">
                <p className="text-sm font-medium text-foreground">Sin actividad todavía</p>
                <p className="max-w-xs text-[13px] leading-relaxed text-muted-foreground">
                  Cuando los agentes corran su turno, cada inicio, fin, decisión y recuperación aparece acá al instante.
                </p>
              </div>
            ) : (
              <ol className="flex-1 divide-y divide-border overflow-y-auto" aria-live="polite" aria-relevant="additions">
                {actividad.map((evento) => (
                  <li key={evento.id}>
                    <FilaDeActividad evento={evento} porCodigo={porCodigo} ahora={ahora} onSeleccionar={seleccionar} />
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>

      <PanelDelAgente agente={elegido} agentes={agentes} ahora={ahora} version={version} onCerrar={cerrar} onSeleccionar={setSeleccionado} />
    </>
  );
}

function FilaDeActividad({
  evento,
  porCodigo,
  ahora,
  onSeleccionar,
}: {
  evento: EventoOrbita;
  porCodigo: Map<string, AgenteOrbita>;
  ahora: number;
  onSeleccionar: (codigo: string) => void;
}) {
  const agente = porCodigo.get(evento.agente_codigo);
  const destino = evento.relacionado_con ? porCodigo.get(evento.relacionado_con) : undefined;
  const tipo = TIPO_EVENTO_INFO[evento.tipo] ?? TIPO_EVENTO_INFO.tarea;
  const reciente = ahora - Date.parse(evento.ocurrido_at) < 30_000;
  const colorTipo = tipo.tone === "danger" ? "var(--danger)" : tipo.tone === "warning" ? "var(--warning)" : tipo.tone === "success" ? "var(--success)" : tipo.tone === "info" ? "var(--primary)" : "var(--muted-foreground)";

  return (
    <button
      type="button"
      onClick={() => onSeleccionar(evento.agente_codigo)}
      aria-label={`${agente?.nombre ?? evento.agente_codigo}: ${tipo.label}${evento.resumen ? `, ${evento.resumen}` : ""}. ${haceCuanto(evento.ocurrido_at, ahora)}. Abrir el agente.`}
      className={cn(
        "flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-muted focus:outline-none focus-visible:bg-surface-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        reciente && "orbita-nuevo"
      )}
    >
      {agente ? <ChipDeAgente agente={agente} /> : <span className="size-6 shrink-0 rounded-md bg-surface-muted" aria-hidden="true" />}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">{agente?.nombre ?? `Agente ${evento.agente_codigo}`}</span>
          <time dateTime={evento.ocurrido_at} title={horaExacta(evento.ocurrido_at)} className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {haceCuanto(evento.ocurrido_at, ahora)}
          </time>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: colorTipo }}>
            <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: colorTipo }} />
            {tipo.label}
          </span>
          {destino && (
            <span className="inline-flex items-center gap-1">
              <ArrowRight size={11} aria-hidden="true" />
              {destino.codigo} · {destino.nombre}
            </span>
          )}
        </span>
        {evento.resumen && <span className="mt-1 line-clamp-2 block text-[13px] leading-snug text-foreground/85">{evento.resumen}</span>}
      </span>
    </button>
  );
}

function IndicadorEnVivo({ enVivo, actualizando, oscuro }: { enVivo: boolean; actualizando: boolean; oscuro: boolean }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium", oscuro ? "text-slate-300" : "text-muted-foreground")}
      title={enVivo ? "Se actualiza solo con cada evento y, como respaldo, cada 15 segundos" : "Vista de muestra: no se actualiza"}
    >
      {enVivo ? (
        <span aria-hidden="true" className="relative inline-flex size-2">
          <span className="orbita-vivo absolute inset-0 rounded-full bg-emerald-400" />
          <span className="relative size-2 rounded-full bg-emerald-400" />
        </span>
      ) : (
        <Radio size={12} aria-hidden="true" />
      )}
      {actualizando ? "Actualizando…" : enVivo ? "En vivo" : "Muestra"}
    </span>
  );
}
