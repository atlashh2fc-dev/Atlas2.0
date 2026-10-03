import Link from "next/link";
import { connection } from "next/server";
import { CalendarRange, ChevronLeft, ChevronRight, Layers, RefreshCw, Shapes, UserPlus } from "lucide-react";

import { CalendarioMarketing } from "@/components/marketing/calendario-marketing";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { Callout, EmptyState, Field, FilterBar, PageHeader, Select, StatusDot, buttonClasses } from "@/components/ui";
import { getCurrentProfile } from "@/lib/auth";
import { fechaEnChile, sumarDias } from "@/lib/citas";
import {
  CANALES_MARKETING,
  CANAL_INFO,
  COLUMNAS_PIEZA,
  DIAS_PROXIMOS,
  ESTADOS_MARKETING,
  ETIQUETA_ESTADO_MARKETING,
  ETIQUETA_PRODUCTO,
  ETIQUETA_VISTA,
  PRODUCTOS_MARKETING,
  VISTAS_CALENDARIO,
  agruparPublicaciones,
  enlaceDelCalendario,
  esFechaCalendario,
  filtrosDesdeParams,
  limitesDelRango,
  rangoDelCalendario,
  resumenDelRango,
  vistaDesdeParam,
  type EstadoMarketing,
  type PiezaMarketing,
  type VistaCalendario,
} from "@/lib/marketing";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

/**
 * Marketing · calendario.
 *
 * Qué sale en los próximos días, por qué canal y cómo le fue a lo que ya
 * salió. Las piezas las cargan los alimentadores (Claude con el plan de la
 * semana, Atlas Lead con los correos, Meta con anuncios y métricas); acá se
 * miran. La vista, la fecha y los filtros viven en la URL para poder
 * compartir el enlace.
 */

type Params = Record<string, string | string[] | undefined>;

const uno = (valor: string | string[] | undefined) => (Array.isArray(valor) ? valor[0] : valor);

/** Botón de atajo o de filtro: 44 px de alto en el teléfono, compacto en escritorio. */
const PASTILLA =
  "inline-flex h-11 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8";
const PASTILLA_ACTIVA = "border-primary/60 bg-primary/10 text-foreground";
const PASTILLA_INACTIVA = "border-border bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground";

