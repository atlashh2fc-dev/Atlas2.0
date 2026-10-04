import "server-only";

import { AlertTriangle, ArrowRight, ExternalLink, Lightbulb, RotateCcw, Target } from "lucide-react";

import { Badge, InfoTooltip, SegmentTabs, Skeleton, type BadgeTone } from "@/components/ui";
import { resumenDeCorreo } from "@/lib/marketing-correo.server";
import {
  ESTADO_OBJETIVO_INFO,
  PERIODOS,
  PERIODO_INFO,
  diaDeChile,
  etiquetaDia,
  inicioDelDiaChile,
  sumarDias,
  tableroDeObjetivos,
  type AgenteLeido,
  type CircuitoDeAprendizaje,
  type CorreoLeido,
  type CumplimientoAgente,
  type EventoLeido,
  type Evidencia,
  type MetricaLeida,
  type Objetivo,
  type Periodo,
  type PiezaLeida,
  type TableroDeObjetivos,
  type Tono,
} from "@/lib/orbita-objetivos";
import { haceCuanto, horaExacta } from "@/lib/orbita";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

/**
 * ¿Se cumplió lo pedido? El tablero de objetivos de Órbita: por día, semana y
 * mes, la meta contra lo hecho (contado desde la fuente), lo que falló, la
 * evidencia de cada cifra y el circuito de aprendizaje (falla → reintento →
 * decisión). Las cuentas viven en `src/lib/orbita-objetivos.ts`.
 */

const TONO_BADGE: Record<Tono, BadgeTone> = { good: "success", warn: "warning", danger: "danger", default: "neutral" };
const TONO_TEXTO: Record<Tono, string> = { good: "text-success", warn: "text-warning", danger: "text-danger", default: "text-foreground" };
const TONO_BARRA: Record<Tono, string> = { good: "var(--success)", warn: "var(--warning)", danger: "var(--danger)", default: "var(--primary)" };

const numero = (valor: number) => valor.toLocaleString("es-CL");

// El monitor refresca la página cada 15 s; Atlas Lead no necesita contestar
// tan seguido. Cinco minutos de memoria por instancia bastan.
const MEMORIA_CORREO_MS = 5 * 60 * 1000;
let memoriaCorreo: { slug: string; hasta: number; correo: CorreoLeido; error: string | null } | null = null;

async function correoDeLaEmpresa(slug: string): Promise<{ correo: CorreoLeido; error: string | null }> {
  if (memoriaCorreo && memoriaCorreo.slug === slug && memoriaCorreo.hasta > Date.now()) return memoriaCorreo;
  const resultado = await resumenDeCorreo(slug);
  const salida = resultado.ok
    ? {
        correo: {
          cupo: resultado.datos.cupo_diario,
          porDia: resultado.datos.por_dia ?? [],
          respuestas: resultado.datos.respuestas_7d.map((r) => ({ empresa: r.empresa, recibida_at: r.recibida_at, intencion: r.intencion })),
        },
        error: null,
      }
    : { correo: null, error: resultado.error };
  // Un error se recuerda menos: que el próximo refresco lo vuelva a intentar.
  memoriaCorreo = { slug, hasta: Date.now() + (salida.correo ? MEMORIA_CORREO_MS : 60_000), ...salida };
  return salida;
}

const COLUMNAS_PIEZA = "channel, status, agent, title, target, body, external_id, external_url, scheduled_at, published_at";

