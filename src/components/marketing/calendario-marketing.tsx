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
  Play,
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
  agendaPorDia,
  agruparPorDia,
  agruparPublicaciones,
  diaDeLaSemana,
  enlaceDelCalendario,
  gruposDelPlan,
  metricasNumericas,
  portadaDelVideo,
  tipoDeArchivo,
  type CanalMarketing,
  type FiltrosMarketing,
  type GrupoMarketing,
  type PiezaMarketing,
  type RangoCalendario,
} from "@/lib/marketing";
import { cn } from "@/lib/utils";

/**
 * El calendario de Marketing. Tres vistas:
 *
 * - Próximos (la de entrada): las próximas dos semanas como agenda, un día
 *   bajo otro, con la miniatura de cada pieza. Es lo que se mira cada mañana.
 * - Semana: siete columnas, cada publicación como una ficha del color de su red.
 * - Mes: el mes completo, tres fichas por día y el resto en "N más".
 *
 * Lo que sale a la vez en varias redes (un reel en Instagram y en Facebook)
 * es una sola ficha con un ícono por red; el panel muestra cada red con su
 * estado y su enlace. Al tocar una ficha se abre el panel sin salir del
 * calendario. Es de solo lectura: las piezas las escriben los alimentadores.
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
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
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
const diaCorto = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_MARKETING, weekday: "short", day: "numeric", month: "short" });
const numero = new Intl.NumberFormat("es-CL");

const capitalizar = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

function colorCanal(canal: CanalMarketing): string {
  return `var(${CANAL_INFO[canal].tono})`;
}

/** La ficha toma el color de su red; un espacio de plan va sin relleno y con borde punteado. */
function estiloFicha(grupo: GrupoMarketing): CSSProperties {
  const color = colorCanal(grupo.canales[0]);
  return grupo.plan
    ? { borderLeftColor: color }
    : { borderLeftColor: color, backgroundColor: `color-mix(in srgb, ${color} 9%, var(--surface))` };
}

function diaDelMes(fecha: string): number {
  return Number(fecha.slice(8, 10));
}

function diaLegible(fecha: string): string {
  return `${DIAS_LARGOS[diaDeLaSemana(fecha)]} ${diaDelMes(fecha)} de ${MESES_CORTOS[Number(fecha.slice(5, 7)) - 1]}`;
}

/** "Lunes 5 de octubre". */
function diaCompleto(fecha: string): string {
  return `${DIAS_LARGOS[diaDeLaSemana(fecha)]} ${diaDelMes(fecha)} de ${MESES_LARGOS[Number(fecha.slice(5, 7)) - 1]}`;
}

/** ¿Es un día siguiente de una pieza de varios días (una campaña de anuncios)? */
function continua(grupo: GrupoMarketing, dia: string): boolean {
  return fechaEnChile(new Date(grupo.scheduled_at)) < dia;
}

/** "13:00", o "En curso" en los días siguientes de una pieza de varios días. */
function cuando(grupo: GrupoMarketing, dia: string): string {
  return continua(grupo, dia) ? "En curso" : hora.format(new Date(grupo.scheduled_at));
}

/** "IG · FB" */
function canalesCortos(grupo: GrupoMarketing): string {
  return grupo.canales.map((canal) => CANAL_INFO[canal].corto).join(" · ");
}

/** "IG · FB · Reel"; sin repetir cuando el formato se llama como el canal ("Correo", "Anuncio"). */
function canalesYFormato(grupo: GrupoMarketing): string {
  const formato = ETIQUETA_FORMATO[grupo.format];
  const canales = canalesCortos(grupo);
  return canales === formato ? canales : `${canales} · ${formato}`;
}

