"use client";

import Link from "next/link";
import { Suspense, useCallback, useMemo, useState, useTransition } from "react";
import { ChevronRight, Download, Lightbulb, Loader2, SlidersHorizontal, TrendingDown, TrendingUp } from "lucide-react";

import { ReportRangePicker } from "@/components/report-range-picker";
import { CLINIC_PRESETS } from "@/lib/report-range";
import { cn } from "@/lib/utils";
import {
  APLICA,
  DIAS_SEMANA,
  DIMENSIONES,
  ETIQUETA_DIMENSION,
  SIN_DATO,
  agrupar,
  antiguedadSaldos,
  calcularKpis,
  calorAgenda,
  estadoVacunas,
  etiquetaFecha,
  etiquetaOrigen,
  etiquetaTramo,
  filtrarAtenciones,
  filtrarCitas,
  filtrarPagos,
  filtrarPlanes,
  filtrarSaldos,
  granoSugerido,
  hallazgos,
  leerHechos,
  periodoDeComparacion,
  primerasVisitas,
  recurrencia,
  serie,
  suma,
  tramo,
  variacion,
  diasEntre,
  diaSemana,
  type Atencion,
  type Cita,
  type Comparacion,
  type Dimension,
  type Filtros,
  type Grano,
  type Hechos,
  type Kpis,
  type Periodo,
  type Plan,
} from "@/lib/reporte-clinica";
import { descargarLibro, type FilaExcel, type FormatoColumna, type HojaExcel } from "@/lib/reporte-clinica-excel";
import {
  BarrasEstado,
  BarrasRanking,
  ChipFiltro,
  Delta,
  Embudo,
  Kpi,
  LeyendaTendencia,
  MapaCalor,
  Panel,
  Tabla,
  Tendencia,
  Vacio,
  clp,
  entero,
  formatoClpCorto,
  formatoPct,
  type ColumnaTabla,
  type ItemBarra,
  type SegmentoEstado,
} from "./graficos";

/**
 * Tablero de reportes de la clínica, al estilo de una herramienta de BI.
 *
 * Se lee de arriba abajo, de lo general a lo particular: el número del
 * período y cuánto cambió, qué lo explica (categoría, profesional, canal) y,
 * al final, cada atención. Cualquier barra, fila o celda filtra todo el
 * tablero; el filtro se ve como un chip y se quita con un clic. La
 * producción se abre por niveles: categoría → procedimiento → atenciones.
 *
 * El período viene del servidor (la URL); los filtros y la vista viven en el
 * navegador y se escriben en la URL sin recargar, para poder compartir el
 * enlace exacto de lo que se está mirando.
 */

type Edicion = "dental" | "vet";

type Vocabulario = { persona: string; personas: string; plan: string; planes: string; aceptados: string };

const VOCABULARIO: Record<Edicion, Vocabulario> = {
  dental: { persona: "Paciente", personas: "Pacientes", plan: "Presupuesto", planes: "Presupuestos", aceptados: "Aceptados" },
  vet: { persona: "Tutor", personas: "Tutores", plan: "Plan", planes: "Planes", aceptados: "Aceptados" },
};

const VISTAS = ["resumen", "produccion", "profesionales", "agenda", "planes", "pacientes", "caja"] as const;
type Vista = (typeof VISTAS)[number];

const ESTADOS_CITA: SegmentoEstado[] = [
  { clave: "atendida", etiqueta: "Atendida", color: "var(--success)" },
  { clave: "en_sala", etiqueta: "En sala", color: "var(--warning)" },
  { clave: "confirmada", etiqueta: "Confirmada", color: "var(--primary)" },
  { clave: "reservada", etiqueta: "Reservada", color: "color-mix(in oklab, var(--primary) 38%, var(--surface))" },
  { clave: "no_vino", etiqueta: "No vino", color: "var(--danger)" },
  { clave: "cancelada", etiqueta: "Cancelada", color: "color-mix(in oklab, var(--muted-foreground) 45%, var(--surface))" },
];

const ETIQUETA_MEDIO: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
  webpay: "Webpay (en línea)",
  otro: "Otro",
};

function sin(filtros: Filtros, ...dimensiones: Dimension[]): Filtros {
  const copia = { ...filtros };
  for (const d of dimensiones) delete copia[d];
  return copia;
}

function aItems(grupos: { clave: string; valor: number; anterior: number; cantidad: number }[], detalle?: (g: { cantidad: number }) => string): ItemBarra[] {
  return grupos.filter((g) => g.valor > 0).map((g) => ({ clave: g.clave, valor: g.valor, anterior: g.anterior, detalle: detalle?.(g) }));
}

function leerFiltrosDeUrl(parametros: URLSearchParams): Filtros {
  const filtros: Filtros = {};
  for (const d of DIMENSIONES) {
    const valor = parametros.get(`f_${d}`);
    if (valor) filtros[d] = valor;
  }
  return filtros;
}