export async function ObjetivosOrbita({ periodo }: { periodo: Periodo }) {
  const ahora = new Date();
  const hoy = diaDeChile(ahora);
  const primerDia = sumarDias(hoy, -(PERIODO_INFO[periodo].dias - 1));
  const desde = inicioDelDiaChile(primerDia).toISOString();

  const supabase = await createClient();
  const [agentesR, piezasR, metricasR, eventosR] = await Promise.all([
    supabase.from("orbita_agentes").select("organization_id, codigo, nombre, persona, ultimo_resumen").order("codigo").limit(200),
    supabase
      .from("marketing_items")
      .select(COLUMNAS_PIEZA)
      .eq("channel", "facebook_grupo")
      .gte("scheduled_at", desde)
      .lte("scheduled_at", ahora.toISOString())
      .order("scheduled_at", { ascending: false })
      .limit(2000),
    // 31 días siempre: los grupos activos son una foto y vale la última.
    supabase
      .from("orbita_metricas")
      .select("dia, metrica, agente_codigo, valor, evidencia, updated_at")
      .gte("dia", sumarDias(hoy, -30))
      .order("dia", { ascending: false })
      .limit(1000),
    supabase
      .from("orbita_eventos")
      .select("agente_codigo, tipo, estado, resumen, relacionado_con, ocurrido_at")
      .in("tipo", ["fin", "error", "alerta", "recuperacion", "tarea", "decision"])
      .gte("ocurrido_at", desde)
      .order("ocurrido_at", { ascending: false })
      .limit(3000),
  ]);

  const errorDeLectura = agentesR.error ?? piezasR.error ?? metricasR.error ?? eventosR.error;
  if (errorDeLectura) console.error("[orbita-objetivos] no se pudo leer", errorDeLectura.message);

  const agentes = (agentesR.data ?? []) as (AgenteLeido & { organization_id: string })[];

  // El correo vive en Atlas Lead y se lee por la empresa de la integración de
  // marketing; solo se muestra si estos agentes son de esa empresa.
  let correo: CorreoLeido = null;
  let correoError: string | null = "esta empresa no tiene correo de marketing conectado";
  const slug = process.env.MARKETING_INGEST_ORG?.trim() || "altius";
  const { data: empresaDelCorreo } = await createAdminClient().rpc("organization_id_by_slug", { p_slug: slug });
  if (agentes.length > 0 && typeof empresaDelCorreo === "string" && agentes[0].organization_id === empresaDelCorreo) {
    ({ correo, error: correoError } = await correoDeLaEmpresa(slug));
  }

  const tablero = tableroDeObjetivos({
    periodo,
    ahora,
    agentes,
    piezas: (piezasR.data ?? []) as PiezaLeida[],
    metricas: (metricasR.data ?? []) as MetricaLeida[],
    eventos: (eventosR.data ?? []) as EventoLeido[],
    correo,
    correoError,
    metaGrupos: Number(process.env.ORBITA_META_GRUPOS) || undefined,
  });

  return <TableroObjetivosVista tablero={tablero} periodo={periodo} ahora={ahora.getTime()} errorDeLectura={Boolean(errorDeLectura)} />;
}