/** "Instagram y Facebook" */
function canalesLargos(grupo: GrupoMarketing): string {
  const nombres = grupo.canales.map((canal) => CANAL_INFO[canal].label);
  return nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}` : nombres[0];
}

/** "Publicado", o "Falló · 1 de 2" cuando las redes no van parejas. */
function etiquetaEstado(grupo: GrupoMarketing): string {
  const base = ETIQUETA_ESTADO_MARKETING[grupo.estado].label;
  if (!grupo.mixto) return base;
  const cuantas = grupo.piezas.filter((pieza) => pieza.status === grupo.estado).length;
  return `${base} · ${cuantas} de ${grupo.piezas.length}`;
}

function descripcionAccesible(grupo: GrupoMarketing, dia: string): string {
  return [
    grupo.plan ? `Plan: ${grupo.title}` : grupo.title,
    canalesLargos(grupo),
    ETIQUETA_FORMATO[grupo.format],
    cuando(grupo, dia),
    etiquetaEstado(grupo),
  ].join(" · ");
}

/** ¿Ya pasó? (una campaña en curso no ha pasado). */
function yaPaso(grupo: GrupoMarketing, ahora: number): boolean {
  const fin = grupo.ends_at ? Date.parse(grupo.ends_at) : Date.parse(grupo.scheduled_at);
  return fin < ahora;
}

/** La primera pieza del grupo con imagen o video que se pueda mostrar. */
function archivoDelGrupo(grupo: GrupoMarketing): { pieza: PiezaMarketing; tipo: "imagen" | "video" } | null {
  for (const pieza of grupo.piezas) {
    const tipo = tipoDeArchivo(pieza.asset_url);
    if (tipo === "imagen" || tipo === "video") return { pieza, tipo };
  }
  return null;
}

/** Sin portada, el navegador muestra el primer cuadro si se le pide un instante. */
function fuenteDeVideo(url: string, portada: string | undefined): string {
  return portada || url.includes("#") ? url : `${url}#t=0.1`;
}

// ---------------------------------------------------------------------------
// Piezas pequeñas
// ---------------------------------------------------------------------------

function IconosCanal({ grupo, size = 12 }: { grupo: GrupoMarketing; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5" aria-hidden="true">
      {grupo.canales.map((canal) => {
        const Icono = ICONO_CANAL[canal];
        return <Icono key={canal} size={size} className="shrink-0" style={{ color: colorCanal(canal) }} />;
      })}
    </span>
  );
}

function SelloPlan({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded border border-dashed border-border-strong px-1 text-[10px] font-semibold uppercase leading-4 tracking-wide text-muted-foreground",
        className
      )}
    >
      Plan
    </span>
  );
}

