"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, FileSpreadsheet, Minus, X } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { cn } from "@/lib/utils";
import { descargarHoja, type FilaExcel, type FormatoColumna } from "@/lib/reporte-clinica-excel";

/*
 * Piezas del tablero de la clínica. Reglas que siguen todas:
 *  - Una serie, un color: el acento de la edición. El período anterior va en
 *    gris, nunca en otro color que compita.
 *  - Los textos van en tinta, no en el color de la serie.
 *  - Todo lo que se ve como barra es un botón: filtra el tablero.
 */

export const clp = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const clpCorto = new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 });
export const entero = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });

export function formatoClpCorto(valor: number): string {
  return `$${clpCorto.format(valor)}`;
}

export function formatoPct(valor: number | null, decimales = 0): string {
  if (valor === null || Number.isNaN(valor)) return "—";
  return `${valor.toLocaleString("es-CL", { maximumFractionDigits: decimales, minimumFractionDigits: decimales })}%`;
}

export type Formato = "clp" | "int" | "pct";

export function formatear(valor: number | null, formato: Formato): string {
  if (valor === null) return "—";
  if (formato === "clp") return clp.format(valor);
  if (formato === "pct") return formatoPct(valor);
  return entero.format(valor);
}

// ---------------------------------------------------------------------------
// Contenedor
// ---------------------------------------------------------------------------

export function Panel({
  titulo,
  descripcion,
  acciones,
  exportar,
  className,
  children,
}: {
  titulo: ReactNode;
  descripcion?: ReactNode;
  acciones?: ReactNode;
  exportar?: { nombre: string; filas: FilaExcel[]; formatos?: Record<string, FormatoColumna> };
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border border-border bg-surface shadow-sm", className)}>
      <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-3.5">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-foreground">{titulo}</h3>
          {descripcion && <p className="mt-0.5 text-xs text-muted-foreground">{descripcion}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {acciones}
          {exportar && <BotonHoja {...exportar} />}
        </div>
      </header>
      <div className="min-w-0 flex-1 px-4 pb-4">{children}</div>
    </section>
  );
}

export function BotonHoja({ nombre, filas, formatos }: { nombre: string; filas: FilaExcel[]; formatos?: Record<string, FormatoColumna> }) {
  return (
    <button
      type="button"
      onClick={() => void descargarHoja(nombre, filas, formatos)}
      className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={`Descargar «${nombre}» en Excel`}
      aria-label={`Descargar ${nombre} en Excel`}
    >
      <FileSpreadsheet className="size-3.5" aria-hidden="true" />
      XLSX
    </button>
  );
}

export function Vacio({ children = "Sin datos para este período y estos filtros." }: { children?: ReactNode }) {
  return <p className="flex min-h-24 items-center justify-center rounded-lg bg-surface-muted/50 px-4 py-6 text-center text-xs text-muted-foreground">{children}</p>;
}

// ---------------------------------------------------------------------------
// Variación
// ---------------------------------------------------------------------------

/** `inverso`: subir es malo (no asistencias, por cobrar). */
export function Delta({ valor, inverso = false, className }: { valor: number | null; inverso?: boolean; className?: string }) {
  if (valor === null) {
    return <span className={cn("text-[11px] text-muted-foreground", className)}>sin base</span>;
  }
  const plano = Math.abs(valor) < 0.5;
  const bueno = inverso ? valor < 0 : valor > 0;
  const Icono = plano ? Minus : valor > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
        plano ? "bg-surface-muted text-muted-foreground" : bueno ? "bg-success-bg text-success" : "bg-danger-bg text-danger",
        className,
      )}
    >
      <Icono className="size-3" aria-hidden="true" />
      {plano ? "0%" : `${valor > 0 ? "+" : ""}${valor.toLocaleString("es-CL", { maximumFractionDigits: Math.abs(valor) < 10 ? 1 : 0 })}%`}
      <span className="sr-only">{bueno ? " mejor" : " peor"} que el período anterior</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------