export function TableroClinica({
  raw,
  periodo,
  hoy,
  edicion,
  empresa,
  etiquetaPeriodo,
  filtrosIniciales,
  vistaInicial,
}: {
  raw: unknown;
  periodo: Periodo;
  hoy: string;
  edicion: Edicion;
  empresa: string | null;
  etiquetaPeriodo: string;
  filtrosIniciales: Record<string, string | undefined>;
  vistaInicial?: string;
}) {
  const voc = VOCABULARIO[edicion];
  const esVet = edicion === "vet";
  const hechos = useMemo(() => leerHechos(raw), [raw]);
  const [comparacion, setComparacion] = useState<Comparacion>("anterior");
  const [comparar, setComparar] = useState(true);
  const previo = useMemo(() => periodoDeComparacion(periodo, comparacion), [periodo, comparacion]);
  const contra = comparacion === "anio" ? "Año pasado" : "Período anterior";
  const dias = diasEntre(periodo.desde, periodo.hasta) + 1;

  const [filtros, setFiltros] = useState<Filtros>(() => leerFiltrosDeUrl(new URLSearchParams(filtrosIniciales as Record<string, string>)));
  const [vista, setVista] = useState<Vista>(() => ((VISTAS as readonly string[]).includes(vistaInicial ?? "") ? (vistaInicial as Vista) : "resumen"));
  const [granoElegido, setGranoElegido] = useState<Grano | null>(null);
  const [pendiente, iniciar] = useTransition();
  const grano = granoElegido ?? granoSugerido(dias);

  const escribirUrl = useCallback((siguientes: Filtros, siguienteVista: Vista) => {
    const parametros = new URLSearchParams(window.location.search);
    for (const d of DIMENSIONES) parametros.delete(`f_${d}`);
    for (const [d, valor] of Object.entries(siguientes)) if (valor !== undefined) parametros.set(`f_${d}`, valor);
    if (siguienteVista === "resumen") parametros.delete("vista");
    else parametros.set("vista", siguienteVista);
    const cadena = parametros.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${cadena ? `?${cadena}` : ""}`);
  }, []);

  const cambiarFiltros = useCallback(
    (siguientes: Filtros) => {
      iniciar(() => setFiltros(siguientes));
      escribirUrl(siguientes, vista);
    },
    [escribirUrl, vista],
  );

  /** Clic en una barra: filtra; clic en la misma barra: quita el filtro. */
  const alternar = useCallback(
    (dimension: Dimension) => (valor: string) => {
      const siguientes = { ...filtros };
      if (siguientes[dimension] === valor) delete siguientes[dimension];
      else siguientes[dimension] = valor;
      // Cambiar de categoría invalida el procedimiento elegido dentro de la anterior.
      if (dimension === "categoria") delete siguientes.procedimiento;
      cambiarFiltros(siguientes);
    },
    [filtros, cambiarFiltros],
  );

  const cambiarVista = (siguiente: Vista) => {
    setVista(siguiente);
    escribirUrl(filtros, siguiente);
  };

  // --- cálculos ---------------------------------------------------------
  const kpis = useMemo(() => calcularKpis(hechos, periodo, filtros, hoy), [hechos, periodo, filtros, hoy]);
  const kpisAntes = useMemo(() => calcularKpis(hechos, previo, filtros, hoy), [hechos, previo, filtros, hoy]);
  const atenciones = useMemo(() => filtrarAtenciones(hechos, periodo, filtros), [hechos, periodo, filtros]);
  const atencionesAntes = useMemo(() => filtrarAtenciones(hechos, previo, filtros), [hechos, previo, filtros]);
  const lectura = useMemo(() => hallazgos(hechos, periodo, filtros, hoy, previo), [hechos, periodo, filtros, hoy, previo]);

  /** Agrupa atenciones sin la dimensión propia: la barra elegida se resalta, no borra a las demás. */
  const porDimension = useCallback(
    (dimension: Dimension, clave: (a: Atencion) => string, valor: (a: Atencion) => number = (a) => a.monto) =>
      agrupar(
        filtrarAtenciones(hechos, periodo, sin(filtros, dimension)),
        filtrarAtenciones(hechos, previo, sin(filtros, dimension)),
        clave,
        valor,
        (a) => a.costo,
      ),
    [hechos, periodo, previo, filtros],
  );

  const serieProduccion = useMemo(
    () => serie(atenciones, atencionesAntes, (a) => a.fecha, (a) => a.monto, periodo, grano, previo).map((p) => ({ ...p, etiqueta: etiquetaTramo(p.tramo, grano) })),
    [atenciones, atencionesAntes, periodo, grano, previo],
  );

  const nombreDe = (cuentaId: string) => hechos.cuentas.get(cuentaId)?.nombre ?? "—";

  const filtrosActivos = (Object.entries(filtros) as [Dimension, string][]).filter(([, v]) => v !== undefined);

  const exportarTodo = () =>
    void descargarLibro(
      `Reporte ${empresa ?? "clinica"} ${periodo.desde} a ${periodo.hasta}`,
      libroCompleto({ hechos, periodo, previo, filtros, hoy, kpis, kpisAntes, grano, voc, esVet, etiquetaPeriodo, empresa }),
    );

  const opciones = useMemo(() => opcionesDeFiltro(hechos, esVet), [hechos, esVet]);

  return (
    <div className="space-y-4">
      {/* Cabecera: período, comparación y descarga */}
      <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Reportes</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            De lo general a lo particular: cuánto produjo la clínica, qué lo explica y el detalle de cada atención. Haz clic en cualquier barra para filtrar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Suspense fallback={null}>
            <ReportRangePicker presets={CLINIC_PRESETS} />
          </Suspense>
          <button
            type="button"
            onClick={exportarTodo}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Download className="size-3.5" aria-hidden="true" /> Descargar Excel
          </button>
        </div>
      </div>

      {/* Segmentadores */}
      <div className="z-20 -mx-1 rounded-xl lg:sticky lg:top-0 border border-border bg-surface/95 px-3 py-2.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 pr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <SlidersHorizontal className="size-3.5" aria-hidden="true" /> Filtros
          </span>
          {opciones.map(({ dimension, valores }) => (
            <select
              key={dimension}
              value={filtros[dimension] ?? ""}
              onChange={(e) => {
                const siguientes = { ...filtros };
                if (e.target.value) siguientes[dimension] = e.target.value;
                else delete siguientes[dimension];
                if (dimension === "categoria") delete siguientes.procedimiento;
                cambiarFiltros(siguientes);
              }}
              aria-label={ETIQUETA_DIMENSION[dimension]}
              className={cn(
                "max-w-44 rounded-md border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filtros[dimension] ? "border-primary/50 ring-1 ring-primary/30" : "border-border",
              )}
            >
              <option value="">{ETIQUETA_DIMENSION[dimension]}: todos</option>
              {valores.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Agrupar por">
            {(["dia", "semana", "mes"] as Grano[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGranoElegido(g)}
                aria-pressed={grano === g}
                className={cn("rounded px-2 py-0.5 text-[11px] font-medium", grano === g ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {g === "dia" ? "Día" : g === "semana" ? "Semana" : "Mes"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Comparar con
            <select
              value={comparar ? comparacion : "ninguna"}
              onChange={(e) => {
                const valor = e.target.value;
                if (valor === "ninguna") setComparar(false);
                else {
                  setComparar(true);
                  iniciar(() => setComparacion(valor as Comparacion));
                }
              }}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="anterior">el período anterior</option>
              <option value="anio">el mismo período del año pasado</option>
              <option value="ninguna">nada (ocultar la línea)</option>
            </select>
          </label>
          {pendiente && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Recalculando" />}
        </div>
        {filtrosActivos.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
            {filtrosActivos.map(([d, v]) => (
              <ChipFiltro key={d} etiqueta={ETIQUETA_DIMENSION[d]} valor={v} onQuitar={() => cambiarFiltros(sin(filtros, d, ...(d === "categoria" ? (["procedimiento"] as Dimension[]) : [])))} />
            ))}
            <button type="button" onClick={() => cambiarFiltros({})} className="px-1.5 text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              Limpiar todo
            </button>
          </div>
        )}
      </div>

      {/* Vistas */}
      <nav aria-label="Vistas del reporte" className="-mb-px flex gap-1 overflow-x-auto border-b border-border">
        {VISTAS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => cambiarVista(v)}
            aria-current={vista === v ? "page" : undefined}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
              vista === v ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {etiquetaVista(v, voc)}
          </button>
        ))}
      </nav>

      <p className="text-[11px] text-muted-foreground">
        {etiquetaPeriodo} · comparado con {etiquetaFecha(previo.desde)} a {etiquetaFecha(previo.hasta)}{comparacion === "anio" ? " (mismo período del año pasado)" : " (período anterior de igual largo)"}
      </p>

      <div className={cn("transition-opacity", pendiente && "opacity-70")}>
        {vista === "resumen" && (
          <VistaResumen
            {...{ hechos, periodo, previo, filtros, hoy, kpis, kpisAntes, grano, comparar, contra, voc, esVet, lectura, serieProduccion, porDimension, alternar, cambiarFiltros }}
          />
        )}
        {vista === "produccion" && (
          <VistaProduccion {...{ hechos, periodo, previo, filtros, grano, comparar, contra, voc, esVet, atenciones, serieProduccion, porDimension, alternar, cambiarFiltros, nombreDe }} />
        )}
        {vista === "profesionales" && <VistaProfesionales {...{ hechos, periodo, previo, filtros, hoy, alternar }} />}
        {vista === "agenda" && <VistaAgenda {...{ hechos, periodo, previo, filtros, hoy, grano, comparar, contra, kpis, kpisAntes, alternar, nombreDe }} />}
        {vista === "planes" && <VistaPlanes {...{ hechos, periodo, previo, filtros, grano, comparar, contra, kpis, kpisAntes, voc, alternar, nombreDe }} />}
        {vista === "pacientes" && <VistaPacientes {...{ hechos, periodo, previo, filtros, hoy, grano, comparar, contra, kpis, kpisAntes, voc, esVet, atenciones, porDimension, alternar }} />}
        {vista === "caja" && <VistaCaja {...{ hechos, periodo, previo, filtros, hoy, grano, comparar, contra, kpis, kpisAntes, voc, atenciones, atencionesAntes, alternar, nombreDe }} />}
      </div>
    </div>
  );
}

function etiquetaVista(v: Vista, voc: Vocabulario): string {
  switch (v) {
    case "resumen": return "Resumen";
    case "produccion": return "Producción";
    case "profesionales": return "Profesionales";
    case "agenda": return "Agenda";
    case "planes": return voc.planes;
    case "pacientes": return voc.personas;
    case "caja": return "Caja";
  }
}

function opcionesDeFiltro(hechos: Hechos, esVet: boolean): { dimension: Dimension; valores: string[] }[] {
  const unicos = (valores: (string | null | undefined)[]) => [...new Set(valores.map((v) => v ?? SIN_DATO))].sort((a, b) => a.localeCompare(b, "es"));
  const cuentas = [...hechos.cuentas.values()];
  const salida: { dimension: Dimension; valores: string[] }[] = [
    { dimension: "profesional", valores: unicos([...hechos.atenciones.map((a) => a.profesional), ...hechos.citas.map((c) => c.profesional)]) },
    { dimension: "categoria", valores: unicos(hechos.atenciones.map((a) => a.categoria)) },
    { dimension: "origen", valores: unicos([...cuentas.map((c) => etiquetaOrigen(c.origen)), ...hechos.planes.map((p) => etiquetaOrigen(p.origen))]) },
    { dimension: "comuna", valores: unicos(cuentas.map((c) => c.comuna)) },
  ];
  if (esVet) salida.push({ dimension: "especie", valores: unicos(hechos.atenciones.map((a) => a.especie)) });
  salida.push({ dimension: "dia", valores: [...DIAS_SEMANA] });
  return salida;
}

// ---------------------------------------------------------------------------
// Props compartidas
// ---------------------------------------------------------------------------

type Base = {
  hechos: Hechos;
  periodo: Periodo;
  previo: Periodo;
  filtros: Filtros;
  alternar: (d: Dimension) => (valor: string) => void;
};

type PorDimension = (dimension: Dimension, clave: (a: Atencion) => string, valor?: (a: Atencion) => number) => ReturnType<typeof agrupar<Atencion>>;

/** "sin filtro de Categoría": el indicador no se puede cortar por esa dimensión. */
function ignora(filtros: Filtros, conjunto: keyof typeof APLICA): string | null {
  const ignorados = (Object.keys(filtros) as Dimension[]).filter((d) => filtros[d] !== undefined && !APLICA[conjunto].includes(d));
  return ignorados.length ? `no se corta por ${ignorados.map((d) => ETIQUETA_DIMENSION[d].toLowerCase()).join(" ni ")}` : null;
}

/** Un filtro que no corresponde a estos datos se ignora; se dice, para que nadie lea mal el número. */
function AvisoNoAplica({ filtros, conjunto, nombre }: { filtros: Filtros; conjunto: keyof typeof APLICA; nombre: string }) {
  const ignorados = (Object.keys(filtros) as Dimension[]).filter((d) => filtros[d] !== undefined && !APLICA[conjunto].includes(d));
  if (ignorados.length === 0) return null;
  return (
    <p className="rounded-lg border border-border bg-surface-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
      {ignorados.map((d) => ETIQUETA_DIMENSION[d]).join(" y ")} no {ignorados.length === 1 ? "aplica" : "aplican"} a {nombre}: en esta vista se {ignorados.length === 1 ? "ignora" : "ignoran"}.
    </p>
  );
}

const ORDEN_DIAS = (g: { clave: string }) => DIAS_SEMANA.indexOf(g.clave as (typeof DIAS_SEMANA)[number]);

// ---------------------------------------------------------------------------
// Resumen: el nivel más general
// ---------------------------------------------------------------------------

function VistaResumen({
  hechos, periodo, filtros, kpis, kpisAntes, grano, comparar, contra, voc, esVet, lectura, serieProduccion, porDimension, alternar, cambiarFiltros,
}: Base & {
  hoy: string; kpis: Kpis; kpisAntes: Kpis; grano: Grano; comparar: boolean; contra: string; voc: Vocabulario; esVet: boolean;
  lectura: ReturnType<typeof hallazgos>;
  serieProduccion: { etiqueta: string; valor: number; anterior: number | null }[];
  porDimension: PorDimension;
  alternar: Base["alternar"];
  cambiarFiltros: (f: Filtros) => void;
}) {
  const chispa = (valor: (a: Atencion) => number) => serie(filtrarAtenciones(hechos, periodo, filtros), [], (a) => a.fecha, valor, periodo, grano).map((p) => p.valor);
  const pacientesPorTramo = useMemo(() => {
    const conjuntos = new Map<string, Set<string>>();
    for (const a of filtrarAtenciones(hechos, periodo, filtros)) {
      const t = tramo(a.fecha, grano);
      const c = conjuntos.get(t) ?? new Set<string>();
      c.add(a.cuentaId);
      conjuntos.set(t, c);
    }
    return serie<Atencion>([], [], (a) => a.fecha, () => 0, periodo, grano).map((p) => conjuntos.get(p.tramo)?.size ?? 0);
  }, [hechos, periodo, filtros, grano]);

  const categorias = porDimension("categoria", (a) => a.categoria);
  const profesionales = porDimension("profesional", (a) => a.profesional);
  const canales = porDimension("origen", (a) => etiquetaOrigen(hechos.cuentas.get(a.cuentaId)?.origen));
  const porDia = porDimension("dia", (a) => DIAS_SEMANA[diaSemana(a.fecha)]).sort((a, b) => ORDEN_DIAS(a) - ORDEN_DIAS(b));
  const citas = filtrarCitas(hechos, periodo, filtros);
  const calor = calorAgenda(citas);
  const saldoTotal = suma(filtrarSaldos(hechos, filtros), (s) => s.monto);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi destacado etiqueta="Producción" valor={clp.format(kpis.produccion)} anterior={clp.format(kpisAntes.produccion)} delta={variacion(kpis.produccion, kpisAntes.produccion)} puntos={chispa((a) => a.monto)} />
        <Kpi destacado etiqueta="Atenciones" valor={entero.format(kpis.atenciones)} anterior={entero.format(kpisAntes.atenciones)} delta={variacion(kpis.atenciones, kpisAntes.atenciones)} puntos={chispa(() => 1)} />
        <Kpi destacado etiqueta="Ticket por visita" valor={kpis.ticket === null ? "—" : clp.format(kpis.ticket)} anterior={kpisAntes.ticket === null ? "—" : clp.format(kpisAntes.ticket)} delta={variacion(kpis.ticket, kpisAntes.ticket)} detalle={`${entero.format(kpis.visitas)} visitas`} />
        <Kpi destacado etiqueta={`${voc.personas} atendidos`} valor={entero.format(kpis.pacientes)} anterior={entero.format(kpisAntes.pacientes)} delta={variacion(kpis.pacientes, kpisAntes.pacientes)} puntos={pacientesPorTramo} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi etiqueta="Margen" valor={formatoPct(kpis.margenPct)} delta={variacion(kpis.margenPct, kpisAntes.margenPct)} detalle={`${formatoClpCorto(kpis.margen)} sobre materiales`} />
        <Kpi etiqueta="Cobrado" valor={formatoPct(kpis.cobradoPct)} delta={variacion(kpis.cobradoPct, kpisAntes.cobradoPct)} detalle="de lo producido" />
        <Kpi etiqueta="Primera visita" valor={entero.format(kpis.nuevos)} delta={variacion(kpis.nuevos, kpisAntes.nuevos)} detalle={`${voc.personas.toLowerCase()} nuevos`} />
        <Kpi etiqueta="Asistencia" valor={formatoPct(kpis.asistenciaPct)} delta={variacion(kpis.asistenciaPct, kpisAntes.asistenciaPct)} detalle={ignora(filtros, "citas") ?? `${kpis.noVino} no vinieron`} />
        <Kpi etiqueta="Aceptación" valor={formatoPct(kpis.conversionPct)} delta={variacion(kpis.conversionPct, kpisAntes.conversionPct)} detalle={ignora(filtros, "planes") ?? `${kpis.planesGanados} de ${kpis.planesCreados}`} />
        <Kpi etiqueta="Por cobrar hoy" valor={formatoClpCorto(saldoTotal)} detalle={ignora(filtros, "saldos") ?? "saldo total, toda la historia"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel titulo="Lectura del período" descripcion="Lo que explica el número, en orden. Haz clic para bajar al detalle." className="xl:col-span-1">
          <ul className="space-y-2.5">
            {lectura.map((h, i) => {
              const Icono = h.tono === "positivo" ? TrendingUp : h.tono === "negativo" ? TrendingDown : Lightbulb;
              const contenido = (
                <>
                  <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", h.tono === "positivo" ? "bg-success-bg text-success" : h.tono === "negativo" ? "bg-danger-bg text-danger" : "bg-surface-muted text-muted-foreground")}>
                    <Icono className="size-3.5" aria-hidden="true" />
                  </span>
                  <span className="text-xs leading-5 text-foreground">{h.texto}</span>
                  {h.filtro && <ChevronRight className="ml-auto mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                </>
              );
              return (
                <li key={i}>
                  {h.filtro ? (
                    <button type="button" onClick={() => cambiarFiltros({ ...filtros, [h.filtro!.dimension]: h.filtro!.valor })} className="flex w-full gap-2.5 rounded-lg p-1.5 text-left hover:bg-surface-muted">
                      {contenido}
                    </button>
                  ) : (
                    <div className="flex gap-2.5 p-1.5">{contenido}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel
          titulo="Producción en el tiempo"
          descripcion={`Por ${grano === "dia" ? "día" : grano}; la línea gris es ${contra === "Año pasado" ? "el mismo período del año pasado" : "el período anterior"}, alineado.`}
          acciones={<LeyendaTendencia comparar={comparar} contra={contra} />}
          exportar={{ nombre: "Producción en el tiempo", filas: serieProduccion.map((p) => ({ Tramo: p.etiqueta, Producción: p.valor, "Período anterior": p.anterior })), formatos: { Producción: "clp", "Período anterior": "clp" } }}
          className="xl:col-span-2"
        >
          <Tendencia puntos={serieProduccion} formato="clp" comparar={comparar} contra={contra} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel titulo="Por categoría" descripcion="Producción y variación" exportar={exportarGrupos("Por categoría", "Categoría", categorias)}>
          <BarrasRanking items={aItems(categorias)} formato="clp" activo={filtros.categoria} onElegir={alternar("categoria")} />
        </Panel>
        <Panel titulo="Por profesional" descripcion="Producción y variación" exportar={exportarGrupos("Por profesional", "Profesional", profesionales)}>
          <BarrasRanking items={aItems(profesionales, (g) => `${g.cantidad} at.`)} formato="clp" activo={filtros.profesional} onElegir={alternar("profesional")} />
        </Panel>
        <Panel titulo="Por canal de origen" descripcion={`Cómo llegó cada ${voc.persona.toLowerCase()} que se atendió`} exportar={exportarGrupos("Por canal", "Canal", canales)}>
          <BarrasRanking items={aItems(canales)} formato="clp" activo={filtros.origen} onElegir={alternar("origen")} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel titulo="Carga de la agenda" descripcion="Citas por día y hora (sin canceladas)" className="lg:col-span-2">
          <MapaCalor filas={DIAS_SEMANA} columnas={calor.horas.map(String)} celdas={calor.celdas} maximo={calor.maximo} activaFila={filtros.dia} onElegirFila={alternar("dia")} />
        </Panel>
        <Panel titulo="Por día de la semana" descripcion="Producción">
          <BarrasRanking items={aItems(porDia)} formato="clp" activo={filtros.dia} onElegir={alternar("dia")} maximo={7} />
        </Panel>
      </div>
      {esVet && kpis.urgencias > 0 && <p className="text-[11px] text-muted-foreground">{kpis.urgencias} urgencias en el período.</p>}
    </div>
  );
}

function exportarGrupos(nombre: string, columna: string, grupos: ReturnType<typeof agrupar>): { nombre: string; filas: FilaExcel[]; formatos: Record<string, FormatoColumna> } {
  const total = suma(grupos, (g) => g.valor);
  return {
    nombre,
    filas: grupos.map((g) => ({
      [columna]: g.clave,
      Cantidad: g.cantidad,
      Producción: g.valor,
      "% del total": total ? (g.valor / total) * 100 : null,
      "Período anterior": g.anterior,
      "Variación %": variacion(g.valor, g.anterior),
      "Costo materiales": g.costo,
      "Margen %": g.valor ? ((g.valor - g.costo) / g.valor) * 100 : null,
    })),
    formatos: { Cantidad: "int", Producción: "clp", "% del total": "pct", "Período anterior": "clp", "Variación %": "pct", "Costo materiales": "clp", "Margen %": "pct" },
  };
}

// ---------------------------------------------------------------------------
// Producción: categoría → procedimiento → atención
// ---------------------------------------------------------------------------

function VistaProduccion({
  hechos, periodo, filtros, comparar, contra, voc, esVet, atenciones, serieProduccion, porDimension, alternar, cambiarFiltros, nombreDe,
}: Base & {
  grano: Grano; comparar: boolean; contra: string; voc: Vocabulario; esVet: boolean; atenciones: Atencion[];
  serieProduccion: { etiqueta: string; valor: number; anterior: number | null }[];
  porDimension: PorDimension; cambiarFiltros: (f: Filtros) => void; nombreDe: (id: string) => string;
}) {
  const nivel: "categoria" | "procedimiento" | "detalle" = filtros.procedimiento ? "detalle" : filtros.categoria ? "procedimiento" : "categoria";
  const grupos = nivel === "detalle" ? [] : porDimension(nivel, (a) => (nivel === "categoria" ? a.categoria : a.procedimiento));
  const total = suma(grupos, (g) => g.valor);

  // Matriz profesional × categoría: dónde produce cada quien.
  const matriz = useMemo(() => {
    const at = filtrarAtenciones(hechos, periodo, sin(filtros, "profesional", "categoria", "procedimiento"));
    const profesionales = agrupar(at, [], (a) => a.profesional, (a) => a.monto).map((g) => g.clave);
    const categorias = agrupar(at, [], (a) => a.categoria, (a) => a.monto).map((g) => g.clave).slice(0, 8);
    const celdas = profesionales.map((p) => categorias.map((c) => suma(at.filter((a) => a.profesional === p && a.categoria === c), (a) => a.monto)));
    return { profesionales, categorias, celdas, maximo: Math.max(0, ...celdas.flat()) };
  }, [hechos, periodo, filtros]);

  const columnasGrupo: ColumnaTabla<(typeof grupos)[number]>[] = [
    { clave: "clave", titulo: nivel === "categoria" ? "Categoría" : "Procedimiento", valor: (g) => g.clave, mostrar: (g) => <span className="inline-flex items-center gap-1 font-medium">{g.clave}<ChevronRight className="size-3 text-muted-foreground" /></span> },
    { clave: "cantidad", titulo: "Atenciones", valor: (g) => g.cantidad, formato: "int", alinear: "derecha" },
    {
      clave: "valor", titulo: "Producción", valor: (g) => g.valor, alinear: "derecha",
      mostrar: (g) => (
        <span className="inline-flex items-center justify-end gap-2">
          <span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-surface-muted sm:block"><span className="block h-full rounded-full bg-primary" style={{ width: `${total ? (g.valor / (grupos[0]?.valor || 1)) * 100 : 0}%` }} /></span>
          {clp.format(g.valor)}
        </span>
      ),
    },
    { clave: "share", titulo: "% total", valor: (g) => (total ? (g.valor / total) * 100 : 0), formato: "pct", alinear: "derecha" },
    { clave: "delta", titulo: "vs anterior", valor: (g) => variacion(g.valor, g.anterior), alinear: "derecha", mostrar: (g) => <Delta valor={variacion(g.valor, g.anterior)} /> },
    { clave: "ticket", titulo: "Promedio", valor: (g) => (g.cantidad ? g.valor / g.cantidad : 0), formato: "clp", alinear: "derecha" },
    { clave: "margen", titulo: "Margen", valor: (g) => (g.valor ? ((g.valor - g.costo) / g.valor) * 100 : null), formato: "pct", alinear: "derecha" },
  ];

  const columnasDetalle: ColumnaTabla<Atencion>[] = [
    { clave: "fecha", titulo: "Fecha", valor: (a) => a.fecha, mostrar: (a) => etiquetaFecha(a.fecha) },
    { clave: "persona", titulo: voc.persona, valor: (a) => nombreDe(a.cuentaId), mostrar: (a) => <Link href={`/dashboard/pacientes/${a.cuentaId}`} className="font-medium hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{nombreDe(a.cuentaId)}</Link> },
    ...(esVet ? [{ clave: "mascota", titulo: "Mascota", valor: (a: Atencion) => (a.mascota ? `${a.mascota}${a.especie ? ` · ${a.especie.toLowerCase()}` : ""}` : "—") }] : []),
    { clave: "profesional", titulo: "Profesional", valor: (a) => a.profesional },
    { clave: "procedimiento", titulo: "Procedimiento", valor: (a) => a.procedimiento },
    { clave: "monto", titulo: "Monto", valor: (a) => a.monto, formato: "clp", alinear: "derecha" },
    { clave: "costo", titulo: "Materiales", valor: (a) => a.costo, formato: "clp", alinear: "derecha" },
    { clave: "pagado", titulo: "Estado", valor: (a) => (a.pagado ? "Pagada" : "Por cobrar"), mostrar: (a) => <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", a.pagado ? "bg-success-bg text-success" : "bg-warning-bg text-warning")}>{a.pagado ? "Pagada" : "Por cobrar"}</span> },
  ];

  return (
    <div className="space-y-4">
      {/* Migas del drill-down */}
      <nav aria-label="Nivel" className="flex flex-wrap items-center gap-1 text-sm">
        <button type="button" onClick={() => cambiarFiltros(sin(filtros, "categoria", "procedimiento"))} className={cn("rounded px-1.5 py-0.5", nivel === "categoria" ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground hover:underline")}>
          Todas las categorías
        </button>
        {filtros.categoria && (
          <>
            <ChevronRight className="size-3.5 text-muted-foreground" />
            <button type="button" onClick={() => cambiarFiltros(sin(filtros, "procedimiento"))} className={cn("rounded px-1.5 py-0.5", nivel === "procedimiento" ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground hover:underline")}>
              {filtros.categoria}
            </button>
          </>
        )}
        {filtros.procedimiento && (
          <>
            <ChevronRight className="size-3.5 text-muted-foreground" />
            <span className="px-1.5 py-0.5 font-semibold text-foreground">{filtros.procedimiento}</span>
          </>
        )}
      </nav>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel
          titulo={nivel === "detalle" ? "Evolución del procedimiento" : nivel === "procedimiento" ? `Evolución de ${filtros.categoria}` : "Evolución de la producción"}
          acciones={<LeyendaTendencia comparar={comparar} contra={contra} />}
          className="xl:col-span-3"
        >
          <Tendencia puntos={serieProduccion} formato="clp" comparar={comparar} contra={contra} alto={220} />
        </Panel>
        <Panel titulo="Dónde produce cada profesional" descripcion="Producción por profesional y categoría. Clic en un nombre para filtrar." className="xl:col-span-2">
          <MapaCalor
            filas={matriz.profesionales}
            columnas={matriz.categorias}
            celdas={matriz.celdas}
            maximo={matriz.maximo}
            activaFila={filtros.profesional}
            onElegirFila={alternar("profesional")}
            formato={formatoClpCorto}
            etiquetaColumna={(c) => c}
            unidad=""
          />
        </Panel>
      </div>

      {nivel !== "detalle" ? (
        <Panel
          titulo={nivel === "categoria" ? "Categorías" : `Procedimientos de ${filtros.categoria}`}
          descripcion="Clic en una fila para bajar un nivel."
          exportar={exportarGrupos(nivel === "categoria" ? "Categorías" : `Procedimientos ${filtros.categoria}`, nivel === "categoria" ? "Categoría" : "Procedimiento", grupos)}
        >
          <Tabla
            key={nivel + (filtros.categoria ?? "")}
            filas={grupos.filter((g) => g.cantidad > 0)}
            columnas={columnasGrupo}
            porPagina={15}
            onFila={(g) => alternar(nivel)(g.clave)}
          />
        </Panel>
      ) : null}

      <Panel
        titulo={`Atenciones${filtros.procedimiento ? ` · ${filtros.procedimiento}` : filtros.categoria ? ` · ${filtros.categoria}` : ""}`}
        descripcion={`${entero.format(atenciones.length)} atenciones con los filtros actuales. El nombre abre la ficha.`}
        exportar={{ nombre: "Atenciones", filas: filasAtenciones(atenciones, hechos, voc, esVet), formatos: FORMATOS_ATENCIONES }}
      >
        <Tabla filas={atenciones} columnas={columnasDetalle} ordenInicial={{ clave: "fecha", desc: true }} porPagina={nivel === "detalle" ? 20 : 10} />
      </Panel>
    </div>
  );
}

const FORMATOS_ATENCIONES: Record<string, FormatoColumna> = { Fecha: "fecha", Monto: "clp", "Costo materiales": "clp", Margen: "clp" };

function filasAtenciones(atenciones: Atencion[], hechos: Hechos, voc: Vocabulario, esVet: boolean): FilaExcel[] {
  return atenciones.map((a) => {
    const cuenta = hechos.cuentas.get(a.cuentaId);
    return {
      Fecha: a.fecha,
      [voc.persona]: cuenta?.nombre ?? "—",
      ...(esVet ? { Mascota: a.mascota ?? "", Especie: a.especie ?? "" } : {}),
      Profesional: a.profesional,
      Categoría: a.categoria,
      Procedimiento: a.procedimiento,
      Monto: a.monto,
      "Costo materiales": a.costo,
      Margen: a.monto - a.costo,
      Estado: a.pagado ? "Pagada" : "Por cobrar",
      Urgencia: a.urgencia ? "Sí" : "No",
      Canal: etiquetaOrigen(cuenta?.origen),
      Comuna: cuenta?.comuna ?? SIN_DATO,
    };
  });
}

// ---------------------------------------------------------------------------
// Profesionales: el tablero de cada persona que atiende
// ---------------------------------------------------------------------------

type FilaProfesional = {
  profesional: string;
  atenciones: number;
  pacientes: number;
  produccion: number;
  anterior: number;
  ticket: number | null;
  margenPct: number | null;
  citas: number;
  asistenciaPct: number | null;
  noVino: number;
  cobradoPct: number | null;
};

function filasProfesionales(hechos: Hechos, periodo: Periodo, previo: Periodo, filtros: Filtros, hoy: string): FilaProfesional[] {
  const base = sin(filtros, "profesional");
  const nombres = new Set([...filtrarAtenciones(hechos, periodo, base).map((a) => a.profesional), ...filtrarCitas(hechos, periodo, base).map((c) => c.profesional)]);
  return [...nombres]
    .map((profesional) => {
      const f = { ...base, profesional };
      const k = calcularKpis(hechos, periodo, f, hoy);
      const antes = calcularKpis(hechos, previo, f, hoy);
      return {
        profesional,
        atenciones: k.atenciones,
        pacientes: k.pacientes,
        produccion: k.produccion,
        anterior: antes.produccion,
        ticket: k.ticket,
        margenPct: k.margenPct,
        citas: k.citas,
        asistenciaPct: k.asistenciaPct,
        noVino: k.noVino,
        cobradoPct: k.cobradoPct,
      };
    })
    .sort((a, b) => b.produccion - a.produccion);
}

function VistaProfesionales({ hechos, periodo, previo, filtros, hoy, alternar }: Base & { hoy: string }) {
  const filas = useMemo(() => filasProfesionales(hechos, periodo, previo, filtros, hoy), [hechos, periodo, previo, filtros, hoy]);
  const total = suma(filas, (f) => f.produccion);
  const columnas: ColumnaTabla<FilaProfesional>[] = [
    { clave: "profesional", titulo: "Profesional", valor: (f) => f.profesional, mostrar: (f) => <span className={cn("font-medium", filtros.profesional === f.profesional && "text-primary")}>{f.profesional}</span> },
    { clave: "produccion", titulo: "Producción", valor: (f) => f.produccion, formato: "clp", alinear: "derecha" },
    { clave: "share", titulo: "% clínica", valor: (f) => (total ? (f.produccion / total) * 100 : 0), formato: "pct", alinear: "derecha" },
    { clave: "delta", titulo: "vs anterior", valor: (f) => variacion(f.produccion, f.anterior), alinear: "derecha", mostrar: (f) => <Delta valor={variacion(f.produccion, f.anterior)} /> },
    { clave: "atenciones", titulo: "Atenciones", valor: (f) => f.atenciones, formato: "int", alinear: "derecha" },
    { clave: "pacientes", titulo: "Personas", valor: (f) => f.pacientes, formato: "int", alinear: "derecha" },
    { clave: "ticket", titulo: "Ticket", valor: (f) => f.ticket, formato: "clp", alinear: "derecha" },
    { clave: "margen", titulo: "Margen", valor: (f) => f.margenPct, formato: "pct", alinear: "derecha" },
    { clave: "citas", titulo: "Citas", valor: (f) => f.citas, formato: "int", alinear: "derecha" },
    { clave: "asistencia", titulo: "Asistencia", valor: (f) => f.asistenciaPct, formato: "pct", alinear: "derecha" },
    { clave: "cobrado", titulo: "Cobrado", valor: (f) => f.cobradoPct, formato: "pct", alinear: "derecha" },
  ];
  const ticket = filas.filter((f) => f.ticket !== null).map((f) => ({ clave: f.profesional, valor: f.ticket ?? 0 }));
  const asistencia = filas.filter((f) => f.asistenciaPct !== null).map((f) => ({ clave: f.profesional, valor: f.asistenciaPct ?? 0 }));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel titulo="Producción" descripcion="Con variación frente al período anterior">
          <BarrasRanking items={filas.map((f) => ({ clave: f.profesional, valor: f.produccion, anterior: f.anterior }))} formato="clp" activo={filtros.profesional} onElegir={alternar("profesional")} />
        </Panel>
        <Panel titulo="Ticket por visita" descripcion="Cuánto deja en promedio cada visita">
          <BarrasRanking items={ticket} formato="clp" activo={filtros.profesional} onElegir={alternar("profesional")} mostrarVariacion={false} />
        </Panel>
        <Panel titulo="Asistencia a sus citas" descripcion="Atendidas sobre atendidas + no vino">
          <BarrasRanking items={asistencia} formato="pct" activo={filtros.profesional} onElegir={alternar("profesional")} mostrarVariacion={false} />
        </Panel>
      </div>
      <Panel
        titulo="Cuadro por profesional"
        descripcion="Clic en una fila para filtrar todo el tablero por esa persona."
        exportar={{
          nombre: "Profesionales",
          filas: filas.map((f) => ({
            Profesional: f.profesional, Producción: f.produccion, "% clínica": total ? (f.produccion / total) * 100 : null, "Período anterior": f.anterior,
            "Variación %": variacion(f.produccion, f.anterior), Atenciones: f.atenciones, Personas: f.pacientes, Ticket: f.ticket, "Margen %": f.margenPct,
            Citas: f.citas, "No vino": f.noVino, "Asistencia %": f.asistenciaPct, "Cobrado %": f.cobradoPct,
          })),
          formatos: { Producción: "clp", "% clínica": "pct", "Período anterior": "clp", "Variación %": "pct", Ticket: "clp", "Margen %": "pct", "Asistencia %": "pct", "Cobrado %": "pct", Atenciones: "int", Personas: "int", Citas: "int", "No vino": "int" },
        }}
      >
        <Tabla filas={filas} columnas={columnas} onFila={(f) => alternar("profesional")(f.profesional)} />
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

function VistaAgenda({
  hechos, periodo, previo, filtros, hoy, grano, comparar, contra, kpis, kpisAntes, alternar, nombreDe,
}: Base & { hoy: string; grano: Grano; comparar: boolean; contra: string; kpis: Kpis; kpisAntes: Kpis; nombreDe: (id: string) => string }) {
  const citas = filtrarCitas(hechos, periodo, filtros);
  const citasAntes = filtrarCitas(hechos, previo, filtros);
  const porProfesional = useMemo(() => {
    const base = filtrarCitas(hechos, periodo, sin(filtros, "profesional"));
    const m = new Map<string, Record<string, number>>();
    for (const c of base) {
      const fila = m.get(c.profesional) ?? {};
      fila[c.estado] = (fila[c.estado] ?? 0) + 1;
      m.set(c.profesional, fila);
    }
    return [...m.entries()].map(([clave, valores]) => ({ clave, valores })).sort((a, b) => suma(Object.values(b.valores), (v) => v) - suma(Object.values(a.valores), (v) => v));
  }, [hechos, periodo, filtros]);
  const calor = calorAgenda(citas);
  const motivos = agrupar(citas, citasAntes, (c) => c.motivo, () => 1);
  const noVinoSerie = serie(citas.filter((c) => c.estado === "no_vino"), citasAntes.filter((c) => c.estado === "no_vino"), (c) => c.fecha, () => 1, periodo, grano, previo).map((p) => ({ ...p, etiqueta: etiquetaTramo(p.tramo, grano) }));
  const citasSerie = serie(citas.filter((c) => c.estado !== "cancelada"), citasAntes.filter((c) => c.estado !== "cancelada"), (c) => c.fecha, () => 1, periodo, grano, previo).map((p) => ({ ...p, etiqueta: etiquetaTramo(p.tramo, grano) }));
  const proximas = citas.filter((c) => c.fecha >= hoy && (c.estado === "reservada" || c.estado === "confirmada")).length;
  const horas = suma(citas.filter((c) => c.estado === "atendida"), (c) => c.minutos) / 60;
  const columnas: ColumnaTabla<Cita>[] = [
    { clave: "inicio", titulo: "Fecha y hora", valor: (c) => c.inicio, mostrar: (c) => `${etiquetaFecha(c.fecha)} · ${c.inicio.slice(11, 16)}` },
    { clave: "persona", titulo: "Ficha", valor: (c) => nombreDe(c.cuentaId), mostrar: (c) => <Link href={`/dashboard/pacientes/${c.cuentaId}`} className="font-medium hover:text-primary hover:underline">{nombreDe(c.cuentaId)}</Link> },
    { clave: "profesional", titulo: "Profesional", valor: (c) => c.profesional },
    { clave: "motivo", titulo: "Motivo", valor: (c) => c.motivo },
    { clave: "estado", titulo: "Estado", valor: (c) => c.estado, mostrar: (c) => { const s = ESTADOS_CITA.find((e) => e.clave === c.estado); return <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: s?.color }} />{s?.etiqueta ?? c.estado}</span>; } },
    { clave: "minutos", titulo: "Duración", valor: (c) => c.minutos, mostrar: (c) => `${c.minutos} min`, alinear: "derecha" },
  ];
  return (
    <div className="space-y-4">
      <AvisoNoAplica filtros={filtros} conjunto="citas" nombre="las citas" />
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi etiqueta="Citas" valor={entero.format(kpis.citas)} delta={variacion(kpis.citas, kpisAntes.citas)} anterior={entero.format(kpisAntes.citas)} />
        <Kpi etiqueta="Atendidas" valor={entero.format(kpis.atendidas)} delta={variacion(kpis.atendidas, kpisAntes.atendidas)} detalle={`${entero.format(horas)} h de sillón`} />
        <Kpi etiqueta="Asistencia" valor={formatoPct(kpis.asistenciaPct)} delta={variacion(kpis.asistenciaPct, kpisAntes.asistenciaPct)} />
        <Kpi etiqueta="No vinieron" valor={entero.format(kpis.noVino)} delta={variacion(kpis.noVino, kpisAntes.noVino)} inverso />
        <Kpi etiqueta="Canceladas" valor={entero.format(kpis.canceladas)} delta={variacion(kpis.canceladas, kpisAntes.canceladas)} inverso />
        <Kpi etiqueta="Por venir" valor={entero.format(proximas)} detalle="reservadas o confirmadas" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel titulo="Citas en el tiempo" descripcion="Sin canceladas" acciones={<LeyendaTendencia comparar={comparar} contra={contra} />}>
          <Tendencia puntos={citasSerie} formato="int" comparar={comparar} contra={contra} alto={200} />
        </Panel>
        <Panel titulo="No vinieron" descripcion="Citas sin asistencia en el tiempo" acciones={<LeyendaTendencia comparar={comparar} contra={contra} />}>
          <Tendencia puntos={noVinoSerie} formato="int" comparar={comparar} contra={contra} alto={200} />
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <Panel
          titulo="Estado de las citas por profesional"
          descripcion="Clic en una fila para filtrar"
          className="xl:col-span-2"
          exportar={{ nombre: "Citas por profesional", filas: porProfesional.map((f) => ({ Profesional: f.clave, ...Object.fromEntries(ESTADOS_CITA.map((e) => [e.etiqueta, f.valores[e.clave] ?? 0])) })) }}
        >
          <BarrasEstado filas={porProfesional} segmentos={ESTADOS_CITA} activo={filtros.profesional} onElegir={alternar("profesional")} />
        </Panel>
        <Panel titulo="Carga por día y hora" descripcion="Dónde se llena y dónde sobra agenda. Clic en un día para filtrar." className="xl:col-span-3">
          <MapaCalor filas={DIAS_SEMANA} columnas={calor.horas.map(String)} celdas={calor.celdas} maximo={calor.maximo} activaFila={filtros.dia} onElegirFila={alternar("dia")} />
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel titulo="Motivos de consulta" descripcion="Cantidad de citas" exportar={{ nombre: "Motivos", filas: motivos.map((m) => ({ Motivo: m.clave, Citas: m.cantidad, "Período anterior": m.anterior })) }}>
          <BarrasRanking items={motivos.map((m) => ({ clave: m.clave, valor: m.cantidad, anterior: m.anterior }))} formato="int" />
        </Panel>
        <Panel titulo="Citas del período" className="xl:col-span-2" exportar={{ nombre: "Citas", filas: citas.map((c) => ({ Fecha: c.fecha, Hora: c.inicio.slice(11, 16), Ficha: nombreDe(c.cuentaId), Profesional: c.profesional, Motivo: c.motivo, Estado: ESTADOS_CITA.find((e) => e.clave === c.estado)?.etiqueta ?? c.estado, Minutos: c.minutos })), formatos: { Fecha: "fecha" } }}>
          <Tabla filas={citas} columnas={columnas} ordenInicial={{ clave: "inicio", desc: true }} porPagina={10} />
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presupuestos / planes
// ---------------------------------------------------------------------------

function VistaPlanes({
  hechos, periodo, previo, filtros, grano, comparar, contra, kpis, kpisAntes, voc, alternar, nombreDe,
}: Base & { grano: Grano; comparar: boolean; contra: string; kpis: Kpis; kpisAntes: Kpis; voc: Vocabulario; nombreDe: (id: string) => string }) {
  const planes = filtrarPlanes(hechos, periodo, filtros);
  const planesAntes = filtrarPlanes(hechos, previo, filtros);
  const origenDe = (p: Plan) => etiquetaOrigen(p.origen ?? hechos.cuentas.get(p.cuentaId)?.origen);
  const porOrigen = (() => {
    const base = filtrarPlanes(hechos, periodo, sin(filtros, "origen"));
    const m = new Map<string, { creados: number; ganados: number; valor: number; aceptado: number }>();
    for (const p of base) {
      const k = origenDe(p);
      const f = m.get(k) ?? { creados: 0, ganados: 0, valor: 0, aceptado: 0 };
      f.creados += 1;
      f.valor += p.monto;
      if (p.estado === "ganada") { f.ganados += 1; f.aceptado += p.monto; }
      m.set(k, f);
    }
    return [...m.entries()].map(([origen, f]) => ({ origen, ...f, conversion: f.creados ? (f.ganados / f.creados) * 100 : 0 })).sort((a, b) => b.aceptado - a.aceptado || b.creados - a.creados);
  })();
  const motivos = agrupar(planes.filter((p) => p.estado === "perdida"), planesAntes.filter((p) => p.estado === "perdida"), (p) => p.motivoPerdida ?? "Sin motivo", () => 1);
  const etapas = agrupar(planes.filter((p) => p.estado === "abierta"), [], (p) => p.etapa ?? "Sin etapa", (p) => p.monto);
  const valorSerie = serie(planes, planesAntes, (p) => p.creado, (p) => p.monto, periodo, grano, previo).map((p) => ({ ...p, etiqueta: etiquetaTramo(p.tramo, grano) }));
  const cerrados = planes.filter((p) => p.estado !== "abierta" && p.cerrado);
  const diasCierre = cerrados.length ? suma(cerrados, (p) => Math.max(0, diasEntre(p.creado, p.cerrado!))) / cerrados.length : null;
  const columnas: ColumnaTabla<Plan>[] = [
    { clave: "creado", titulo: "Creado", valor: (p) => p.creado, mostrar: (p) => etiquetaFecha(p.creado) },
    { clave: "persona", titulo: voc.persona, valor: (p) => nombreDe(p.cuentaId), mostrar: (p) => <Link href={`/dashboard/pacientes/${p.cuentaId}`} className="font-medium hover:text-primary hover:underline">{nombreDe(p.cuentaId)}</Link> },
    { clave: "nombre", titulo: voc.plan, valor: (p) => p.nombre },
    { clave: "monto", titulo: "Monto", valor: (p) => p.monto, formato: "clp", alinear: "derecha" },
    { clave: "estado", titulo: "Estado", valor: (p) => p.estado, mostrar: (p) => <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", p.estado === "ganada" ? "bg-success-bg text-success" : p.estado === "perdida" ? "bg-danger-bg text-danger" : "bg-surface-muted text-foreground")}>{p.estado === "ganada" ? "Aceptado" : p.estado === "perdida" ? "Perdido" : p.etapa ?? "Abierto"}</span> },
    { clave: "origen", titulo: "Canal", valor: (p) => origenDe(p) },
  ];
  return (
    <div className="space-y-4">
      <AvisoNoAplica filtros={filtros} conjunto="planes" nombre={`los ${voc.planes.toLowerCase()}`} />
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi etiqueta={`${voc.planes} creados`} valor={entero.format(kpis.planesCreados)} delta={variacion(kpis.planesCreados, kpisAntes.planesCreados)} anterior={entero.format(kpisAntes.planesCreados)} />
        <Kpi etiqueta="Valor presupuestado" valor={formatoClpCorto(kpis.valorPresupuestado)} delta={variacion(kpis.valorPresupuestado, kpisAntes.valorPresupuestado)} />
        <Kpi etiqueta={voc.aceptados} valor={entero.format(kpis.planesGanados)} delta={variacion(kpis.planesGanados, kpisAntes.planesGanados)} />
        <Kpi etiqueta="Valor aceptado" valor={formatoClpCorto(kpis.valorAceptado)} delta={variacion(kpis.valorAceptado, kpisAntes.valorAceptado)} />
        <Kpi etiqueta="Conversión" valor={formatoPct(kpis.conversionPct)} delta={variacion(kpis.conversionPct, kpisAntes.conversionPct)} detalle={`${kpis.planesAbiertos} siguen abiertos`} />
        <Kpi etiqueta="Días a la decisión" valor={diasCierre === null ? "—" : entero.format(diasCierre)} detalle="promedio, de creado a cerrado" />
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <Panel titulo="Embudo" descripcion={`De ${voc.planes.toLowerCase()} creados a aceptados, en cantidad y valor`} className="xl:col-span-2">
          <Embudo
            pasos={[
              { etiqueta: "Creados", cantidad: kpis.planesCreados, valor: kpis.valorPresupuestado },
              { etiqueta: "Decididos", cantidad: kpis.planesGanados + kpis.planesPerdidos, valor: suma(planes.filter((p) => p.estado !== "abierta"), (p) => p.monto) },
              { etiqueta: voc.aceptados, cantidad: kpis.planesGanados, valor: kpis.valorAceptado },
            ]}
          />
        </Panel>
        <Panel titulo="Valor presupuestado en el tiempo" acciones={<LeyendaTendencia comparar={comparar} contra={contra} />} className="xl:col-span-3">
          <Tendencia puntos={valorSerie} formato="clp" comparar={comparar} contra={contra} alto={200} />
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          titulo="Conversión por canal de origen"
          descripcion="Clic en un canal para filtrar"
          className="xl:col-span-2"
          exportar={{ nombre: "Conversión por canal", filas: porOrigen.map((o) => ({ Canal: o.origen, Creados: o.creados, Aceptados: o.ganados, "Conversión %": o.conversion, "Valor presupuestado": o.valor, "Valor aceptado": o.aceptado })), formatos: { "Conversión %": "pct", "Valor presupuestado": "clp", "Valor aceptado": "clp" } }}
        >
          <Tabla
            filas={porOrigen}
            onFila={(o) => alternar("origen")(o.origen)}
            columnas={[
              { clave: "origen", titulo: "Canal", valor: (o) => o.origen, mostrar: (o) => <span className={cn("font-medium", filtros.origen === o.origen && "text-primary")}>{o.origen}</span> },
              { clave: "creados", titulo: "Creados", valor: (o) => o.creados, formato: "int", alinear: "derecha" },
              { clave: "ganados", titulo: voc.aceptados, valor: (o) => o.ganados, formato: "int", alinear: "derecha" },
              {
                clave: "conversion", titulo: "Conversión", valor: (o) => o.conversion, alinear: "derecha",
                mostrar: (o) => <span className="inline-flex items-center justify-end gap-2"><span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted sm:block"><span className="block h-full rounded-full bg-primary" style={{ width: `${o.conversion}%` }} /></span>{formatoPct(o.conversion)}</span>,
              },
              { clave: "valor", titulo: "Presupuestado", valor: (o) => o.valor, formato: "clp", alinear: "derecha" },
              { clave: "aceptado", titulo: "Aceptado", valor: (o) => o.aceptado, formato: "clp", alinear: "derecha" },
            ]}
          />
        </Panel>
        <div className="space-y-4">
          <Panel titulo="Por qué se pierden" descripcion="Motivos declarados">
            <BarrasRanking items={motivos.map((m) => ({ clave: m.clave, valor: m.cantidad, anterior: m.anterior }))} formato="int" inverso />
          </Panel>
          <Panel titulo="Abiertos por etapa" descripcion="Valor en juego">
            <BarrasRanking items={aItems(etapas, (g) => `${g.cantidad}`)} formato="clp" mostrarVariacion={false} />
          </Panel>
        </div>
      </div>
      <Panel
        titulo={`${voc.planes} del período`}
        exportar={{ nombre: voc.planes, filas: planes.map((p) => ({ Creado: p.creado, [voc.persona]: nombreDe(p.cuentaId), [voc.plan]: p.nombre, Monto: p.monto, Estado: p.estado === "ganada" ? "Aceptado" : p.estado === "perdida" ? "Perdido" : "Abierto", Etapa: p.etapa ?? "", Cerrado: p.cerrado ?? "", "Motivo de pérdida": p.motivoPerdida ?? "", Canal: origenDe(p) })), formatos: { Creado: "fecha", Cerrado: "fecha", Monto: "clp" } }}
      >
        <Tabla filas={planes} columnas={columnas} ordenInicial={{ clave: "creado", desc: true }} porPagina={10} />
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pacientes / tutores
// ---------------------------------------------------------------------------

function VistaPacientes({
  hechos, periodo, previo, filtros, hoy, grano, comparar, contra, kpis, kpisAntes, voc, esVet, atenciones, porDimension, alternar,
}: Base & { hoy: string; grano: Grano; comparar: boolean; contra: string; kpis: Kpis; kpisAntes: Kpis; voc: Vocabulario; esVet: boolean; atenciones: Atencion[]; porDimension: PorDimension }) {
  const nuevos = primerasVisitas(hechos, periodo, filtros);
  const nuevosAntes = primerasVisitas(hechos, previo, filtros);
  const nuevosSerie = serie(nuevos, nuevosAntes, (c) => c.primeraAtencion!, () => 1, periodo, grano, previo).map((p) => ({ ...p, etiqueta: etiquetaTramo(p.tramo, grano) }));
  const nuevosPorOrigen = agrupar(primerasVisitas(hechos, periodo, sin(filtros, "origen")), primerasVisitas(hechos, previo, sin(filtros, "origen")), (c) => etiquetaOrigen(c.origen), () => 1);
  const comunas = useMemo(() => {
    const at = filtrarAtenciones(hechos, periodo, sin(filtros, "comuna"));
    const m = new Map<string, Set<string>>();
    for (const a of at) {
      const k = hechos.cuentas.get(a.cuentaId)?.comuna ?? SIN_DATO;
      const s = m.get(k) ?? new Set();
      s.add(a.cuentaId);
      m.set(k, s);
    }
    return [...m.entries()].map(([clave, s]) => ({ clave, valor: s.size })).sort((a, b) => b.valor - a.valor);
  }, [hechos, periodo, filtros]);
  const recurrentes = recurrencia(atenciones);
  const fichasNuevas = [...hechos.cuentas.values()].filter((c) => c.creada >= periodo.desde && c.creada <= periodo.hasta).length;
  const especies = esVet ? porDimension("especie", (a) => a.especie ?? SIN_DATO) : [];
  const vacunas = esVet ? estadoVacunas(hechos.vacunas, hoy) : null;
  const conDosOMas = recurrentes[1].personas + recurrentes[2].personas;
  const totalRec = suma(recurrentes, (r) => r.personas);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi etiqueta={`${voc.personas} atendidos`} valor={entero.format(kpis.pacientes)} delta={variacion(kpis.pacientes, kpisAntes.pacientes)} anterior={entero.format(kpisAntes.pacientes)} />
        <Kpi etiqueta="Primera visita" valor={entero.format(kpis.nuevos)} delta={variacion(kpis.nuevos, kpisAntes.nuevos)} anterior={entero.format(kpisAntes.nuevos)} detalle="primera atención en la historia" />
        <Kpi etiqueta="Fichas creadas" valor={entero.format(fichasNuevas)} detalle="altas en el período" />
        <Kpi etiqueta="Volvieron" valor={formatoPct(totalRec ? (conDosOMas / totalRec) * 100 : null)} detalle="con dos o más visitas en el período" />
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <Panel titulo={`${voc.personas} nuevos en el tiempo`} descripcion="Primera atención" acciones={<LeyendaTendencia comparar={comparar} contra={contra} />} className="xl:col-span-3">
          <Tendencia puntos={nuevosSerie} formato="int" comparar={comparar} contra={contra} alto={220} />
        </Panel>
        <Panel titulo="De dónde llegan los nuevos" descripcion="Canal de origen" className="xl:col-span-2" exportar={{ nombre: "Nuevos por canal", filas: nuevosPorOrigen.map((g) => ({ Canal: g.clave, Nuevos: g.cantidad, "Período anterior": g.anterior })) }}>
          <BarrasRanking items={nuevosPorOrigen.filter((g) => g.valor > 0).map((g) => ({ clave: g.clave, valor: g.valor, anterior: g.anterior }))} formato="int" activo={filtros.origen} onElegir={alternar("origen")} />
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel titulo="Por comuna" descripcion={`${voc.personas} atendidos`} exportar={{ nombre: "Por comuna", filas: comunas.map((c) => ({ Comuna: c.clave, [voc.personas]: c.valor })) }}>
          <BarrasRanking items={comunas} formato="int" activo={filtros.comuna} onElegir={alternar("comuna")} />
        </Panel>
        <Panel titulo="Frecuencia de visita" descripcion="Cuántas veces vino cada persona en el período">
          <BarrasRanking items={recurrentes.map((r) => ({ clave: r.etiqueta, valor: r.personas }))} formato="int" mostrarVariacion={false} />
        </Panel>
        {esVet ? (
          <Panel titulo="Por especie" descripcion="Producción">
            <BarrasRanking items={aItems(especies, (g) => `${g.cantidad} at.`)} formato="clp" activo={filtros.especie} onElegir={alternar("especie")} />
          </Panel>
        ) : (
          <Panel titulo="Nuevos del período" descripcion="Primera atención">
            {nuevos.length === 0 ? <Vacio /> : (
              <ul className="divide-y divide-border text-xs">
                {nuevos.slice(0, 8).map((c) => (
                  <li key={c.id} className="flex justify-between py-1.5">
                    <Link href={`/dashboard/pacientes/${c.id}`} className="truncate font-medium hover:text-primary hover:underline">{c.nombre}</Link>
                    <span className="text-muted-foreground">{etiquetaFecha(c.primeraAtencion!)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
      {vacunas && (
        <Panel titulo="Estado de vacunas hoy" descripcion="Todas las mascotas de la clínica, sin importar el período. Las vencidas y por vencer están en Recordatorios.">
          <div className="grid gap-3 sm:grid-cols-4">
            {([
              ["vencida", "Vencidas", "bg-danger-bg text-danger"],
              ["por_vencer", "Vencen en 30 días", "bg-warning-bg text-warning"],
              ["al_dia", "Al día", "bg-success-bg text-success"],
              ["sin_dato", "Sin registro", "bg-surface-muted text-muted-foreground"],
            ] as const).map(([clave, etiqueta, tono]) => (
              <div key={clave} className="rounded-lg border border-border px-3 py-2.5">
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", tono)}>{etiqueta}</span>
                <p className="mt-1.5 text-xl font-semibold tabular-nums text-foreground">{entero.format(vacunas[clave])}</p>
              </div>
            ))}
          </div>
          <Link href="/dashboard/recordatorios" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Ir a Recordatorios <ChevronRight className="size-3" /></Link>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Caja
// ---------------------------------------------------------------------------

function VistaCaja({
  hechos, periodo, previo, filtros, hoy, grano, comparar, contra, kpis, kpisAntes, voc, atenciones, atencionesAntes, alternar, nombreDe,
}: Base & { hoy: string; grano: Grano; comparar: boolean; contra: string; kpis: Kpis; kpisAntes: Kpis; voc: Vocabulario; atenciones: Atencion[]; atencionesAntes: Atencion[]; nombreDe: (id: string) => string }) {
  const saldos = filtrarSaldos(hechos, filtros);
  const antiguedad = antiguedadSaldos(saldos, hoy);
  const totalSaldo = suma(saldos, (s) => s.monto);
  const pagos = filtrarPagos(hechos, periodo, filtros);
  const pagosAntes = filtrarPagos(hechos, previo, filtros);
  const recibidos = pagos.filter((p) => p.estado === "pagado");
  const medios = agrupar(recibidos, pagosAntes.filter((p) => p.estado === "pagado"), (p) => ETIQUETA_MEDIO[p.medio] ?? p.medio, (p) => p.monto);
  const enLinea = pagos.filter((p) => p.estado === "pendiente");
  const cobradoSerie = serie(atenciones.filter((a) => a.pagado), atencionesAntes.filter((a) => a.pagado), (a) => a.fecha, (a) => a.monto, periodo, grano, previo).map((p) => ({ ...p, etiqueta: etiquetaTramo(p.tramo, grano) }));
  const deudores = (() => {
    const m = new Map<string, { cuentaId: string; monto: number; lineas: number; desde: string }>();
    for (const s of saldos) {
      const f = m.get(s.cuentaId) ?? { cuentaId: s.cuentaId, monto: 0, lineas: 0, desde: s.fecha };
      f.monto += s.monto;
      f.lineas += 1;
      if (s.fecha < f.desde) f.desde = s.fecha;
      m.set(s.cuentaId, f);
    }
    return [...m.values()].sort((a, b) => b.monto - a.monto);
  })();
  const porProfesional = agrupar(saldos, [], (s) => s.profesional, (s) => s.monto);
  return (
    <div className="space-y-4">
      <AvisoNoAplica filtros={filtros} conjunto="saldos" nombre="los pagos y saldos" />
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi etiqueta="Producción" valor={formatoClpCorto(kpis.produccion)} delta={variacion(kpis.produccion, kpisAntes.produccion)} />
        <Kpi etiqueta="Cobrado" valor={formatoClpCorto(kpis.produccion - kpis.pendienteDelPeriodo)} detalle={`${formatoPct(kpis.cobradoPct)} de lo producido`} delta={variacion(kpis.produccion - kpis.pendienteDelPeriodo, kpisAntes.produccion - kpisAntes.pendienteDelPeriodo)} />
        <Kpi etiqueta="Pendiente" valor={formatoClpCorto(kpis.pendienteDelPeriodo)} delta={variacion(kpis.pendienteDelPeriodo, kpisAntes.pendienteDelPeriodo)} inverso detalle="de lo producido en el período" />
        <Kpi etiqueta="Por cobrar hoy" valor={formatoClpCorto(totalSaldo)} detalle={`${deudores.length} fichas con saldo`} />
        <Kpi etiqueta="Pagos registrados" valor={formatoClpCorto(suma(recibidos, (p) => p.monto))} detalle={`${recibidos.length} pagos en caja`} />
        <Kpi etiqueta="Enlaces sin pagar" valor={entero.format(enLinea.length)} detalle={formatoClpCorto(suma(enLinea, (p) => p.monto))} />
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <Panel titulo="Cobrado de lo producido" descripcion="Atenciones ya pagadas, según la fecha de la atención" acciones={<LeyendaTendencia comparar={comparar} contra={contra} />} className="xl:col-span-3">
          <Tendencia puntos={cobradoSerie} formato="clp" comparar={comparar} contra={contra} alto={220} />
        </Panel>
        <Panel titulo="Antigüedad de lo por cobrar" descripcion="Saldo total de hoy, por días desde la atención" className="xl:col-span-2" exportar={{ nombre: "Antigüedad", filas: antiguedad.map((t) => ({ Tramo: t.etiqueta, Monto: t.monto, Fichas: t.fichas })), formatos: { Monto: "clp" } }}>
          <BarrasRanking items={antiguedad.map((t) => ({ clave: t.etiqueta, valor: t.monto, detalle: `${t.fichas} fichas` }))} formato="clp" mostrarVariacion={false} maximo={4} />
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel titulo="Medios de pago" descripcion="Pagos registrados en Caja en el período">
          {medios.length === 0 ? <Vacio>Todavía no hay pagos registrados en Caja en este período.</Vacio> : <BarrasRanking items={aItems(medios, (g) => `${g.cantidad}`)} formato="clp" />}
        </Panel>
        <Panel titulo="Por cobrar por profesional" descripcion="Quién atendió lo que falta cobrar">
          <BarrasRanking items={aItems(porProfesional)} formato="clp" activo={filtros.profesional} onElegir={alternar("profesional")} mostrarVariacion={false} />
        </Panel>
        <Panel
          titulo="Mayores saldos"
          exportar={{ nombre: "Por cobrar", filas: deudores.map((d) => ({ [voc.persona]: nombreDe(d.cuentaId), Saldo: d.monto, Atenciones: d.lineas, Desde: d.desde, Días: diasEntre(d.desde, hoy) })), formatos: { Saldo: "clp", Desde: "fecha" } }}
        >
          {deudores.length === 0 ? <Vacio>Nada por cobrar.</Vacio> : (
            <ul className="divide-y divide-border text-xs">
              {deudores.slice(0, 8).map((d) => (
                <li key={d.cuentaId} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`/dashboard/pacientes/${d.cuentaId}`} className="truncate font-medium hover:text-primary hover:underline">{nombreDe(d.cuentaId)}</Link>
                  <span className="shrink-0 tabular-nums text-foreground">{clp.format(d.monto)} <span className="text-muted-foreground">· {diasEntre(d.desde, hoy)} d</span></span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/dashboard/caja" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Cobrar en Caja <ChevronRight className="size-3" /></Link>
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Libro completo
// ---------------------------------------------------------------------------

function libroCompleto({
  hechos, periodo, previo, filtros, hoy, kpis, kpisAntes, grano, voc, esVet, etiquetaPeriodo, empresa,
}: {
  hechos: Hechos; periodo: Periodo; previo: Periodo; filtros: Filtros; hoy: string; kpis: Kpis; kpisAntes: Kpis; grano: Grano; voc: Vocabulario; esVet: boolean; etiquetaPeriodo: string; empresa: string | null;
}): HojaExcel[] {
  const at = filtrarAtenciones(hechos, periodo, filtros);
  const at0 = filtrarAtenciones(hechos, previo, filtros);
  const citas = filtrarCitas(hechos, periodo, filtros);
  const planes = filtrarPlanes(hechos, periodo, filtros);
  const saldos = filtrarSaldos(hechos, filtros);
  const nombre = (id: string) => hechos.cuentas.get(id)?.nombre ?? "—";
  const filtrosTexto = Object.entries(filtros).map(([d, v]) => `${ETIQUETA_DIMENSION[d as Dimension]}: ${v}`).join(" · ") || "Sin filtros";
  const fila = (indicador: string, a: number | null, b: number | null, formato: "clp" | "int" | "pct") => ({ Indicador: indicador, Formato: formato, "Este período": a, "Período anterior": b, "Variación %": variacion(a, b) });
  const indicadores = [
    fila("Producción", kpis.produccion, kpisAntes.produccion, "clp"),
    fila("Atenciones", kpis.atenciones, kpisAntes.atenciones, "int"),
    fila("Visitas", kpis.visitas, kpisAntes.visitas, "int"),
    fila("Ticket por visita", kpis.ticket, kpisAntes.ticket, "clp"),
    fila(`${voc.personas} atendidos`, kpis.pacientes, kpisAntes.pacientes, "int"),
    fila("Primera visita", kpis.nuevos, kpisAntes.nuevos, "int"),
    fila("Costo de materiales", kpis.costo, kpisAntes.costo, "clp"),
    fila("Margen sobre materiales", kpis.margen, kpisAntes.margen, "clp"),
    fila("Margen %", kpis.margenPct, kpisAntes.margenPct, "pct"),
    fila("Cobrado de lo producido %", kpis.cobradoPct, kpisAntes.cobradoPct, "pct"),
    fila("Pendiente del período", kpis.pendienteDelPeriodo, kpisAntes.pendienteDelPeriodo, "clp"),
    fila("Citas", kpis.citas, kpisAntes.citas, "int"),
    fila("Citas atendidas", kpis.atendidas, kpisAntes.atendidas, "int"),
    fila("No vinieron", kpis.noVino, kpisAntes.noVino, "int"),
    fila("Canceladas", kpis.canceladas, kpisAntes.canceladas, "int"),
    fila("Asistencia %", kpis.asistenciaPct, kpisAntes.asistenciaPct, "pct"),
    fila(`${voc.planes} creados`, kpis.planesCreados, kpisAntes.planesCreados, "int"),
    fila(`${voc.planes} aceptados`, kpis.planesGanados, kpisAntes.planesGanados, "int"),
    fila("Valor presupuestado", kpis.valorPresupuestado, kpisAntes.valorPresupuestado, "clp"),
    fila("Valor aceptado", kpis.valorAceptado, kpisAntes.valorAceptado, "clp"),
    fila("Conversión %", kpis.conversionPct, kpisAntes.conversionPct, "pct"),
  ];
  // Los porcentajes de la hoja resumen se muestran como número con "%" en el nombre: la columna mezcla formatos.
  const resumen: FilaExcel[] = [
    { Indicador: "Clínica", "Este período": empresa ?? "", "Período anterior": "", "Variación %": null },
    { Indicador: "Período", "Este período": `${periodo.desde} a ${periodo.hasta}`, "Período anterior": `${previo.desde} a ${previo.hasta}`, "Variación %": null },
    { Indicador: "Vista", "Este período": etiquetaPeriodo, "Período anterior": "", "Variación %": null },
    { Indicador: "Filtros", "Este período": filtrosTexto, "Período anterior": "", "Variación %": null },
    { Indicador: "Generado", "Este período": hoy, "Período anterior": "", "Variación %": null },
    { Indicador: "", "Este período": "", "Período anterior": "", "Variación %": null },
    ...indicadores.map((i) => ({
      Indicador: i.Indicador,
      "Este período": i["Este período"] === null ? null : Math.round(i["Este período"] * 10) / 10,
      "Período anterior": i["Período anterior"] === null ? null : Math.round(i["Período anterior"] * 10) / 10,
      "Variación %": i["Variación %"] === null ? null : Math.round(i["Variación %"] * 10) / 10,
    })),
  ];
  const serieP = serie(at, at0, (a) => a.fecha, (a) => a.monto, periodo, grano, previo);
  const serieN = serie(at, at0, (a) => a.fecha, () => 1, periodo, grano, previo);
  const g = (nombreHoja: string, columna: string, grupos: ReturnType<typeof agrupar>) => exportarGrupos(nombreHoja, columna, grupos);
  const clave = (d: Dimension, fn: (a: Atencion) => string) => agrupar(filtrarAtenciones(hechos, periodo, filtros), filtrarAtenciones(hechos, previo, filtros), fn, (a) => a.monto, (a) => a.costo).map((x) => ({ ...x, d }));
  const profesionales = filasProfesionales(hechos, periodo, previo, filtros, hoy);
  const hojas: HojaExcel[] = [
    { nombre: "Resumen", filas: resumen },
    {
      nombre: "Serie",
      filas: serieP.map((p, i) => ({ Desde: p.tramo, Tramo: etiquetaTramo(p.tramo, grano), Producción: p.valor, "Producción anterior": p.anterior, Atenciones: serieN[i].valor, "Atenciones anterior": serieN[i].anterior })),
      formatos: { Desde: "fecha", Producción: "clp", "Producción anterior": "clp", Atenciones: "int", "Atenciones anterior": "int" },
    },
    {
      nombre: "Profesionales",
      filas: profesionales.map((f) => ({ Profesional: f.profesional, Producción: f.produccion, "Período anterior": f.anterior, "Variación %": variacion(f.produccion, f.anterior), Atenciones: f.atenciones, Personas: f.pacientes, Ticket: f.ticket, "Margen %": f.margenPct, Citas: f.citas, "No vino": f.noVino, "Asistencia %": f.asistenciaPct, "Cobrado %": f.cobradoPct })),
      formatos: { Producción: "clp", "Período anterior": "clp", "Variación %": "pct", Ticket: "clp", "Margen %": "pct", "Asistencia %": "pct", "Cobrado %": "pct" },
    },
    g("Categorías", "Categoría", clave("categoria", (a) => a.categoria)),
    { ...g("Procedimientos", "Procedimiento", clave("procedimiento", (a) => a.procedimiento)) },
    g("Canales", "Canal", clave("origen", (a) => etiquetaOrigen(hechos.cuentas.get(a.cuentaId)?.origen))),
    g("Comunas", "Comuna", clave("comuna", (a) => hechos.cuentas.get(a.cuentaId)?.comuna ?? SIN_DATO)),
    ...(esVet ? [g("Especies", "Especie", clave("especie", (a) => a.especie ?? SIN_DATO))] : []),
    { nombre: "Atenciones", filas: filasAtenciones(at, hechos, voc, esVet), formatos: FORMATOS_ATENCIONES },
    {
      nombre: "Citas",
      filas: citas.map((c) => ({ Fecha: c.fecha, Hora: c.inicio.slice(11, 16), Día: DIAS_SEMANA[diaSemana(c.fecha)], Ficha: nombre(c.cuentaId), Profesional: c.profesional, Motivo: c.motivo, Estado: ESTADOS_CITA.find((e) => e.clave === c.estado)?.etiqueta ?? c.estado, Minutos: c.minutos })),
      formatos: { Fecha: "fecha", Minutos: "int" },
    },
    {
      nombre: voc.planes,
      filas: planes.map((p) => ({ Creado: p.creado, [voc.persona]: nombre(p.cuentaId), [voc.plan]: p.nombre, Monto: p.monto, Estado: p.estado === "ganada" ? "Aceptado" : p.estado === "perdida" ? "Perdido" : "Abierto", Etapa: p.etapa ?? "", Cerrado: p.cerrado ?? "", "Motivo de pérdida": p.motivoPerdida ?? "", Canal: etiquetaOrigen(p.origen ?? hechos.cuentas.get(p.cuentaId)?.origen) })),
      formatos: { Creado: "fecha", Cerrado: "fecha", Monto: "clp" },
    },
    {
      nombre: "Por cobrar",
      filas: saldos.map((s) => ({ Fecha: s.fecha, [voc.persona]: nombre(s.cuentaId), Profesional: s.profesional, Monto: s.monto, "Días": diasEntre(s.fecha, hoy) })),
      formatos: { Fecha: "fecha", Monto: "clp", "Días": "int" },
    },
  ];
  return hojas;
}