/** La baldosa del canal: lo que se ve cuando la pieza no trae imagen ni video. */
function BaldosaCanal({ canal, className, iconSize }: { canal: CanalMarketing; className?: string; iconSize: number }) {
  const Icono = ICONO_CANAL[canal];
  const color = colorCanal(canal);
  return (
    <span
      aria-hidden="true"
      className={cn("flex shrink-0 items-center justify-center rounded-md", className)}
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 14%, var(--surface))` }}
    >
      <Icono size={iconSize} />
    </span>
  );
}

/**
 * Miniatura de la pieza: la imagen o el video (con su portada si la hay), con
 * proporción fija para que nada salte al cargar. Sin archivo, la baldosa del canal.
 */
function Miniatura({
  grupo,
  className,
  iconSize,
}: {
  grupo: GrupoMarketing;
  /** Tamaño y proporción (p. ej. "size-12" o "aspect-video w-full"). */
  className: string;
  iconSize: number;
}) {
  const archivo = archivoDelGrupo(grupo);
  if (!archivo || !archivo.pieza.asset_url) return <BaldosaCanal canal={grupo.canales[0]} className={className} iconSize={iconSize} />;
  const url = archivo.pieza.asset_url;
  const marco = cn("relative block shrink-0 overflow-hidden rounded-md border border-border/70 bg-surface-muted", className);

  if (archivo.tipo === "imagen") {
    return (
      <span className={marco}>
        {/* eslint-disable-next-line @next/next/no-img-element -- URLs de terceros (Drive, CDN de Meta) sin dominio fijo para next/image */}
        <img src={url} alt={grupo.title} loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
      </span>
    );
  }

  const portada = portadaDelVideo(archivo.pieza.metrics);
  return (
    <span className={marco}>
      <video
        src={fuenteDeVideo(url, portada)}
        poster={portada}
        preload="metadata"
        muted
        playsInline
        tabIndex={-1}
        aria-label={grupo.title}
        className="pointer-events-none absolute inset-0 size-full object-cover"
      />
      <span aria-hidden="true" className="absolute bottom-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-black/60 text-white">
        <Play size={9} fill="currentColor" />
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Fichas (semana y mes)
// ---------------------------------------------------------------------------

function FichaGrupo({
  grupo,
  dia,
  compacta = false,
  onAbrir,
}: {
  grupo: GrupoMarketing;
  dia: string;
  compacta?: boolean;
  onAbrir: (id: string) => void;
}) {
  const tono = ETIQUETA_ESTADO_MARKETING[grupo.estado].tone;
  const base = cn(
    "w-full rounded-md border border-l-[3px] text-left transition-[box-shadow,border-color] hover:border-border-strong hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    grupo.plan ? "border-dashed border-border-strong/70" : "border-border/70"
  );
  const etiqueta = descripcionAccesible(grupo, dia);

  // Los días siguientes de una campaña van en una línea, como los eventos de
  // todo el día: la ficha completa ya está en el día en que empieza, y repetida
  // siete veces tapaba lo que sale cada día.
  if (compacta || continua(grupo, dia)) {
    const archivo = archivoDelGrupo(grupo);
    return (
      <button
        type="button"
        onClick={() => onAbrir(grupo.id)}
        aria-label={etiqueta}
        title={etiqueta}
        className={cn(base, "flex min-h-11 items-center gap-1.5 px-1.5 py-1 text-xs md:min-h-7 md:text-[11px]")}
        style={estiloFicha(grupo)}
      >
        <StatusDot tone={tono} className="h-1.5 w-1.5" />
        {archivo && !continua(grupo, dia) ? <Miniatura grupo={grupo} className="size-5 rounded" iconSize={11} /> : <IconosCanal grupo={grupo} />}
        {/* En los días siguientes la hora no dice nada; el título necesita el espacio. */}
        {!continua(grupo, dia) && <span className="shrink-0 tabular-nums text-muted-foreground">{cuando(grupo, dia)}</span>}
        <span className={cn("min-w-0 truncate font-medium", grupo.plan ? "text-muted-foreground" : "text-foreground")}>{grupo.title}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onAbrir(grupo.id)}
      aria-label={etiqueta}
      className={cn(base, "flex min-h-11 flex-col gap-1 px-2 py-1.5")}
      style={estiloFicha(grupo)}
    >
      {archivoDelGrupo(grupo) && <Miniatura grupo={grupo} className="aspect-video w-full" iconSize={16} />}
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <IconosCanal grupo={grupo} size={13} />
        <span className="font-medium tabular-nums text-foreground">{cuando(grupo, dia)}</span>
        <span className="truncate">{canalesCortos(grupo)}</span>
      </span>
      <span className={cn("line-clamp-2 text-[13px] font-medium leading-snug", grupo.plan ? "text-muted-foreground" : "text-foreground")}>
        {grupo.title}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {grupo.plan && <SelloPlan />}
        <Badge tone={tono} className="text-[11px]">
          {etiquetaEstado(grupo)}
        </Badge>
      </span>
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

function SelloHoy({ etiqueta = "Hoy" }: { etiqueta?: string }) {
  return <span className="rounded-md bg-primary/15 px-1.5 py-px text-[11px] font-semibold text-primary">{etiqueta}</span>;
}

/** En el teléfono la semana y el mes son una lista por día: siete columnas no caben. */
function ListaPorDia({
  dias,
  porDia,
  hoy,
  mostrarVacios,
  onAbrir,
}: {
  dias: string[];
  porDia: Map<string, GrupoMarketing[]>;
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
        const grupos = porDia.get(dia) ?? [];
        return (
          <li key={dia} className="atlas-panel rounded-xl border border-border bg-surface p-3 shadow-sm">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
              {diaLegible(dia)}
              {dia === hoy && <SelloHoy />}
              {grupos.length > 0 && (
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {grupos.length === 1 ? "1 publicación" : `${grupos.length} publicaciones`}
                </span>
              )}
            </h3>
            {grupos.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Nada programado</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {grupos.map((grupo) => (
                  <li key={grupo.id}>
                    <FichaGrupo grupo={grupo} dia={dia} onAbrir={onAbrir} />
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

// ---------------------------------------------------------------------------
// Próximos (agenda)
// ---------------------------------------------------------------------------

/** Público o grupo, y el agente que la publica: la segunda línea de la fila. */
function detalleDeFila(grupo: GrupoMarketing): string | null {
  const { target, agent, campaign } = grupo.principal;
  const publico = grupo.plan ? gruposDelPlan(target).join(" · ") : target;
  const partes = [publico, grupo.plan ? null : agent].filter(Boolean);
  if (partes.length) return partes.join(" · ");
  return campaign;
}

function FilaAgenda({ grupo, dia, ahora, onAbrir }: { grupo: GrupoMarketing; dia: string; ahora: number; onAbrir: (id: string) => void }) {
  const tono = ETIQUETA_ESTADO_MARKETING[grupo.estado].tone;
  const pasado = yaPaso(grupo, ahora);
  const enCurso = continua(grupo, dia);
  const detalle = detalleDeFila(grupo);
  const estado = (
    <Badge tone={tono} className="text-[12px]">
      {etiquetaEstado(grupo)}
    </Badge>
  );

  return (
    <button
      type="button"
      onClick={() => onAbrir(grupo.id)}
      aria-label={`${descripcionAccesible(grupo, dia)}${pasado ? " · ya pasó" : ""}`}
      className={cn(
        "flex min-h-16 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4",
        pasado && "opacity-55 hover:opacity-100 focus-visible:opacity-100"
      )}
    >
      <span className="w-11 shrink-0 text-[13px] font-semibold tabular-nums text-foreground">
        {enCurso ? <span className="text-[11px] font-medium text-muted-foreground">En curso</span> : cuando(grupo, dia)}
      </span>
      <span className={cn("relative shrink-0", grupo.plan && "rounded-md border border-dashed border-border-strong p-px")}>
        <Miniatura grupo={grupo} className="size-12" iconSize={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <IconosCanal grupo={grupo} />
          <span className="truncate">
            {canalesYFormato(grupo)}
            {grupo.ends_at && ` · hasta el ${diaCorto.format(new Date(grupo.ends_at))}`}
          </span>
          {grupo.plan && <SelloPlan />}
        </span>
        <span className={cn("block truncate text-sm font-medium", grupo.plan ? "text-muted-foreground" : "text-foreground")}>{grupo.title}</span>
        {detalle && <span className="block truncate text-xs text-muted-foreground">{detalle}</span>}
        {/* En el teléfono el estado baja bajo el título: a la derecha apretaba el título a dos palabras. */}
        <span className="mt-0.5 block sm:hidden">{estado}</span>
      </span>
      <span className="hidden shrink-0 sm:block">{estado}</span>
    </button>
  );
}

function VistaProximos({
  grupos,
  rango,
  hoy,
  ahora,
  onAbrir,
}: {
  grupos: GrupoMarketing[];
  rango: RangoCalendario;
  hoy: string;
  ahora: number;
  onAbrir: (id: string) => void;
}) {
  const agenda = agendaPorDia(grupos, rango.dias);
  // Hoy siempre se ve, aunque no tenga nada: ubica la lista en el tiempo.
  if (rango.dias.includes(hoy) && !agenda.some((entrada) => entrada.dia === hoy)) {
    agenda.unshift({ dia: hoy, piezas: [] });
    agenda.sort((a, b) => a.dia.localeCompare(b.dia));
  }
  const manana = rango.dias[rango.dias.indexOf(hoy) + 1];

  return (
    <ol aria-label={rango.titulo} className="space-y-3">
      {agenda.map(({ dia, piezas: delDia }) => (
        <li key={dia} aria-labelledby={`dia-${dia}`} className="atlas-panel rounded-xl border border-border bg-surface shadow-sm">
          {/* Cabecera fija mientras se recorre el día; sin overflow-hidden en
              la tarjeta, que anularía el sticky. */}
          <h2
            id={`dia-${dia}`}
            className="sticky top-0 z-10 flex items-center gap-2 rounded-t-xl border-b border-border bg-surface/95 px-3 py-2 text-[13px] font-semibold text-foreground backdrop-blur supports-[backdrop-filter]:bg-surface/85 sm:px-4"
          >
            {diaCompleto(dia)}
            {dia === hoy && <SelloHoy />}
            {dia === manana && <SelloHoy etiqueta="Mañana" />}
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {delDia.length === 0 ? "" : delDia.length === 1 ? "1 publicación" : `${delDia.length} publicaciones`}
            </span>
          </h2>
          {delDia.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">Nada programado para hoy.</p>
          ) : (
            <ul className="divide-y divide-border">
              {delDia.map((grupo) => (
                <li key={grupo.id}>
                  <FilaAgenda grupo={grupo} dia={dia} ahora={ahora} onAbrir={onAbrir} />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null | undefined }) {
  if (!valor) return null;
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className="min-w-0 break-words text-foreground">{valor}</dd>
    </div>
  );
}

function nombreMetrica(clave: string): string {
  return (METRICAS_MARKETING as readonly string[]).includes(clave) ? ETIQUETA_METRICA[clave as keyof typeof ETIQUETA_METRICA] : clave;
}

function metricasOrdenadas(pieza: PiezaMarketing): [string, number][] {
  const orden = (clave: string) => {
    const i = (METRICAS_MARKETING as readonly string[]).indexOf(clave);
    return i === -1 ? 99 : i;
  };
  return metricasNumericas(pieza.metrics).sort(([a], [b]) => orden(a) - orden(b));
}

function Metricas({ metricas }: { metricas: [string, number][] }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {metricas.map(([clave, valor]) => (
        <div key={clave} className="rounded-lg border border-border bg-surface-raised px-3 py-2">
          <dt className="text-xs text-muted-foreground">{nombreMetrica(clave)}</dt>
          <dd className="text-lg font-semibold tabular-nums text-foreground">{numero.format(valor)}</dd>
        </div>
      ))}
    </dl>
  );
}

function momentoDeLaPieza(pieza: PiezaMarketing): string {
  if (pieza.status === "publicado") return `Publicado el ${fechaHora.format(new Date(pieza.published_at ?? pieza.scheduled_at))}`;
  return `Programado para el ${fechaHora.format(new Date(pieza.scheduled_at))}`;
}

function PanelGrupo({ grupo, onClose }: { grupo: GrupoMarketing | null; onClose: () => void }) {
  if (!grupo) return null;
  const { principal } = grupo;
  const archivo = archivoDelGrupo(grupo);
  const varias = grupo.piezas.length > 1;
  const conResultados = grupo.piezas.map((pieza) => ({ pieza, metricas: metricasOrdenadas(pieza) })).filter((fila) => fila.metricas.length > 0);
  const grupos = grupo.plan ? gruposDelPlan(principal.target) : [];
  const enlaceUnico = !varias ? principal.external_url : null;
  const portada = archivo ? portadaDelVideo(archivo.pieza.metrics) : undefined;

  return (
    <SlideOver
      open
      onClose={onClose}
      title={grupo.title}
      description={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <IconosCanal grupo={grupo} size={14} />
          {canalesLargos(grupo) === ETIQUETA_FORMATO[grupo.format] ? canalesLargos(grupo) : `${canalesLargos(grupo)} · ${ETIQUETA_FORMATO[grupo.format]}`}
          {grupo.plan && <SelloPlan className="ml-1" />}
        </span>
      }
      footer={
        archivo?.pieza.asset_url || enlaceUnico ? (
          <>
            {archivo?.pieza.asset_url && (
              <a
                href={archivo.pieza.asset_url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses({ variant: enlaceUnico ? "secondary" : "primary" })}
              >
                <FileImage size={15} aria-hidden="true" />
                Abrir archivo
              </a>
            )}
            {enlaceUnico && (
              <a href={enlaceUnico} target="_blank" rel="noopener noreferrer" className={buttonClasses()}>
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
          <Badge tone={ETIQUETA_ESTADO_MARKETING[grupo.estado].tone} className="text-[13px]">
            {etiquetaEstado(grupo)}
          </Badge>
          <p className="text-sm text-foreground">
            {momentoDeLaPieza(principal)}
            {grupo.ends_at && <> · hasta el {fechaHora.format(new Date(grupo.ends_at))}</>}
          </p>
          {grupo.plan && (
            <p className="text-sm text-muted-foreground">
              Espacio reservado en el plan. La pieza con su texto y su archivo llega cuando el agente la prepare.
            </p>
          )}
        </section>

        {archivo?.tipo === "imagen" && archivo.pieza.asset_url && (
          // eslint-disable-next-line @next/next/no-img-element -- URLs de terceros sin dominio fijo para next/image
          <img
            src={archivo.pieza.asset_url}
            alt={grupo.title}
            loading="lazy"
            decoding="async"
            className="aspect-square max-h-96 w-full rounded-lg border border-border bg-surface-muted object-contain"
          />
        )}
        {archivo?.tipo === "video" && archivo.pieza.asset_url && (
          <video
            src={archivo.pieza.asset_url}
            poster={portada}
            controls
            playsInline
            preload="metadata"
            aria-label={`Video de «${grupo.title}»`}
            className="h-[min(28rem,60vh)] w-full rounded-lg border border-border bg-black object-contain"
          />
        )}

        {grupo.plan && grupos.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-[13px] font-semibold text-foreground">{grupos.length === 1 ? "Grupo" : `Grupos (${grupos.length})`}</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground marker:text-muted-foreground">
              {grupos.map((nombre) => (
                <li key={nombre}>{nombre}</li>
              ))}
            </ul>
          </section>
        )}

        {varias && (
          <section className="space-y-2">
            <h3 className="text-[13px] font-semibold text-foreground">Dónde sale</h3>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {grupo.piezas.map((pieza) => {
                const estado = ETIQUETA_ESTADO_MARKETING[pieza.status];
                return (
                  <li key={pieza.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <BaldosaCanal canal={pieza.channel} className="size-8" iconSize={15} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{CANAL_INFO[pieza.channel].label}</p>
                      <p className="text-xs text-muted-foreground">{momentoDeLaPieza(pieza)}</p>
                    </div>
                    <Badge tone={estado.tone}>{estado.label}</Badge>
                    {pieza.external_url && (
                      <a
                        href={pieza.external_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Ver la publicación en ${CANAL_INFO[pieza.channel].label}`}
                        className={buttonClasses({ variant: "secondary", size: "sm", className: "h-11 md:h-8" })}
                      >
                        <ExternalLink size={14} aria-hidden="true" />
                        Ver
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {principal.body && (
          <section className="space-y-2">
            <h3 className="text-[13px] font-semibold text-foreground">Texto</h3>
            <p className="whitespace-pre-line rounded-lg bg-surface-muted/60 px-3 py-2.5 text-sm leading-relaxed text-foreground">{principal.body}</p>
          </section>
        )}

        <section className="space-y-1">
          <h3 className="text-[13px] font-semibold text-foreground">Ficha</h3>
          <dl className="divide-y divide-border">
            <Dato etiqueta="Campaña" valor={principal.campaign} />
            <Dato etiqueta="Producto" valor={principal.product ? ETIQUETA_PRODUCTO[principal.product] : null} />
            {!grupo.plan && <Dato etiqueta="Público o grupo" valor={principal.target} />}
            <Dato etiqueta="Agente" valor={principal.agent} />
            <Dato etiqueta="Cargado por" valor={ETIQUETA_ORIGEN[principal.source]} />
            <Dato etiqueta="Actualizado" valor={capitalizar(fechaHora.format(new Date(principal.updated_at)))} />
          </dl>
        </section>

        {!grupo.plan && (
          <section className="space-y-2">
            <h3 className="text-[13px] font-semibold text-foreground">Resultados</h3>
            {conResultados.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {grupo.piezas.some((pieza) => pieza.status === "publicado")
                  ? "Sin resultados todavía. Aparecen cuando Meta o Atlas Lead los reportan."
                  : "Los resultados aparecen cuando la pieza se publique."}
              </p>
            ) : varias ? (
              <div className="space-y-3">
                {conResultados.map(({ pieza, metricas }) => (
                  <div key={pieza.id} className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">{CANAL_INFO[pieza.channel].label}</p>
                    <Metricas metricas={metricas} />
                  </div>
                ))}
              </div>
            ) : (
              <Metricas metricas={conResultados[0].metricas} />
            )}
          </section>
        )}
      </div>
    </SlideOver>
  );
}

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------

