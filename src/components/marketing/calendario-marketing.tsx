"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  BriefcaseBusiness,
  Camera,
  ExternalLink,
  FileImage,
  Globe,
  Mail,
  Megaphone,
  MessageCircle,
  Music2,
  Shapes,
  ThumbsUp,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { Badge, SlideOver, StatusDot, buttonClasses } from "@/components/ui";
import { fechaEnChile } from "@/lib/citas";
import {
  CANAL_INFO,
  ETIQUETA_ESTADO_MARKETING,
  ETIQUETA_FORMATO,
  ETIQUETA_METRICA,
  ETIQUETA_ORIGEN,
  ETIQUETA_PRODUCTO,
  METRICAS_MARKETING,
  ZONA_MARKETING,
  agruparPorDia,
  diaDeLaSemana,
  enlaceDelCalendario,
  tipoDeArchivo,
  type CanalMarketing,
  type FiltrosMarketing,
  type PiezaMarketing,
  type RangoCalendario,
} from "@/lib/marketing";
import { cn } from "@/lib/utils";

/**
 * El calendario de Marketing: la semana (o el mes) con cada pieza como una
 * ficha del color de su canal. Al tocar una ficha se abre el panel con todo
 * lo demás (texto, archivo, público, métricas), sin salir del calendario.
 *
 * Es de solo lectura: las piezas las escriben los alimentadores.
 */

/** Las marcas no vienen en lucide; un glifo simple + el nombre del canal al lado. */
export const ICONO_CANAL: Record<CanalMarketing, LucideIcon> = {
  instagram: Camera,
  facebook: ThumbsUp,
  facebook_grupo: UsersRound,
  email: Mail,
  meta_ads: Megaphone,
  whatsapp: MessageCircle,
  web: Globe,
  tiktok: Music2,
  linkedin: BriefcaseBusiness,
  otro: Shapes,
};

const DIAS_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const DIAS_LARGOS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const MAX_EN_CELDA = 3;