/** Solo dibuja: recibe el tablero ya calculado. */
export function TableroObjetivosVista({
  tablero,
  periodo,
  ahora,
  errorDeLectura = false,
}: {
  tablero: TableroDeObjetivos;
  periodo: Periodo;
  ahora: number;
  errorDeLectura?: boolean;
}) {
  return (
    <div className="space-y-5">
      <section className="atlas-panel overflow-hidden rounded-xl border border-border bg-surface shadow-sm" aria-labelledby="objetivos-titulo">
        <CabeceraObjetivos periodo={periodo} cumplidos={tablero.cumplidos} conDatos={tablero.conDatos} dias={tablero.dias} />
        {errorDeLectura && (
          <p className="border-b border-border bg-danger/5 px-5 py-2.5 text-sm text-danger">
            Parte de los datos no se pudo leer; las cifras pueden estar incompletas. Vuelve a cargar en un momento.
          </p>
        )}
        <div className="grid grid-cols-1 gap-px bg-border lg:grid-cols-2">
          {tablero.objetivos.map((objetivo) => (
            <TarjetaObjetivo key={objetivo.id} objetivo={objetivo} periodo={periodo} />
          ))}
        </div>
      </section>

      <TablaPorAgente agentes={tablero.agentes} periodo={periodo} />
      <Aprendizaje circuito={tablero.circuito} periodo={periodo} ahora={ahora} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function CabeceraObjetivos({ periodo, cumplidos, conDatos, dias }: { periodo: Periodo; cumplidos: number; conDatos: number; dias: string[] }) {
  const rango = dias.length === 1 ? etiquetaDia(dias[0]) : `${etiquetaDia(dias[0])} al ${etiquetaDia(dias[dias.length - 1])}`;
  return (
    <header className="border-b border-border px-5 pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="objetivos-titulo" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Target size={15} aria-hidden="true" />
            ¿Se cumplió lo pedido?
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Cada cifra se cuenta desde su fuente, no desde lo que dice el agente. Abre «Ver evidencia» para revisar una por una.
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {conDatos === 0 ? "Sin datos aún" : `${cumplidos} de ${conDatos} objetivos cumplidos`}
          </p>
          <p className="text-xs text-muted-foreground">{rango} · horas de Chile</p>
        </div>
      </div>
      <SegmentTabs
        className="mt-2"
        label="Periodo"
        activeId={periodo}
        tabs={PERIODOS.map((id) => ({
          id,
          label: id === "hoy" ? "Hoy" : id === "semana" ? "Semana (7 días)" : "Mes (30 días)",
          href: id === "hoy" ? "/dashboard/orbita" : `/dashboard/orbita?periodo=${id}`,
        }))}
      />
    </header>
  );
}

function TarjetaObjetivo({ objetivo, periodo }: { objetivo: Objetivo; periodo: Periodo }) {
  const info = ESTADO_OBJETIVO_INFO[objetivo.estado];
  const porcentaje = objetivo.hecho !== null && objetivo.meta ? Math.round((objetivo.hecho / objetivo.meta) * 100) : null;
  return (
    <article className="flex min-w-0 flex-col bg-surface px-5 py-4" aria-labelledby={`objetivo-${objetivo.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`objetivo-${objetivo.id}`} className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            {objetivo.titulo}
            <InfoTooltip text={`${objetivo.comoSeMide} Fuente: ${objetivo.fuente}.`} />
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{objetivo.responsable}</p>
        </div>
        <Badge tone={TONO_BADGE[info.tono]}>{info.label}</Badge>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className={cn("text-[28px] font-semibold leading-none tracking-tight tabular-nums", TONO_TEXTO[info.tono])}>
          {objetivo.hecho === null ? "—" : numero(objetivo.hecho)}
        </span>
        {objetivo.meta !== null && objetivo.meta > 0 && (
          <span className="text-sm text-muted-foreground tabular-nums">
            de {numero(objetivo.meta)} {objetivo.unidad}
            {porcentaje !== null && <span className="ml-1.5 font-medium text-foreground">· {porcentaje} %</span>}
          </span>
        )}
      </div>
      {objetivo.meta !== null && objetivo.meta > 0 && objetivo.hecho !== null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, porcentaje ?? 0)}%`, background: TONO_BARRA[info.tono] }} />
        </div>
      )}

      {objetivo.nota && (
        <p className="mt-2.5 flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden="true" />
          <span>{objetivo.nota}</span>
        </p>
      )}

      {objetivo.desglose.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
          {objetivo.desglose.map((parte) => (
            <div key={parte.label} className="flex items-baseline gap-1.5 text-xs">
              <dt className="text-muted-foreground">{parte.label}</dt>
              <dd className={cn("font-semibold tabular-nums", parte.tono ? TONO_TEXTO[parte.tono] : "text-foreground")}>{numero(parte.valor)}</dd>
            </div>
          ))}
        </dl>
      )}

      {periodo !== "hoy" && objetivo.porDia.length > 1 && <BarrasPorDia objetivo={objetivo} />}

      <ListaDeEvidencia evidencia={objetivo.evidencia} />
    </article>
  );
}

