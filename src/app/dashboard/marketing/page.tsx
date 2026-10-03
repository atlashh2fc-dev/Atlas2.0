import Link from "next/link";
import { connection } from "next/server";
import { CalendarRange, ChevronLeft, ChevronRight, Layers, RefreshCw, Shapes, UserPlus } from "lucide-react";

import { CalendarioMarketing } from "@/components/marketing/calendario-marketing";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { Badge, Callout, EmptyState, Field, FilterBar, PageHeader, Select, buttonClasses } from "@/components/ui";
import { getCurrentProfile } from "@/lib/auth";
import { fechaEnChile } from "@/lib/citas";
import {
  CANALES_MARKETING,
  CANAL_INFO,
  COLUMNAS_PIEZA,
  ESTADOS_MARKETING,
  ETIQUETA_ESTADO_MARKETING,
  ETIQUETA_PRODUCTO,
  PRODUCTOS_MARKETING,
  enlaceDelCalendario,
  esFechaCalendario,
  filtrosDesdeParams,
  limitesDelRango,
  rangoDelCalendario,
  resumenDelRango,
  type PiezaMarketing,
  type VistaCalendario,
} from "@/lib/marketing";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

/**
 * Marketing · calendario.
 *
 * Qué sale esta semana, por qué canal y cómo le fue a lo que ya salió. Las
 * piezas las cargan los alimentadores (Claude con el plan de la semana, Atlas
 * Lead con los correos, Meta con anuncios y métricas); acá se miran. La vista,
 * la fecha y los filtros viven en la URL para poder compartir el enlace.
 */

type Params = Record<string, string | string[] | undefined>;

const uno = (valor: string | string[] | undefined) => (Array.isArray(valor) ? valor[0] : valor);

export default async function MarketingPage({ searchParams }: { searchParams: Promise<Params> }) {
  await connection();
  const params = await searchParams;
  const hoy = fechaEnChile(new Date());
  const vista: VistaCalendario = uno(params.vista) === "mes" ? "mes" : "semana";
  const fechaParam = uno(params.fecha);
  const fecha = esFechaCalendario(fechaParam) ? fechaParam : hoy;
  const rango = rangoDelCalendario(vista, fecha);
  const limites = limitesDelRango(rango);
  const filtros = filtrosDesdeParams(params);
  const hayFiltros = Object.keys(filtros).length > 0;

  const supabase = await createClient();
  let consulta = supabase
    .from("marketing_items")
    .select(COLUMNAS_PIEZA)
    .lt("scheduled_at", limites.hasta)
    // Una campaña que empezó antes del rango y sigue en él también se ve.
    .or(`scheduled_at.gte."${limites.desde}",ends_at.gte."${limites.desde}"`)
    .order("scheduled_at")
    .limit(1000);
  if (filtros.canal) consulta = consulta.eq("channel", filtros.canal);
  if (filtros.estado) consulta = consulta.eq("status", filtros.estado);
  if (filtros.producto) consulta = consulta.eq("product", filtros.producto);
  if (filtros.campana) consulta = consulta.eq("campaign", filtros.campana);

  const [{ data, error }, { data: campanasData }, perfil] = await Promise.all([
    consulta,
    supabase.from("marketing_items").select("campaign").not("campaign", "is", null).order("campaign").limit(2000),
    getCurrentProfile(),
  ]);
  if (error) console.error("[marketing] no se pudo leer el calendario", error.message);

  const piezas = (data ?? []) as unknown as PiezaMarketing[];
  const campanas = [...new Set((campanasData ?? []).map((fila) => fila.campaign as string))];
  const resumen = resumenDelRango(piezas);
  const esAdmin = perfil?.role === "admin";

  // Solo si el rango quedó vacío vale la pena saber si el calendario está vacío del todo.
  let calendarioVacio = false;
  if (!error && piezas.length === 0 && !hayFiltros) {
    const { count } = await supabase.from("marketing_items").select("id", { count: "exact", head: true });
    calendarioVacio = (count ?? 0) === 0;
  }

  const enlace = (v: VistaCalendario, f: string) => enlaceDelCalendario(v, f, filtros);
  const enRango = hoy >= rango.desde && hoy < rango.hasta;
  const periodo = vista === "semana" ? "esta semana" : "este mes";
  const masFiltros = [filtros.producto, filtros.campana].filter(Boolean).length;

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
              {(["semana", "mes"] as const).map((opcion) => (
                <Link
                  key={opcion}
                  href={enlace(opcion, fecha)}
                  aria-current={vista === opcion ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 min-w-16 items-center justify-center rounded-md px-3 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    vista === opcion ? "bg-surface-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {opcion === "semana" ? "Semana" : "Mes"}
                </Link>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Link href={enlace(vista, rango.anterior)} className={buttonClasses({ variant: "secondary", className: "w-9 px-0" })} aria-label={vista === "semana" ? "Semana anterior" : "Mes anterior"}>
                <ChevronLeft size={16} aria-hidden="true" />
              </Link>
              <Link
                href={enlace(vista, hoy)}
                aria-current={enRango ? "date" : undefined}
                className={buttonClasses({ variant: "secondary", className: enRango ? "border-primary/50 text-primary" : "" })}
              >
                Hoy
              </Link>
              <Link href={enlace(vista, rango.siguiente)} className={buttonClasses({ variant: "secondary", className: "w-9 px-0" })} aria-label={vista === "semana" ? "Semana siguiente" : "Mes siguiente"}>
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
        }
      />

      {!error && !calendarioVacio && (
        <KpiStrip columns={3} title={vista === "semana" ? "Resumen de la semana" : "Resumen del mes"} meta={hayFiltros ? "Con los filtros aplicados" : undefined}>
          <KpiStripItem
            label="Piezas"
            value={String(resumen.total)}
            icon={Layers}
            detail={
              resumen.total === 0 ? (
                `Nada programado ${periodo}`
              ) : (
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  {ESTADOS_MARKETING.filter((estado) => resumen.porEstado[estado]).map((estado) => (
                    <Badge key={estado} tone={ETIQUETA_ESTADO_MARKETING[estado].tone} dot>
                      {resumen.porEstado[estado]} {ETIQUETA_ESTADO_MARKETING[estado].label.toLowerCase()}
                    </Badge>
                  ))}
                </span>
              )
            }
          />
          <KpiStripItem
            label="Canales"
            value={String(Object.keys(resumen.porCanal).length)}
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
          <Field label="Estado" hideLabel className="w-full sm:w-44">
            <Select name="estado" defaultValue={filtros.estado ?? ""}>
              <option value="">Todos los estados</option>
              {ESTADOS_MARKETING.map((estado) => (
                <option key={estado} value={estado}>
                  {ETIQUETA_ESTADO_MARKETING[estado].label}
                </option>
              ))}
            </Select>
          </Field>
        </FilterBar>
      )}

      {error ? (
        <Callout tone="danger">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>No pudimos leer las piezas de {periodo}. Las piezas siguen guardadas; vuelve a intentarlo en un momento.</span>
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
                <Link href={enlace(vista, rango.siguiente)} className={buttonClasses({ variant: "secondary" })}>
                  {vista === "semana" ? "Ver la semana siguiente" : "Ver el mes siguiente"}
                </Link>
              )
            }
          />
        </div>
      ) : (
        <CalendarioMarketing piezas={piezas} rango={rango} hoy={hoy} filtros={filtros} />
      )}
    </div>
  );
}