function Sparkline({ puntos }: { puntos: number[] }) {
  if (puntos.length < 2) return null;
  const ancho = 120;
  const alto = 32;
  const max = Math.max(...puntos);
  const min = Math.min(0, ...puntos);
  const rango = max - min || 1;
  const coords = puntos.map((valor, i) => [(i / (puntos.length - 1)) * ancho, alto - 2 - ((valor - min) / rango) * (alto - 4)] as const);
  const linea = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${linea} L${ancho},${alto} L0,${alto} Z`;
  const [ux, uy] = coords[coords.length - 1];
  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} className="h-8 w-full" preserveAspectRatio="none" aria-hidden="true">
      <path d={area} fill="var(--primary)" opacity={0.1} />
      <path d={linea} fill="none" stroke="var(--primary)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={ux} cy={uy} r={2.5} fill="var(--primary)" />
    </svg>
  );
}

export function Kpi({
  etiqueta,
  valor,
  anterior,
  delta,
  inverso,
  puntos,
  detalle,
  destacado = false,
}: {
  etiqueta: string;
  valor: string;
  anterior?: string;
  delta?: number | null;
  inverso?: boolean;
  puntos?: number[];
  detalle?: string;
  destacado?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col justify-between rounded-xl border border-border bg-surface px-4 pt-3 shadow-sm", puntos ? "pb-2" : "pb-3")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{etiqueta}</p>
        {delta !== undefined && <Delta valor={delta} inverso={inverso} />}
      </div>
      <p className={cn("mt-1 truncate font-semibold tabular-nums tracking-tight text-foreground", destacado ? "text-[28px] leading-9" : "text-xl")}>{valor}</p>
      {(anterior || detalle) && (
        <p className="truncate text-[11px] text-muted-foreground">
          {anterior && <>Antes: <span className="tabular-nums">{anterior}</span></>}
          {anterior && detalle && " · "}
          {detalle}
        </p>
      )}
      {puntos && <div className="mt-1.5"><Sparkline puntos={puntos} /></div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barras rankeadas (la pieza que más se usa: todo lo que es "por X")
// ---------------------------------------------------------------------------

export type ItemBarra = { clave: string; valor: number; anterior?: number; detalle?: string };

export function BarrasRanking({
  items,
  formato,
  activo,
  onElegir,
  maximo = 8,
  mostrarVariacion = true,
  inverso = false,
}: {
  items: ItemBarra[];
  formato: Formato;
  activo?: string;
  onElegir?: (clave: string) => void;
  maximo?: number;
  mostrarVariacion?: boolean;
  inverso?: boolean;
}) {
  const [todos, setTodos] = useState(false);
  // Un grupo que solo existía en el período anterior no ocupa una fila en cero.
  items = items.filter((i) => i.valor > 0);
  const total = items.reduce((s, i) => s + i.valor, 0);
  const visibles = todos ? items : items.slice(0, maximo);
  const tope = Math.max(...items.map((i) => i.valor), 0) || 1;
  if (items.length === 0 || total === 0) return <Vacio />;
  return (
    <div>
      <ul className="space-y-1">
        {visibles.map((item) => {
          const elegido = activo === item.clave;
          const atenuado = activo !== undefined && !elegido;
          const cambio = item.anterior === undefined ? undefined : item.anterior === 0 ? (item.valor === 0 ? 0 : null) : ((item.valor - item.anterior) / item.anterior) * 100;
          return (
            <li key={item.clave}>
              <button
                type="button"
                disabled={!onElegir}
                onClick={() => onElegir?.(item.clave)}
                aria-pressed={elegido}
                title={onElegir ? (elegido ? "Quitar filtro" : `Filtrar por ${item.clave}`) : undefined}
                className={cn(
                  "group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5 text-left transition",
                  onElegir && "hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  elegido && "bg-surface-muted ring-1 ring-primary/40",
                  atenuado && "opacity-45 hover:opacity-100",
                )}
              >
                <span className="truncate text-xs text-foreground">
                  {item.clave}
                  {item.detalle && <span className="ml-1.5 text-muted-foreground">{item.detalle}</span>}
                </span>
                <span className="flex items-center gap-2 text-xs tabular-nums text-foreground">
                  {formatear(item.valor, formato)}
                  <span className="w-9 text-right text-[11px] text-muted-foreground">{Math.round((item.valor / total) * 100)}%</span>
                  {mostrarVariacion && cambio !== undefined && <Delta valor={cambio} inverso={inverso} className="w-14 justify-end" />}
                </span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                  <span
                    className="block h-full rounded-full bg-primary transition-[width] duration-500"
                    style={{ width: `${Math.max(1.5, (item.valor / tope) * 100)}%` }}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {items.length > maximo && (
        <button
          type="button"
          onClick={() => setTodos((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          {todos ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          {todos ? "Ver menos" : `Ver los ${items.length}`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tendencia: este período contra el anterior, en el mismo eje y la misma medida
// ---------------------------------------------------------------------------

export type PuntoTendencia = { etiqueta: string; valor: number; anterior: number | null };

function TooltipTendencia({ active, payload, formato, contra }: { active?: boolean; payload?: { payload: PuntoTendencia }[]; formato: Formato; contra: string }) {
  if (!active || !payload?.length) return null;
  const punto = payload[0].payload;
  const cambio = punto.anterior ? ((punto.valor - punto.anterior) / punto.anterior) * 100 : null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">{punto.etiqueta}</p>
      <p className="flex items-center gap-2 text-foreground">
        <span className="size-2 rounded-full bg-primary" /> Este período <span className="ml-auto pl-3 tabular-nums">{formatear(punto.valor, formato)}</span>
      </p>
      {punto.anterior !== null && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <span className="size-2 rounded-full bg-muted-foreground/60" /> {contra} <span className="ml-auto pl-3 tabular-nums">{formatear(punto.anterior, formato)}</span>
        </p>
      )}
      {cambio !== null && <p className="mt-1 text-right"><Delta valor={cambio} /></p>}
    </div>
  );
}

export function Tendencia({ puntos, formato, comparar = true, alto = 240, contra = "Período anterior" }: { puntos: PuntoTendencia[]; formato: Formato; comparar?: boolean; alto?: number; contra?: string }) {
  if (puntos.every((p) => p.valor === 0 && !p.anterior)) return <Vacio />;
  const eje = (valor: number) => (formato === "clp" ? formatoClpCorto(valor) : formato === "pct" ? `${valor}%` : entero.format(valor));
  return (
    <div style={{ height: alto }} className="-ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={puntos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="relleno-tendencia" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.7} />
          <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} minTickGap={18} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={eje} width={56} />
          <Tooltip content={<TooltipTendencia formato={formato} contra={contra} />} cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.4 }} />
          {comparar && (
            <Line type="monotone" dataKey="anterior" stroke="var(--muted-foreground)" strokeOpacity={0.55} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
          )}
          <Area type="monotone" dataKey="valor" stroke="var(--primary)" strokeWidth={2} fill="url(#relleno-tendencia)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LeyendaTendencia({ comparar, contra = "Período anterior" }: { comparar: boolean; contra?: string }) {
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-primary" /> Este período</span>
      {comparar && <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-muted-foreground/60" /> {contra}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mapa de calor día × hora
// ---------------------------------------------------------------------------

export function MapaCalor({
  filas,
  columnas,
  celdas,
  maximo,
  activaFila,
  onElegirFila,
  unidad = "citas",
  formato = (n: number) => entero.format(n),
  etiquetaColumna = (c: string) => `${c}:00`,
}: {
  filas: readonly string[];
  columnas: string[];
  celdas: number[][];
  maximo: number;
  activaFila?: string;
  onElegirFila?: (fila: string) => void;
  unidad?: string;
  formato?: (n: number) => string;
  etiquetaColumna?: (c: string) => string;
}) {
  if (maximo === 0) return <Vacio />;
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid min-w-full gap-[3px]" style={{ gridTemplateColumns: `minmax(2.75rem, max-content) repeat(${columnas.length}, minmax(${columnas.some((c) => c.length > 3) ? "4.5rem" : "1.6rem"}, 1fr))` }}>
        <span />
        {columnas.map((c) => (
          <span key={c} className="truncate pb-1 text-center text-[10px] tabular-nums text-muted-foreground" title={c}>{c}</span>
        ))}
        {filas.map((fila, i) => (
          <FilaCalor key={fila} fila={fila} valores={celdas[i]} columnas={columnas} maximo={maximo} activa={activaFila === fila} atenuada={activaFila !== undefined && activaFila !== fila} onElegir={onElegirFila} unidad={unidad} formato={formato} etiquetaColumna={etiquetaColumna} />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
        Menos
        {[0.08, 0.3, 0.55, 0.8, 1].map((n) => (
          <span key={n} className="size-3 rounded-[3px]" style={{ background: `color-mix(in oklab, var(--primary) ${Math.round(n * 100)}%, var(--surface))` }} />
        ))}
        Más
      </div>
    </div>
  );
}

function FilaCalor({ fila, valores, columnas, maximo, activa, atenuada, onElegir, unidad, formato, etiquetaColumna }: { fila: string; valores: number[]; columnas: string[]; maximo: number; activa: boolean; atenuada: boolean; onElegir?: (fila: string) => void; unidad: string; formato: (n: number) => string; etiquetaColumna: (c: string) => string }) {
  return (
    <>
      <button
        type="button"
        onClick={() => onElegir?.(fila)}
        disabled={!onElegir}
        aria-pressed={activa}
        className={cn("truncate pr-2 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground", activa && "text-foreground underline decoration-primary decoration-2 underline-offset-4")}
      >
        {fila}
      </button>
      {valores.map((valor, j) => (
        <span
          key={j}
          title={`${fila} · ${etiquetaColumna(columnas[j])} · ${formato(valor)} ${unidad}`}
          className={cn("flex h-7 items-center justify-center rounded-[4px] text-[10px] tabular-nums transition-opacity", atenuada && "opacity-35")}
          style={{
            background: valor === 0 ? "var(--surface-muted)" : `color-mix(in oklab, var(--primary) ${Math.round(12 + (valor / maximo) * 88)}%, var(--surface))`,
            color: valor / maximo > 0.55 ? "var(--primary-foreground)" : "var(--muted-foreground)",
          }}
        >
          {valor > 0 ? formato(valor) : ""}
        </span>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Barras apiladas de estado (una fila por profesional)
// ---------------------------------------------------------------------------

export type SegmentoEstado = { clave: string; etiqueta: string; color: string };

export function BarrasEstado({
  filas,
  segmentos,
  activo,
  onElegir,
}: {
  filas: { clave: string; valores: Record<string, number> }[];
  segmentos: SegmentoEstado[];
  activo?: string;
  onElegir?: (clave: string) => void;
}) {
  if (filas.length === 0) return <Vacio />;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1">
        {segmentos.map((s) => (
          <span key={s.clave} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} /> {s.etiqueta}
          </span>
        ))}
      </div>
      <ul className="space-y-2.5">
        {filas.map((fila) => {
          const total = segmentos.reduce((s, seg) => s + (fila.valores[seg.clave] ?? 0), 0);
          return (
            <li key={fila.clave}>
              <button
                type="button"
                onClick={() => onElegir?.(fila.clave)}
                disabled={!onElegir}
                aria-pressed={activo === fila.clave}
                className={cn("w-full rounded-md px-2 py-1 text-left transition hover:bg-surface-muted", activo === fila.clave && "bg-surface-muted ring-1 ring-primary/40", activo !== undefined && activo !== fila.clave && "opacity-45")}
              >
                <span className="mb-1 flex justify-between text-xs">
                  <span className="truncate text-foreground">{fila.clave}</span>
                  <span className="tabular-nums text-muted-foreground">{entero.format(total)}</span>
                </span>
                <span className="flex h-3 gap-[2px] overflow-hidden rounded-[4px]">
                  {segmentos.map((seg) => {
                    const v = fila.valores[seg.clave] ?? 0;
                    if (!v) return null;
                    return <span key={seg.clave} title={`${seg.etiqueta}: ${v}`} style={{ width: `${(v / total) * 100}%`, background: seg.color }} />;
                  })}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Embudo
// ---------------------------------------------------------------------------

export function Embudo({ pasos }: { pasos: { etiqueta: string; cantidad: number; valor: number }[] }) {
  const tope = Math.max(...pasos.map((p) => p.cantidad), 0) || 1;
  if (pasos[0]?.cantidad === 0) return <Vacio />;
  return (
    <ol className="space-y-2">
      {pasos.map((paso, i) => {
        const conversion = i > 0 && pasos[0].cantidad > 0 ? (paso.cantidad / pasos[0].cantidad) * 100 : null;
        return (
          <li key={paso.etiqueta} className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3">
            <span className="text-xs text-muted-foreground">{paso.etiqueta}</span>
            <span className="relative flex h-9 items-center">
              <span
                className="absolute inset-y-0 left-0 rounded-md transition-[width] duration-500"
                style={{ width: `${Math.max(3, (paso.cantidad / tope) * 100)}%`, background: `color-mix(in oklab, var(--primary) ${Math.max(14, 42 - i * 12)}%, var(--surface))` }}
              />
              <span className="relative z-10 flex w-full items-center justify-between px-2.5 text-xs">
                <span className="font-semibold tabular-nums text-foreground">{entero.format(paso.cantidad)}</span>
                <span className="tabular-nums text-muted-foreground">
                  {clp.format(paso.valor)}
                  {conversion !== null && <> · {formatoPct(conversion)}</>}
                </span>
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Tabla con orden y paginación
// ---------------------------------------------------------------------------

export type ColumnaTabla<T> = {
  clave: string;
  titulo: string;
  valor: (fila: T) => string | number | null;
  mostrar?: (fila: T) => ReactNode;
  formato?: Formato;
  alinear?: "derecha";
};

export function Tabla<T>({
  filas,
  columnas,
  porPagina = 12,
  onFila,
  ordenInicial,
}: {
  filas: T[];
  columnas: ColumnaTabla<T>[];
  porPagina?: number;
  onFila?: (fila: T) => void;
  ordenInicial?: { clave: string; desc: boolean };
}) {
  const [orden, setOrden] = useState(ordenInicial ?? null);
  const [pagina, setPagina] = useState(0);
  const ordenadas = useMemo(() => {
    if (!orden) return filas;
    const columna = columnas.find((c) => c.clave === orden.clave);
    if (!columna) return filas;
    return [...filas].sort((a, b) => {
      const va = columna.valor(a);
      const vb = columna.valor(b);
      const r = typeof va === "number" && typeof vb === "number" ? va - vb : String(va ?? "").localeCompare(String(vb ?? ""), "es");
      return orden.desc ? -r : r;
    });
  }, [filas, columnas, orden]);
  const paginas = Math.max(1, Math.ceil(ordenadas.length / porPagina));
  const actual = Math.min(pagina, paginas - 1);
  const visibles = ordenadas.slice(actual * porPagina, actual * porPagina + porPagina);
  if (filas.length === 0) return <Vacio />;
  return (
    <div>
      <div className="-mx-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-y border-border bg-surface-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              {columnas.map((c) => (
                <th key={c.clave} className={cn("whitespace-nowrap px-4 py-2 font-medium", c.alinear === "derecha" && "text-right")}>
                  <button
                    type="button"
                    onClick={() => setOrden((o) => ({ clave: c.clave, desc: o?.clave === c.clave ? !o.desc : true }))}
                    className="inline-flex items-center gap-0.5 uppercase hover:text-foreground"
                  >
                    {c.titulo}
                    {orden?.clave === c.clave && (orden.desc ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibles.map((fila, i) => (
              <tr key={i} onClick={onFila ? () => onFila(fila) : undefined} className={cn(onFila && "cursor-pointer hover:bg-surface-muted/60")}>
                {columnas.map((c) => (
                  <td key={c.clave} className={cn("whitespace-nowrap px-4 py-2 text-foreground", c.alinear === "derecha" && "text-right tabular-nums")}>
                    {c.mostrar ? c.mostrar(fila) : c.formato ? formatear(c.valor(fila) as number | null, c.formato) : c.valor(fila) ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paginas > 1 && (
        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {actual * porPagina + 1}–{Math.min(ordenadas.length, (actual + 1) * porPagina)} de {entero.format(ordenadas.length)}
          </span>
          <span className="flex gap-1">
            <button type="button" disabled={actual === 0} onClick={() => setPagina(actual - 1)} className="rounded-md border border-border px-2 py-0.5 hover:bg-surface-muted disabled:opacity-40">Anterior</button>
            <button type="button" disabled={actual >= paginas - 1} onClick={() => setPagina(actual + 1)} className="rounded-md border border-border px-2 py-0.5 hover:bg-surface-muted disabled:opacity-40">Siguiente</button>
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chip de filtro activo
// ---------------------------------------------------------------------------

export function ChipFiltro({ etiqueta, valor, onQuitar }: { etiqueta: string; valor: string; onQuitar: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-surface-muted py-0.5 pl-2.5 pr-1 text-[11px] text-foreground">
      <span className="text-muted-foreground">{etiqueta}:</span> {valor}
      <button type="button" onClick={onQuitar} className="rounded-full p-0.5 text-muted-foreground hover:bg-surface hover:text-foreground" aria-label={`Quitar filtro ${etiqueta}`}>
        <X className="size-3" />
      </button>
    </span>
  );
}