/** Una barra por día, con la meta del día como marca. Sin meta (fin de semana, antes de pedirse), la barra es gris. */
function BarrasPorDia({ objetivo }: { objetivo: Objetivo }) {
  const tope = Math.max(1, ...objetivo.porDia.map((d) => Math.max(d.hecho, d.meta)));
  const conMeta = objetivo.porDia.some((d) => d.meta > 0);
  return (
    <figure className="mt-4">
      <div className="flex h-14 items-end gap-[3px]" role="img" aria-label={`${objetivo.serie}: ${objetivo.porDia.map((d) => `${etiquetaDia(d.dia)} ${d.hecho}`).join(", ")}`}>
        {objetivo.porDia.map((d) => {
          const tono: Tono = d.meta === 0 ? "default" : d.hecho >= d.meta ? "good" : d.hecho > 0 ? "warn" : "danger";
          return (
            <div
              key={d.dia}
              className="relative flex h-full min-w-0 flex-1 items-end"
              title={`${etiquetaDia(d.dia)}: ${numero(d.hecho)}${d.meta ? ` de ${numero(d.meta)}` : " (sin meta ese día)"}`}
            >
              {d.meta > 0 && (
                <span className="absolute inset-x-0 border-t border-dashed border-muted-foreground/50" style={{ bottom: `${(d.meta / tope) * 100}%` }} />
              )}
              <span
                className="w-full rounded-sm"
                style={{
                  height: `${Math.max(d.hecho > 0 ? 6 : 2, (d.hecho / tope) * 100)}%`,
                  background: d.hecho === 0 ? "var(--border)" : d.meta === 0 ? "var(--muted-foreground)" : TONO_BARRA[tono],
                  opacity: d.meta === 0 && d.hecho > 0 ? 0.5 : 1,
                }}
              />
            </div>
          );
        })}
      </div>
      <figcaption className="mt-1 flex justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{etiquetaDia(objetivo.porDia[0].dia)}</span>
        <span>
          {objetivo.serie}
          {conMeta && " · – – meta del día"}
        </span>
        <span>{etiquetaDia(objetivo.porDia[objetivo.porDia.length - 1].dia)}</span>
      </figcaption>
    </figure>
  );
}

const MAX_EVIDENCIA = 60;