export default async function MarketingPage({ searchParams }: { searchParams: Promise<Params> }) {
  await connection();
  const params = await searchParams;
  const ahora = new Date();
  const hoy = fechaEnChile(ahora);
  const vista = vistaDesdeParam(uno(params.vista));
  const fechaParam = uno(params.fecha);
  const fecha = esFechaCalendario(fechaParam) ? fechaParam : hoy;
  const rango = rangoDelCalendario(vista, fecha);
  const limites = limitesDelRango(rango);
  const filtros = filtrosDesdeParams(params);
  const hayFiltros = Object.keys(filtros).length > 0;

  const supabase = await createClient();
  // El estado no va a la consulta: los conteos por estado de la cabecera
  // tienen que verse completos aunque haya un estado elegido.
  let consulta = supabase
    .from("marketing_items")
    .select(COLUMNAS_PIEZA)
    .lt("scheduled_at", limites.hasta)
    // Una campaña que empezó antes del rango y sigue en él también se ve.
    .or(`scheduled_at.gte."${limites.desde}",ends_at.gte."${limites.desde}"`)
    .order("scheduled_at")
    .limit(1000);
  if (filtros.canal) consulta = consulta.eq("channel", filtros.canal);
  if (filtros.producto) consulta = consulta.eq("product", filtros.producto);
  if (filtros.campana) consulta = consulta.eq("campaign", filtros.campana);

  const [{ data, error }, { data: campanasData }, perfil] = await Promise.all([
    consulta,
    supabase.from("marketing_items").select("campaign").not("campaign", "is", null).order("campaign").limit(2000),
    getCurrentProfile(),
  ]);
  if (error) console.error("[marketing] no se pudo leer el calendario", error.message);

  const delRango = (data ?? []) as unknown as PiezaMarketing[];
  const piezas = filtros.estado ? delRango.filter((pieza) => pieza.status === filtros.estado) : delRango;
  const campanas = [...new Set((campanasData ?? []).map((fila) => fila.campaign as string))];
  const porEstado = resumenDelRango(delRango).porEstado;
  const resumen = resumenDelRango(piezas);
  const publicaciones = agruparPublicaciones(piezas).length;
  const esAdmin = perfil?.role === "admin";

  // Solo si el rango quedó vacío vale la pena saber si el calendario está vacío del todo.
  let calendarioVacio = false;
  if (!error && delRango.length === 0 && !hayFiltros) {
    const { count } = await supabase.from("marketing_items").select("id", { count: "exact", head: true });
    calendarioVacio = (count ?? 0) === 0;
  }

  const enlace = (v: VistaCalendario, f: string) => enlaceDelCalendario(v, f, filtros);
  const enRango = hoy >= rango.desde && hoy < rango.hasta;
  const desdeHoy = vista === "proximos" && fecha === hoy;
  const periodo = vista === "semana" ? "esta semana" : vista === "mes" ? "este mes" : desdeHoy ? `en los próximos ${DIAS_PROXIMOS} días` : "en estas dos semanas";
  const tituloResumen =
    vista === "semana" ? "Resumen de la semana" : vista === "mes" ? "Resumen del mes" : desdeHoy ? `Resumen de los próximos ${DIAS_PROXIMOS} días` : "Resumen de las dos semanas";
  const masFiltros = [filtros.producto, filtros.campana].filter(Boolean).length;
  const paso = {
    proximos: [`${DIAS_PROXIMOS} días antes`, `${DIAS_PROXIMOS} días después`],
    semana: ["Semana anterior", "Semana siguiente"],
    mes: ["Mes anterior", "Mes siguiente"],
  }[vista];

  // Atajos de fecha: la semana en curso y la que viene, siempre en vista semanal.
  const lunesDeHoy = rangoDelCalendario("semana", hoy).desde;
  const atajos = [
    { etiqueta: "Esta semana", fecha: hoy, lunes: lunesDeHoy },
    { etiqueta: "Próxima semana", fecha: sumarDias(lunesDeHoy, 7), lunes: sumarDias(lunesDeHoy, 7) },
  ];
  // Los estados con piezas en el rango, y el elegido aunque quede en cero.
  const estadosVisibles = ESTADOS_MARKETING.filter((estado) => porEstado[estado] || filtros.estado === estado);
  const enlaceEstado = (estado: EstadoMarketing | undefined) => enlaceDelCalendario(vista, fecha, { ...filtros, estado });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Marketing"
        icon={CalendarRange}
        description={rango.titulo}
        meta={<span>Publicaciones, correos y anuncios por canal · horas de Chile</span>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Vista del calendario" className="inline-flex rounded-lg border border-border bg-surface p-0.5 shadow-sm">
              {VISTAS_CALENDARIO.map((opcion) => (
                <Link
                  key={opcion}
                  // Al cambiar a «Próximos» se parte de hoy: la vista es "lo que viene".
                  href={enlace(opcion, opcion === "proximos" ? hoy : fecha)}
                  aria-current={vista === opcion ? "page" : undefined}
                  className={cn(
                    "inline-flex h-11 min-w-16 items-center justify-center rounded-md px-3 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8",
                    vista === opcion ? "bg-surface-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {ETIQUETA_VISTA[opcion]}
                </Link>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Link href={enlace(vista, rango.anterior)} className={buttonClasses({ variant: "secondary", className: "h-11 w-11 px-0 md:h-9 md:w-9" })} aria-label={paso[0]}>
                <ChevronLeft size={16} aria-hidden="true" />
              </Link>
              <Link
                href={enlace(vista, hoy)}
                aria-current={enRango ? "date" : undefined}
                className={buttonClasses({ variant: "secondary", className: cn("h-11 md:h-9", enRango ? "border-primary/50 text-primary" : "") })}
              >
                Hoy
              </Link>
              <Link href={enlace(vista, rango.siguiente)} className={buttonClasses({ variant: "secondary", className: "h-11 w-11 px-0 md:h-9 md:w-9" })} aria-label={paso[1]}>
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
        }
      />

      {!error && !calendarioVacio && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <nav aria-label="Atajos de fecha" className="flex flex-wrap items-center gap-1.5">
            {atajos.map((atajo) => {
              const activo = vista === "semana" && rango.desde === atajo.lunes;
              return (
                <Link
                  key={atajo.etiqueta}
                  href={enlace("semana", atajo.fecha)}
                  aria-current={activo ? "page" : undefined}
                  className={cn(PASTILLA, activo ? PASTILLA_ACTIVA : PASTILLA_INACTIVA)}
                >
                  {atajo.etiqueta}
                </Link>
              );
            })}
          </nav>
          <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap items-center gap-1.5">
            <Link href={enlaceEstado(undefined)} aria-current={!filtros.estado ? "true" : undefined} className={cn(PASTILLA, !filtros.estado ? PASTILLA_ACTIVA : PASTILLA_INACTIVA)}>
              Todas
              <span className="tabular-nums text-muted-foreground">{delRango.length}</span>
            </Link>
            {estadosVisibles.map((estado) => {
              const activo = filtros.estado === estado;
              const { label, tone } = ETIQUETA_ESTADO_MARKETING[estado];
              const cuantas = porEstado[estado] ?? 0;
              return (
                <Link
                  key={estado}
                  // Tocar el estado elegido lo quita: vuelve a "Todas".
                  href={enlaceEstado(activo ? undefined : estado)}
                  aria-current={activo ? "true" : undefined}
                  aria-label={`${label}: ${cuantas} ${cuantas === 1 ? "pieza" : "piezas"}${activo ? " (filtro activo; tocar para quitarlo)" : ""}`}
                  className={cn(PASTILLA, activo ? PASTILLA_ACTIVA : PASTILLA_INACTIVA)}
                >
                  <StatusDot tone={tone} className="h-1.5 w-1.5" />
                  {label}
                  <span className="tabular-nums text-muted-foreground">{cuantas}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {!error && !calendarioVacio && (
        <KpiStrip columns={3} title={tituloResumen} meta={hayFiltros ? "Con los filtros aplicados" : undefined}>
          <KpiStripItem
            label="Piezas"
            value={String(resumen.total)}
            icon={Layers}
            definition={{
              text: "Cada red cuenta aparte: un reel en Instagram y en Facebook son 2 piezas y una sola publicación en el calendario.",
            }}
            detail={
              resumen.total === 0
                ? `Nada programado ${periodo}`
                : [
                    publicaciones === 1 ? "1 publicación en el calendario" : `${publicaciones} publicaciones en el calendario`,
                    resumen.planes > 0 ? (resumen.planes === 1 ? "1 espacio de plan" : `${resumen.planes} espacios de plan`) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
            }
          />
          <KpiStripItem
            label="Canales"
            value={String(resumen.canales)}
            icon={Shapes}
            detail={
              resumen.total === 0 ? (
                "Sin piezas en el rango"
              ) : (
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  {CANALES_MARKETING.filter((canal) => resumen.porCanal[canal]).map((canal) => (
                    <span key={canal} className="inline-flex items-center gap-1.5 text-xs text-foreground">
                      <span aria-hidden="true" className="size-2 shrink-0 rounded-sm" style={{ background: `var(${CANAL_INFO[canal].tono})` }} />
                      {CANAL_INFO[canal].label} <span className="tabular-nums text-muted-foreground">{resumen.porCanal[canal]}</span>
                    </span>
                  ))}
                </span>
              )
            }
          />
          <KpiStripItem
            label="Leads"
            value={resumen.leads.toLocaleString("es-CL")}
            icon={UserPlus}
            tone={resumen.leads > 0 ? "good" : "default"}
            definition={{ text: "Suma de los leads que Meta y Atlas Lead reportaron en las piezas del rango visible." }}
            detail={resumen.leads > 0 ? "Reportados por las piezas del rango" : "Todavía sin leads reportados"}
          />
        </KpiStrip>
      )}

      {!calendarioVacio && (
        <FilterBar
          more={
            <>
              <Field label="Producto" hideLabel className="w-full sm:w-52">
                <Select name="producto" defaultValue={filtros.producto ?? ""}>
                  <option value="">Todos los productos</option>
                  {PRODUCTOS_MARKETING.map((producto) => (
                    <option key={producto} value={producto}>
                      {ETIQUETA_PRODUCTO[producto]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Campaña" hideLabel className="w-full sm:w-64">
                <Select name="campana" defaultValue={filtros.campana ?? ""}>
                  <option value="">Todas las campañas</option>
                  {campanas.map((campana) => (
                    <option key={campana} value={campana}>
                      {campana}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          }
          moreActive={masFiltros}
        >
          <input type="hidden" name="vista" value={vista} />
          <input type="hidden" name="fecha" value={fecha} />
          {/* El estado se elige con las pastillas de arriba; acá solo se conserva. */}
          {filtros.estado && <input type="hidden" name="estado" value={filtros.estado} />}
          <Field label="Canal" hideLabel className="w-full sm:w-52">
            <Select name="canal" defaultValue={filtros.canal ?? ""}>
              <option value="">Todos los canales</option>
              {CANALES_MARKETING.map((canal) => (
                <option key={canal} value={canal}>
                  {CANAL_INFO[canal].label}
                </option>
              ))}
            </Select>
          </Field>
        </FilterBar>
      )}

      {error ? (
        <Callout tone="danger">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>No pudimos leer el calendario. Las piezas siguen guardadas; vuelve a intentarlo en un momento.</span>
            <Link href={enlace(vista, fecha)} className={buttonClasses({ variant: "secondary", size: "sm" })}>
              <RefreshCw size={14} aria-hidden="true" />
              Reintentar
            </Link>
          </div>
        </Callout>
      ) : calendarioVacio ? (
        <div className="atlas-panel rounded-xl border border-border bg-surface shadow-sm">
          <EmptyState
            icon={CalendarRange}
            title="El calendario todavía está vacío"
            description="Las piezas llegan solas cuando el equipo de marketing envía su plan: reels, publicaciones en grupos, correos y anuncios, cada una con su estado y sus resultados."
            action={
              esAdmin ? (
                <Link href="/dashboard/admin/integraciones" className={buttonClasses({ variant: "secondary" })}>
                  Ver la conexión en Integraciones
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : piezas.length === 0 ? (
        <div className="atlas-panel rounded-xl border border-border bg-surface shadow-sm">
          <EmptyState
            icon={CalendarRange}
            title={hayFiltros ? "Ninguna pieza coincide con los filtros" : `Nada programado ${periodo}`}
            description={
              hayFiltros
                ? "Prueba con otro canal o estado, o quita los filtros para ver todo el período."
                : "Revisa el período siguiente o vuelve a hoy para ver lo que viene."
            }
            action={
              hayFiltros ? (
                <Link href={enlaceDelCalendario(vista, fecha, {})} className={buttonClasses({ variant: "secondary" })}>
                  Quitar filtros
                </Link>
              ) : !enRango ? (
                <Link href={enlace(vista, hoy)} className={buttonClasses({ variant: "secondary" })}>
                  Ir a hoy
                </Link>
              ) : (
                <Link href={enlace(vista === "proximos" ? "mes" : vista, vista === "proximos" ? hoy : rango.siguiente)} className={buttonClasses({ variant: "secondary" })}>
                  {vista === "semana" ? "Ver la semana siguiente" : vista === "mes" ? "Ver el mes siguiente" : "Ver el mes completo"}
                </Link>
              )
            }
          />
        </div>
      ) : (
        <CalendarioMarketing piezas={piezas} rango={rango} hoy={hoy} ahora={ahora.toISOString()} filtros={filtros} />
      )}
    </div>
  );
}
