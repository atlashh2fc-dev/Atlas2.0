"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";

import { Badge, Button, Skeleton, SlideOver } from "@/components/ui";
import {
  COLUMNAS_EVENTO,
  ESTADO_AGENTE_INFO,
  TIPO_CONEXION_INFO,
  TIPOS_CONEXION,
  TIPO_EVENTO_INFO,
  aristasDeLaRed,
  etiquetaDelAgente,
  haceCuanto,
  horaExacta,
  nombreDelAgente,
  type AgenteOrbita,
  type EventoOrbita,
  type TipoConexion,
} from "@/lib/orbita";
import { createClient } from "@/lib/supabase/client";
import { ChipDeAgente } from "./chip-de-agente";

/**
 * El detalle de un agente: quién es, cómo está, con quién se conecta y lo
 * último que hizo (o que le hicieron: el Guardián que lo recuperó, el CEO que
 * le dio una orden). Los eventos se leen al abrir y otra vez cada vez que la
 * actividad en vivo trae algo nuevo.
 */

type Lectura = { clave: string; eventos: EventoOrbita[]; error: boolean };

export function PanelDelAgente({
  agente,
  agentes,
  ahora,
  version,
  onCerrar,
  onSeleccionar,
}: {
  agente: AgenteOrbita | null;
  agentes: AgenteOrbita[];
  ahora: number;
  /** Cambia cuando llega actividad nueva: vuelve a leer los eventos. */
  version: string;
  onCerrar: () => void;
  onSeleccionar: (codigo: string) => void;
}) {
  const [intento, setIntento] = useState(0);
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const codigo = agente?.codigo ?? null;
  const clave = codigo ? `${codigo}|${version}|${intento}` : "";

  useEffect(() => {
    if (!codigo) return;
    let vigente = true;
    const supabase = createClient();
    supabase
      .from("orbita_eventos")
      .select(COLUMNAS_EVENTO)
      // El código ya viene validado ([0-9A-Z_-]): no rompe el filtro.
      .or(`agente_codigo.eq.${codigo},relacionado_con.eq.${codigo}`)
      .order("ocurrido_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (!vigente) return;
        if (error) console.error("[orbita] no se pudo leer los eventos del agente", error.message);
        setLectura({ clave, eventos: (data ?? []) as unknown as EventoOrbita[], error: Boolean(error) });
      });
    return () => {
      vigente = false;
    };
  }, [codigo, clave]);

  // Mientras llega la lectura nueva se siguen mostrando los eventos del mismo
  // agente: el refresco en vivo no hace parpadear la lista.
  const delAgente = lectura && codigo && lectura.clave.startsWith(`${codigo}|`) ? lectura : null;
  const cargando = !delAgente;
  const porCodigo = useMemo(() => new Map(agentes.map((otro) => [otro.codigo, otro])), [agentes]);
  const aristas = useMemo(() => aristasDeLaRed(agentes), [agentes]);

  if (!agente) return <SlideOver open={false} onClose={onCerrar} title="">{null}</SlideOver>;

  const estado = ESTADO_AGENTE_INFO[agente.ultimo_estado] ?? ESTADO_AGENTE_INFO.inactivo;
  const salientes = TIPOS_CONEXION.map((tipo) => ({
    tipo,
    titulo: TIPO_CONEXION_INFO[tipo].verbo,
    codigos: aristas.filter((arista) => arista.de === agente.codigo && arista.tipo === tipo).map((arista) => arista.a),
  }));
  const entrantes = TIPOS_CONEXION.map((tipo) => ({
    tipo,
    titulo: TIPO_CONEXION_INFO[tipo].inverso,
    codigos: aristas.filter((arista) => arista.a === agente.codigo && arista.tipo === tipo).map((arista) => arista.de),
  }));
  const grupos = [...salientes, ...entrantes].filter((grupo) => grupo.codigos.length > 0);

  return (
    <SlideOver
      open
      onClose={onCerrar}
      title={etiquetaDelAgente(agente)}
      description={agente.rol ?? undefined}
      width="md"
    >
      <div className="space-y-6">
        <section aria-label="Estado" className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised p-3.5">
          <ChipDeAgente agente={agente} tamano="lg" />
          <div className="min-w-0">
            <Badge tone={estado.tone} dot>
              {estado.label}
            </Badge>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {estado.descripcion} ·{" "}
              {agente.ultimo_evento_at ? (
                <time dateTime={agente.ultimo_evento_at} title={horaExacta(agente.ultimo_evento_at)}>
                  {haceCuanto(agente.ultimo_evento_at, ahora)}
                </time>
              ) : (
                "sin actividad"
              )}
            </p>
          </div>
        </section>

        {agente.ultimo_resumen && (
          <section>
            <h3 className="text-xs font-medium text-muted-foreground">Último resumen</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground">{agente.ultimo_resumen}</p>
          </section>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Horario</dt>
            <dd className="mt-0.5 text-foreground">{agente.horario ?? "Sin horario fijo"}</dd>
          </div>
          {agente.cron && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Programación</dt>
              <dd className="mt-0.5 font-mono text-[13px] text-foreground">{agente.cron}</dd>
            </div>
          )}
        </dl>

        {agente.descripcion && (
          <section>
            <h3 className="text-xs font-medium text-muted-foreground">Qué hace</h3>
            <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-foreground">{agente.descripcion}</p>
          </section>
        )}

        {grupos.length > 0 && (
          <section>
            <h3 className="text-xs font-medium text-muted-foreground">Conexiones</h3>
            <div className="mt-2 space-y-3">
              {grupos.map((grupo) => (
                <div key={`${grupo.titulo}`}>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span aria-hidden="true" className="h-0.5 w-3 rounded-full" style={{ background: TIPO_CONEXION_INFO[grupo.tipo as TipoConexion].color }} />
                    {grupo.titulo}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {grupo.codigos.map((otro) => {
                      const destino = porCodigo.get(otro);
                      if (!destino) return null;
                      return (
                        <button
                          key={otro}
                          type="button"
                          onClick={() => onSeleccionar(otro)}
                          className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-[13px] text-foreground transition-colors hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9"
                        >
                          <ChipDeAgente agente={destino} />
                          {nombreDelAgente(destino)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section aria-busy={cargando}>
          <h3 className="text-xs font-medium text-muted-foreground">Últimos 20 eventos</h3>
          {cargando ? (
            <ol className="mt-3 space-y-4" aria-label="Cargando eventos">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="flex gap-3">
                  <Skeleton className="mt-1 size-2.5 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-4 w-4/5" />
                  </div>
                </li>
              ))}
            </ol>
          ) : delAgente.error ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-foreground">
              No pudimos leer sus eventos.
              <Button type="button" variant="secondary" size="sm" onClick={() => setIntento((n) => n + 1)}>
                <RefreshCw size={14} aria-hidden="true" />
                Reintentar
              </Button>
            </div>
          ) : delAgente.eventos.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Todavía no reporta eventos. Aparecerán acá cuando corra su primer turno.</p>
          ) : (
            <ol className="relative mt-3 space-y-3.5 before:absolute before:left-[4.5px] before:top-1.5 before:bottom-1.5 before:w-px before:bg-border">
              {delAgente.eventos.map((evento) => {
                const tipo = TIPO_EVENTO_INFO[evento.tipo] ?? TIPO_EVENTO_INFO.tarea;
                const entrante = evento.agente_codigo !== agente.codigo;
                const otro = entrante ? porCodigo.get(evento.agente_codigo) : evento.relacionado_con ? porCodigo.get(evento.relacionado_con) : undefined;
                return (
                  <li key={evento.id} className="relative flex gap-3 pl-0">
                    <span
                      aria-hidden="true"
                      className="relative z-10 mt-1.5 size-2.5 shrink-0 rounded-full border-2 border-surface"
                      style={{ background: `var(--${tipo.tone === "neutral" ? "muted-foreground" : tipo.tone === "info" ? "primary" : tipo.tone})` }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{tipo.label}</span>
                        {otro && (
                          <span className="inline-flex items-center gap-1">
                            {entrante ? `de ${nombreDelAgente(otro)}` : (
                              <>
                                <ArrowRight size={12} aria-hidden="true" />
                                <span className="sr-only">hacia</span>
                                {nombreDelAgente(otro)}
                              </>
                            )}
                          </span>
                        )}
                        <time dateTime={evento.ocurrido_at} title={horaExacta(evento.ocurrido_at)} className="ml-auto tabular-nums">
                          {haceCuanto(evento.ocurrido_at, ahora)}
                        </time>
                      </p>
                      {evento.resumen && <p className="mt-0.5 text-sm leading-snug text-foreground">{evento.resumen}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </SlideOver>
  );
}