function ListaDeEvidencia({ evidencia }: { evidencia: Evidencia[] }) {
  if (evidencia.length === 0) {
    return <p className="mt-4 text-xs text-muted-foreground">Sin evidencia registrada en el periodo.</p>;
  }
  return (
    <details className="group mt-4 rounded-lg border border-border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-xs font-medium text-foreground hover:bg-surface-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span>Ver evidencia ({numero(evidencia.length)})</span>
        <ArrowRight size={14} className="text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
      </summary>
      <ul className="max-h-80 divide-y divide-border overflow-y-auto border-t border-border">
        {evidencia.slice(0, MAX_EVIDENCIA).map((pieza, i) => (
          <li key={`${pieza.cuando}-${i}`} className="flex items-start gap-3 px-3 py-2.5 text-xs">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                {pieza.url ? (
                  <a href={pieza.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 hover:underline">
                    <span className="truncate">{pieza.texto}</span>
                    <ExternalLink size={12} className="shrink-0 text-muted-foreground" aria-label="(abre en otra pestaña)" />
                  </a>
                ) : (
                  <span className="truncate">{pieza.texto}</span>
                )}
              </p>
              {pieza.detalle && <p className="mt-0.5 line-clamp-2 text-muted-foreground">{pieza.detalle}</p>}
            </div>
            <div className="shrink-0 text-right">
              <Badge tone={TONO_BADGE[pieza.tono]}>{pieza.estado}</Badge>
              {pieza.cuando && (
                <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {pieza.cuando.length === 10 ? etiquetaDia(pieza.cuando) : horaExacta(pieza.cuando)}
                </p>
              )}
            </div>
          </li>
        ))}
        {evidencia.length > MAX_EVIDENCIA && (
          <li className="px-3 py-2 text-[11px] text-muted-foreground">Y {numero(evidencia.length - MAX_EVIDENCIA)} más en el periodo.</li>
        )}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------------------

function TablaPorAgente({ agentes, periodo }: { agentes: CumplimientoAgente[]; periodo: Periodo }) {
  if (agentes.length === 0) return null;
  return (
    <section className="atlas-panel overflow-hidden rounded-xl border border-border bg-surface shadow-sm" aria-labelledby="agentes-objetivo-titulo">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 id="agentes-objetivo-titulo" className="text-sm font-semibold text-foreground">
          Cumplimiento por agente
        </h2>
        <p className="text-xs text-muted-foreground">Puntos = hecho ÷ meta {PERIODO_INFO[periodo].frase}, tope 100</p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="px-5 py-2 font-medium">Agente</th>
              <th scope="col" className="px-3 py-2 font-medium">Lo que se le pidió</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Hecho / meta</th>
              <th scope="col" className="w-40 px-3 py-2 font-medium">Puntos</th>
              <th scope="col" className="px-5 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1">
                  Turnos
                  <InfoTooltip align="right" text="Turnos terminados bien / con error en el periodo. Que un turno termine no significa que haya cumplido: eso lo dicen las columnas de la izquierda." />
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {agentes.map((agente) => {
              const tono: Tono = agente.puntos === null ? "default" : agente.puntos >= 100 ? "good" : agente.puntos >= 50 ? "warn" : "danger";
              return (
                <tr key={agente.codigo} className="align-top">
                  <td className="px-5 py-2.5">
                    <p className="font-medium text-foreground">{agente.persona?.trim() || agente.nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      {agente.codigo} · {agente.nombre}
                    </p>
                  </td>
                  <td className="max-w-xs px-3 py-2.5 text-xs text-muted-foreground">
                    <p>{agente.objetivo}</p>
                    {agente.extra && <p className="mt-0.5 font-medium text-foreground">{agente.extra}</p>}
                    {agente.ultimoResumen && (
                      <p className="mt-1 line-clamp-2 italic" title={agente.ultimoResumen}>
                        Último: {agente.ultimoResumen}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {agente.hecho === null || agente.meta === null ? (
                      <span className="text-xs text-muted-foreground">Sin meta en piezas</span>
                    ) : (
                      <span className="font-semibold text-foreground">
                        {numero(agente.hecho)} <span className="font-normal text-muted-foreground">/ {numero(agente.meta)}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {agente.puntos === null ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                          <div className="h-full rounded-full" style={{ width: `${agente.puntos}%`, background: TONO_BARRA[tono] }} />
                        </div>
                        <span className={cn("w-8 text-right text-xs font-semibold tabular-nums", TONO_TEXTO[tono])}>{agente.puntos}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right text-xs tabular-nums">
                    <span className="text-foreground">{numero(agente.turnosOk)}</span>
                    <span className="text-muted-foreground"> / </span>
                    <span className={agente.turnosConError > 0 ? "font-semibold text-danger" : "text-muted-foreground"}>{numero(agente.turnosConError)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

const PASOS = [
  { id: "fallas", titulo: "Detectó", icono: AlertTriangle, ayuda: "Lo que salió mal y quedó registrado.", tono: "danger" as Tono },
  { id: "reintentos", titulo: "Reintentó", icono: RotateCcw, ayuda: "Lo que el sistema volvió a intentar o mandó a corregir.", tono: "warn" as Tono },
  { id: "aprendizajes", titulo: "Aprendió", icono: Lightbulb, ayuda: "Lo que el CEO decidió cambiar a partir de lo medido.", tono: "good" as Tono },
] as const;

const TIPO_LINEA: Record<CircuitoDeAprendizaje["linea"][number]["tipo"], { label: string; tono: BadgeTone }> = {
  falla: { label: "Falla", tono: "danger" },
  alerta: { label: "Alerta", tono: "warning" },
  reintento: { label: "Reintento", tono: "warning" },
  aprendizaje: { label: "Decisión", tono: "success" },
};

const LINEA_VISIBLE = 8;

function Aprendizaje({ circuito, periodo, ahora }: { circuito: CircuitoDeAprendizaje; periodo: Periodo; ahora: number }) {
  const visibles = circuito.linea.slice(0, LINEA_VISIBLE);
  const resto = circuito.linea.slice(LINEA_VISIBLE);
  return (
    <section className="atlas-panel overflow-hidden rounded-xl border border-border bg-surface shadow-sm" aria-labelledby="aprendizaje-titulo">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 id="aprendizaje-titulo" className="text-sm font-semibold text-foreground">
          Aprendizaje y reintento
        </h2>
        <p className="text-xs text-muted-foreground">Qué falló, qué se volvió a intentar y qué se cambió, {PERIODO_INFO[periodo].frase}</p>
      </header>
      <ol className="grid grid-cols-1 gap-px bg-border sm:grid-cols-3">
        {PASOS.map((paso) => {
          const datos = circuito[paso.id];
          const Icono = paso.icono;
          return (
            <li key={paso.id} className="bg-surface px-5 py-4">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Icono size={14} aria-hidden="true" />
                {paso.titulo}
                <InfoTooltip text={paso.ayuda} />
              </p>
              <p className={cn("mt-2 text-[28px] font-semibold leading-none tabular-nums", datos.total > 0 ? TONO_TEXTO[paso.tono] : "text-foreground")}>
                {numero(datos.total)}
              </p>
              <dl className="mt-2 space-y-0.5">
                {datos.desglose.map((parte) => (
                  <div key={parte.label} className="flex justify-between gap-3 text-xs">
                    <dt className="text-muted-foreground">{parte.label}</dt>
                    <dd className="tabular-nums text-foreground">{numero(parte.valor)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ol>
      {circuito.linea.length === 0 ? (
        <p className="border-t border-border px-5 py-4 text-sm text-muted-foreground">Sin fallas, reintentos ni decisiones registradas en el periodo.</p>
      ) : (
        <div className="border-t border-border">
          <LineaDeHechos items={visibles} ahora={ahora} />
          {resto.length > 0 && (
            <details className="group border-t border-border">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-5 text-xs font-medium text-foreground hover:bg-surface-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                Ver {numero(resto.length)} más
                <ArrowRight size={14} className="text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
              </summary>
              <LineaDeHechos items={resto} ahora={ahora} />
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function LineaDeHechos({ items, ahora }: { items: CircuitoDeAprendizaje["linea"]; ahora: number }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((item, i) => (
        <li key={`${item.cuando}-${i}`} className="grid grid-cols-[5.5rem_1fr] gap-3 px-5 py-2.5 text-xs sm:grid-cols-[6.5rem_10rem_1fr]">
          <span className="pt-px">
            <Badge tone={TIPO_LINEA[item.tipo].tono}>{TIPO_LINEA[item.tipo].label}</Badge>
          </span>
          <span className="hidden truncate font-medium text-foreground sm:block" title={item.agente}>
            {item.agente}
          </span>
          <span className="min-w-0 text-muted-foreground">
            <span className="font-medium text-foreground sm:hidden">{item.agente} · </span>
            {item.texto}
            <time dateTime={item.cuando} title={horaExacta(item.cuando)} className="ml-1.5 whitespace-nowrap text-[11px] text-muted-foreground/80">
              {haceCuanto(item.cuando, ahora)}
            </time>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

/** Mientras llega del servidor: la forma del tablero, sin salto al llegar. */
export function ObjetivosOrbitaCargando() {
  return (
    <div role="status" aria-busy="true" aria-label="Cargando objetivos" className="atlas-panel overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="space-y-2 border-b border-border px-5 py-4">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-3 w-80 max-w-[70vw]" />
        <Skeleton className="mt-3 h-6 w-64" />
      </div>
      <div className="grid grid-cols-1 gap-px bg-border lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-3 bg-surface px-5 py-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-3 w-64" />
          </div>
        ))}
      </div>
    </div>
  );
}