export function CalendarioMarketing({
  piezas,
  rango,
  hoy,
  ahora,
  filtros,
}: {
  piezas: PiezaMarketing[];
  rango: RangoCalendario;
  hoy: string;
  /** Instante del servidor (ISO): decide qué ya pasó sin desfase entre servidor y navegador. */
  ahora: string;
  filtros: FiltrosMarketing;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const grupos = useMemo(() => agruparPublicaciones(piezas), [piezas]);
  const porDia = useMemo(() => agruparPorDia(grupos, rango.dias), [grupos, rango.dias]);
  const seleccionado = abierta ? grupos.find((grupo) => grupo.id === abierta) ?? null : null;
  const instante = Date.parse(ahora);

  return (
    <>
      {rango.vista === "proximos" ? (
        <VistaProximos grupos={grupos} rango={rango} hoy={hoy} ahora={instante} onAbrir={setAbierta} />
      ) : rango.vista === "semana" ? (
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
                  {lista.map((grupo) => (
                    <FichaGrupo key={grupo.id} grupo={grupo} dia={dia} onAbrir={setAbierta} />
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
                    {lista.slice(0, MAX_EN_CELDA).map((grupo) => (
                      <FichaGrupo key={grupo.id} grupo={grupo} dia={dia} compacta onAbrir={setAbierta} />
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

      <PanelGrupo grupo={seleccionado} onClose={() => setAbierta(null)} />
    </>
  );
}