const hora = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_MARKETING, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fechaHora = new Intl.DateTimeFormat("es-CL", {
  timeZone: ZONA_MARKETING,
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const numero = new Intl.NumberFormat("es-CL");

function colorCanal(canal: CanalMarketing): string {
  return `var(${CANAL_INFO[canal].tono})`;
}

function estiloCanal(canal: CanalMarketing): CSSProperties {
  const color = colorCanal(canal);
  return { borderLeftColor: color, backgroundColor: `color-mix(in srgb, ${color} 9%, var(--surface))` };
}

function diaDelMes(fecha: string): number {
  return Number(fecha.slice(8, 10));
}

function diaLegible(fecha: string): string {
  return `${DIAS_LARGOS[diaDeLaSemana(fecha)]} ${diaDelMes(fecha)} de ${MESES_CORTOS[Number(fecha.slice(5, 7)) - 1]}`;
}

/** ¿Es un día siguiente de una pieza de varios días (una campaña de anuncios)? */
function continua(pieza: PiezaMarketing, dia: string): boolean {
  return fechaEnChile(new Date(pieza.scheduled_at)) < dia;
}

/** "13:00", o "En curso" en los días siguientes de una pieza de varios días. */
function cuando(pieza: PiezaMarketing, dia: string): string {
  return continua(pieza, dia) ? "En curso" : hora.format(new Date(pieza.scheduled_at));
}

function descripcionAccesible(pieza: PiezaMarketing, dia: string): string {
  return [pieza.title, CANAL_INFO[pieza.channel].label, ETIQUETA_FORMATO[pieza.format], cuando(pieza, dia), ETIQUETA_ESTADO_MARKETING[pieza.status].label].join(" · ");
}

function FichaPieza({
  pieza,
  dia,
  compacta = false,
  onAbrir,
}: {
  pieza: PiezaMarketing;
  dia: string;
  compacta?: boolean;
  onAbrir: (id: string) => void;
}) {
  const Icono = ICONO_CANAL[pieza.channel];
  const estado = ETIQUETA_ESTADO_MARKETING[pieza.status];
  const base =
    "w-full rounded-md border border-l-[3px] border-border/70 text-left transition-[box-shadow,border-color] hover:border-border-strong hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  // Los días siguientes de una campaña van en una línea, como los eventos de
  // todo el día: la ficha completa ya está en el día en que empieza, y repetida
  // siete veces tapaba lo que sale cada día.
  if (compacta || continua(pieza, dia)) {
    return (
      <button
        type="button"
        onClick={() => onAbrir(pieza.id)}
        aria-label={descripcionAccesible(pieza, dia)}
        title={descripcionAccesible(pieza, dia)}
        className={cn(base, "flex min-h-11 items-center gap-1.5 px-1.5 py-1 text-xs md:min-h-7 md:text-[11px]")}
        style={estiloCanal(pieza.channel)}
      >
        <StatusDot tone={estado.tone} className="h-1.5 w-1.5" />
        <Icono size={12} aria-hidden="true" className="shrink-0" style={{ color: colorCanal(pieza.channel) }} />
        {/* En los días siguientes la hora no dice nada; el título necesita el espacio. */}
        {!continua(pieza, dia) && <span className="shrink-0 tabular-nums text-muted-foreground">{cuando(pieza, dia)}</span>}
        <span className="min-w-0 truncate font-medium text-foreground">{pieza.title}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onAbrir(pieza.id)}
      aria-label={descripcionAccesible(pieza, dia)}
      className={cn(base, "flex min-h-11 flex-col gap-1 px-2 py-1.5")}
      style={estiloCanal(pieza.channel)}
    >
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icono size={13} aria-hidden="true" className="shrink-0" style={{ color: colorCanal(pieza.channel) }} />
        <span className="font-medium tabular-nums text-foreground">{cuando(pieza, dia)}</span>
        <span className="truncate">{CANAL_INFO[pieza.channel].corto}</span>
      </span>
      <span className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">{pieza.title}</span>
      <Badge tone={estado.tone} className="text-[11px]">
        {estado.label}
      </Badge>
    </button>
  );
}

function CabeceraDia({ dia, hoy, atenuado = false, conDia = true }: { dia: string; hoy: string; atenuado?: boolean; conDia?: boolean }) {
  const esHoy = dia === hoy;
  return (
    <div className={cn("flex items-center gap-1.5 text-xs", atenuado ? "text-muted-foreground/60" : "text-muted-foreground")}>
      {conDia && <span className="font-medium">{DIAS_CORTOS[diaDeLaSemana(dia)]}</span>}
      <span
        aria-current={esHoy ? "date" : undefined}
        className={cn(
          "inline-flex size-6 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums",
          esHoy ? "bg-primary text-primary-foreground" : atenuado ? "" : "text-foreground"
        )}
      >
        {diaDelMes(dia)}
      </span>
      {esHoy && <span className="sr-only">(hoy)</span>}
    </div>
  );
}

/** En el teléfono la semana es una lista por día: siete columnas no caben. */
function ListaPorDia({
  dias,
  porDia,
  hoy,
  mostrarVacios,
  onAbrir,
}: {
  dias: string[];
  porDia: Map<string, PiezaMarketing[]>;
  hoy: string;
  mostrarVacios: boolean;
  onAbrir: (id: string) => void;
}) {
  const visibles = mostrarVacios ? dias : dias.filter((dia) => (porDia.get(dia)?.length ?? 0) > 0);
  if (visibles.length === 0) {
    return <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted-foreground md:hidden">Nada programado este mes.</p>;
  }
  return (
    <ol className="space-y-2 md:hidden">
      {visibles.map((dia) => {
        const piezas = porDia.get(dia) ?? [];
        return (
          <li key={dia} className="atlas-panel rounded-xl border border-border bg-surface p-3 shadow-sm">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
              {diaLegible(dia)}
              {dia === hoy && <span className="rounded-md bg-primary/15 px-1.5 py-px text-[11px] font-semibold text-primary">Hoy</span>}
              {piezas.length > 0 && <span className="ml-auto text-xs font-normal text-muted-foreground">{piezas.length === 1 ? "1 pieza" : `${piezas.length} piezas`}</span>}
            </h3>
            {piezas.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Nada programado</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {piezas.map((pieza) => (
                  <li key={pieza.id}>
                    <FichaPieza pieza={pieza} dia={dia} onAbrir={onAbrir} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null | undefined }) {
  if (!valor) return null;
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className="min-w-0 break-words text-foreground">{valor}</dd>
    </div>
  );
}

function PanelPieza({ pieza, onClose }: { pieza: PiezaMarketing | null; onClose: () => void }) {
  if (!pieza) return null;
  const estado = ETIQUETA_ESTADO_MARKETING[pieza.status];
  const Icono = ICONO_CANAL[pieza.channel];
  const archivo = tipoDeArchivo(pieza.asset_url);
  const metricas = Object.entries(pieza.metrics ?? {}).filter(([, valor]) => typeof valor === "number" && Number.isFinite(valor));
  const nombreMetrica = (clave: string) => (METRICAS_MARKETING as readonly string[]).includes(clave) ? ETIQUETA_METRICA[clave as keyof typeof ETIQUETA_METRICA] : clave;
  metricas.sort(([a], [b]) => {
    const ia = (METRICAS_MARKETING as readonly string[]).indexOf(a);
    const ib = (METRICAS_MARKETING as readonly string[]).indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const capitalizar = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

  return (
    <SlideOver
      open
      onClose={onClose}
      title={pieza.title}
      description={
        <span className="inline-flex items-center gap-1.5">
          <Icono size={14} aria-hidden="true" style={{ color: colorCanal(pieza.channel) }} />
          {CANAL_INFO[pieza.channel].label} · {ETIQUETA_FORMATO[pieza.format]}
        </span>
      }
      footer={
        pieza.external_url || pieza.asset_url ? (
          <>
            {pieza.asset_url && (
              <a href={pieza.asset_url} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: pieza.external_url ? "secondary" : "primary" })}>
                <FileImage size={15} aria-hidden="true" />
                Abrir archivo
              </a>
            )}
            {pieza.external_url && (
              <a href={pieza.external_url} target="_blank" rel="noopener noreferrer" className={buttonClasses()}>
                <ExternalLink size={15} aria-hidden="true" />
                Ver publicación
              </a>
            )}
          </>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <section className="space-y-1.5" aria-label="Estado">
          <Badge tone={estado.tone} className="text-[13px]">
            {estado.label}
          </Badge>
          <p className="text-sm text-foreground">
            {pieza.status === "publicado" ? "Publicado el " : "Programado para el "}
            {fechaHora.format(new Date(pieza.status === "publicado" && pieza.published_at ? pieza.published_at : pieza.scheduled_at))}
            {pieza.ends_at && <> · hasta el {fechaHora.format(new Date(pieza.ends_at))}</>}
          </p>
        </section>

        {archivo === "imagen" && pieza.asset_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={pieza.asset_url}
            alt={`Imagen de «${pieza.title}»`}
            loading="lazy"
            className="max-h-96 w-full rounded-lg border border-border bg-surface-muted object-contain"
          />
        )}
        {archivo === "video" && pieza.asset_url && (
          <video
            src={pieza.asset_url}
            controls
            playsInline
            preload="metadata"
            aria-label={`Video de «${pieza.title}»`}
            className="max-h-[28rem] w-full rounded-lg border border-border bg-black"
          />
        )}

        {pieza.body && (
          <section className="space-y-2">
            <h3 className="text-[13px] font-semibold text-foreground">Texto</h3>
            <p className="whitespace-pre-line rounded-lg bg-surface-muted/60 px-3 py-2.5 text-sm leading-relaxed text-foreground">{pieza.body}</p>
          </section>
        )}

        <section className="space-y-1">
          <h3 className="text-[13px] font-semibold text-foreground">Ficha</h3>
          <dl className="divide-y divide-border">
            <Dato etiqueta="Campaña" valor={pieza.campaign} />
            <Dato etiqueta="Producto" valor={pieza.product ? ETIQUETA_PRODUCTO[pieza.product] : null} />
            <Dato etiqueta="Público o grupo" valor={pieza.target} />
            <Dato etiqueta="Agente" valor={pieza.agent} />
            <Dato etiqueta="Cargado por" valor={ETIQUETA_ORIGEN[pieza.source]} />
            <Dato etiqueta="Actualizado" valor={capitalizar(fechaHora.format(new Date(pieza.updated_at)))} />
          </dl>
        </section>

        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold text-foreground">Resultados</h3>
          {metricas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {pieza.status === "publicado"
                ? "Sin resultados todavía. Aparecen cuando Meta o Atlas Lead los reportan."
                : "Los resultados aparecen cuando la pieza se publique."}
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {metricas.map(([clave, valor]) => (
                <div key={clave} className="rounded-lg border border-border bg-surface-raised px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{nombreMetrica(clave)}</dt>
                  <dd className="text-lg font-semibold tabular-nums text-foreground">{numero.format(valor)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>
    </SlideOver>
  );
}

export function CalendarioMarketing({
  piezas,
  rango,
  hoy,
  filtros,
}: {
  piezas: PiezaMarketing[];
  rango: RangoCalendario;
  hoy: string;
  filtros: FiltrosMarketing;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const porDia = useMemo(() => agruparPorDia(piezas, rango.dias), [piezas, rango.dias]);
  const seleccionada = abierta ? piezas.find((pieza) => pieza.id === abierta) ?? null : null;

  return (
    <>
      {rango.vista === "semana" ? (
        <>
          <ol aria-label={rango.titulo} className="hidden grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-sm md:grid">
            {rango.dias.map((dia) => {
              const lista = porDia.get(dia) ?? [];
              const finDeSemana = diaDeLaSemana(dia) >= 5;
              return (
                <li key={dia} className={cn("flex min-h-[22rem] min-w-0 flex-col gap-1.5 p-2", finDeSemana ? "bg-surface-raised" : "bg-surface")}>
                  <h3 className="mb-0.5">
                    <span className="sr-only">{diaLegible(dia)}</span>
                    <span aria-hidden="true">
                      <CabeceraDia dia={dia} hoy={hoy} />
                    </span>
                  </h3>
                  {lista.map((pieza) => (
                    <FichaPieza key={pieza.id} pieza={pieza} dia={dia} onAbrir={setAbierta} />
                  ))}
                </li>
              );
            })}
          </ol>
          <ListaPorDia dias={rango.dias} porDia={porDia} hoy={hoy} mostrarVacios onAbrir={setAbierta} />
        </>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-border bg-border shadow-sm md:block">
            <div className="grid grid-cols-7 gap-px" aria-hidden="true">
              {DIAS_CORTOS.map((dia) => (
                <div key={dia} className="bg-surface-raised px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {dia}
                </div>
              ))}
            </div>
            <ol aria-label={rango.titulo} className="grid grid-cols-7 gap-px border-t border-border">
              {rango.dias.map((dia) => {
                // Con tres lugares por celda, primero lo que sale ese día; las
                // campañas que vienen de días anteriores quedan al final.
                const lista = [...(porDia.get(dia) ?? [])].sort((a, b) => Number(continua(a, dia)) - Number(continua(b, dia)));
                const fuera = !dia.startsWith(rango.mes);
                const extra = lista.length - MAX_EN_CELDA;
                return (
                  <li key={dia} className={cn("flex min-h-28 min-w-0 flex-col gap-1 p-1.5", fuera ? "bg-surface-raised" : "bg-surface")}>
                    <h3>
                      <span className="sr-only">{diaLegible(dia)}</span>
                      <span aria-hidden="true">
                        <CabeceraDia dia={dia} hoy={hoy} atenuado={fuera} conDia={false} />
                      </span>
                    </h3>
                    {lista.slice(0, MAX_EN_CELDA).map((pieza) => (
                      <FichaPieza key={pieza.id} pieza={pieza} dia={dia} compacta onAbrir={setAbierta} />
                    ))}
                    {extra > 0 && (
                      <Link
                        href={enlaceDelCalendario("semana", dia, filtros)}
                        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {extra === 1 ? "1 más" : `${extra} más`} · ver la semana
                      </Link>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
          <ListaPorDia
            dias={rango.dias.filter((dia) => dia.startsWith(rango.mes))}
            porDia={porDia}
            hoy={hoy}
            mostrarVacios={false}
            onAbrir={setAbierta}
          />
        </>
      )}

      <PanelPieza pieza={seleccionada} onClose={() => setAbierta(null)} />
    </>
  );
}
