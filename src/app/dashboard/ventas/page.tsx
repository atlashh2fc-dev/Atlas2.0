import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, BadgeDollarSign, Briefcase, CalendarClock, ChevronRight, Trophy } from "lucide-react";

import { NuevoNegocio } from "@/components/nuevo-negocio";
import { VistaSegmentada } from "@/components/vista-segmentada";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import {
  Avatar,
  Badge,
  EmptyState,
  NavTabs,
  PageHeader,
  SectionCard,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { VENTAS_POR_EDICION } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { PESTANAS_VENTAS, VISTAS_NEGOCIOS } from "@/lib/ventas-pestanas";
import { createClient } from "@/lib/supabase/server";

/** Supabase entrega las relaciones como arreglo; acá siempre es una sola fila. */
function primero<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}

const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

/** Un negocio recién llegado de la web todavía no tiene precio: decirlo es más honesto que "$0". */
function formatoMonto(numero: number): string {
  return numero > 0 ? pesos.format(numero) : "Por definir";
}
const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "short" });

/**
 * Embudo de ventas.
 *
 * Un negocio tiene monto, etapa y una próxima acción con fecha. Lo que importa
 * arriba es cuánto hay en juego y qué toca hacer hoy; el detalle vive en la
 * ficha. En Center se le vende a empresas por mes; en Dental y Vet a personas,
 * con un presupuesto de pago único: el vocabulario y el monto salen de la
 * edición.
 */
export default async function VentasPage() {
  await connection();
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();
  const { edicion } = await contextoDeMiEmpresa();
  const voc = VENTAS_POR_EDICION[edicion];
  // En Center esta lista es la otra cara del tablero de Ventas; en una clínica
  // es Presupuestos, dentro de Caja, y no lleva las pestañas de Ventas.
  const enVentas = edicion === "center";
  const mensual = voc.monto === "mensual";

  const [{ data: etapas }, { data: oportunidades }] = await Promise.all([
    supabase
      .from("sales_stages")
      .select("id, key, name, position, probability, is_won, is_lost")
      .eq("active", true)
      .order("position"),
    supabase
      .from("sales_opportunities")
      .select(
        "id, name, status, monthly_amount, one_time_amount, expected_close_date, next_action_at, next_action_note, stage_id, company_id, sales_companies(name), sales_stages(key, name, is_won, is_lost)",
      )
      .order("next_action_at", { ascending: true, nullsFirst: false })
      .limit(300),
  ]);

  const listaEtapas = etapas ?? [];
  const listaOportunidades = oportunidades ?? [];
  const abiertas = listaOportunidades.filter((negocio) => negocio.status === "abierta");
  const ganadas = listaOportunidades.filter((negocio) => negocio.status === "ganada");

  const montoDe = (negocio: { monthly_amount: unknown; one_time_amount: unknown }) =>
    Number((mensual ? negocio.monthly_amount : negocio.one_time_amount) ?? 0);
  const mensualAbierto = abiertas.reduce((total, negocio) => total + montoDe(negocio), 0);
  const mensualGanado = ganadas.reduce((total, negocio) => total + montoDe(negocio), 0);

  // El corte es el instante de la petición: el panel se lee sin caché.
  const ahora = new Date().toISOString();
  const vencidas = abiertas.filter((negocio) => negocio.next_action_at && negocio.next_action_at <= ahora);

  const porEtapa = new Map<string, { nombre: string; total: number; monto: number }>();
  for (const etapa of listaEtapas) {
    porEtapa.set(etapa.id, { nombre: etapa.name, total: 0, monto: 0 });
  }
  for (const negocio of abiertas) {
    const casilla = porEtapa.get(negocio.stage_id);
    if (!casilla) continue;
    casilla.total += 1;
    casilla.monto += montoDe(negocio);
  }

  const nombreEmpresa = (negocio: (typeof listaOportunidades)[number]) =>
    primero(negocio.sales_companies)?.name ?? "—";
  const etapaDe = (negocio: (typeof listaOportunidades)[number]) =>
    primero(negocio.sales_stages)?.name ?? "—";

  return (
    <div className="space-y-5">
      <PageHeader
        title={voc.titulo}
        icon={Briefcase}
        description={enVentas ? "Cómo van tus negocios: en qué etapa está cada uno y qué toca hacer." : voc.descripcion}
        actions={<NuevoNegocio voc={voc} />}
      />
      {enVentas && (
        <>
          <NavTabs tabs={PESTANAS_VENTAS} />
          <VistaSegmentada etiqueta="Ver negocios como" activa="lista" opciones={VISTAS_NEGOCIOS} />
        </>
      )}

      {/* Una franja de indicadores, igual que Reportes: se lee como resumen. */}
      <KpiStrip columns={3}>
        <KpiStripItem
          label="En juego"
          value={pesos.format(mensualAbierto)}
          icon={BadgeDollarSign}
          definition={{ text: `Suma del monto ${mensual ? "mensual " : ""}de los ${voc.negocios.toLowerCase()} que siguen abiertos.` }}
          detail={`${abiertas.length} ${abiertas.length === 1 ? `${voc.negocio.toLowerCase()} abierto` : `${voc.negocios.toLowerCase()} abiertos`}`}
        />
        <KpiStripItem
          label={mensual ? "Ganado" : "Aceptado"}
          value={pesos.format(mensualGanado)}
          icon={Trophy}
          tone={mensualGanado > 0 ? "good" : "default"}
          definition={{ text: `Monto ${mensual ? "mensual " : ""}ya comprometido por los ${voc.negocios.toLowerCase()} ganados.` }}
          detail={`${ganadas.length} ${ganadas.length === 1 ? `${voc.negocio.toLowerCase()} cerrado` : `${voc.negocios.toLowerCase()} cerrados`}`}
        />
        <KpiStripItem
          label="Para hoy"
          value={vencidas.length.toLocaleString("es-CL")}
          icon={CalendarClock}
          tone={vencidas.length > 0 ? "warn" : "default"}
          definition={{ text: `${voc.negocios} cuya próxima acción ya venció.` }}
          detail={`de ${abiertas.length} ${abiertas.length === 1 ? "abierto" : "abiertos"}`}
          progress={abiertas.length > 0 ? (vencidas.length / abiertas.length) * 100 : undefined}
        />
      </KpiStrip>

      {/* En Center el tablero ya es el embudo: repetirlo acá es ruido. */}
      {!enVentas && (
        <SectionCard title="Embudo" description="Cuánto hay en cada etapa, solo negocios abiertos.">
          <ol className="grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
            {listaEtapas
              .filter((etapa) => !etapa.is_won && !etapa.is_lost)
              .map((etapa, indice) => {
                const casilla = porEtapa.get(etapa.id);
                const total = casilla?.total ?? 0;
                return (
                  <li key={etapa.id} className="flex flex-col gap-1.5 bg-surface px-4 py-3.5">
                    <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <span className="flex size-5 items-center justify-center rounded-md bg-surface-muted text-[10px] font-semibold tabular-nums text-muted-foreground">
                        {indice + 1}
                      </span>
                      <span className="truncate">{etapa.name}</span>
                    </span>
                    <span className={`text-2xl font-semibold leading-none tracking-tight tabular-nums ${total > 0 ? "text-foreground" : "text-muted-foreground/60"}`}>
                      {total}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {(casilla?.monto ?? 0) > 0
                        ? `${pesos.format(casilla?.monto ?? 0)}${mensual ? "/mes" : ""}`
                        : "Sin monto todavía"}
                    </span>
                  </li>
                );
              })}
          </ol>
        </SectionCard>
      )}

      <SectionCard
        title={voc.negocios}
        description="Ordenados por la próxima acción: primero lo vencido."
        actions={
          listaOportunidades.length > 0 ? (
            <span className="rounded-md bg-surface-muted px-1.5 py-px text-[11px] font-semibold tabular-nums text-muted-foreground">
              {listaOportunidades.length.toLocaleString("es-CL")}
            </span>
          ) : undefined
        }
      >
        {listaOportunidades.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title={`Todavía no hay ${voc.negocios.toLowerCase()}`}
            description="Crea la primera con el botón de arriba, o deja que llegue desde una campaña."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Th>{voc.cuenta}</Th>
                <Th>Etapa</Th>
                <Th align="right">{mensual ? "Mensual" : "Monto"}</Th>
                <Th>Próxima acción</Th>
                <Th className="w-10"><span className="sr-only">Abrir</span></Th>
              </Thead>
              <Tbody>
                {listaOportunidades.map((negocio) => {
                  const vencida =
                    negocio.status === "abierta" && negocio.next_action_at && negocio.next_action_at <= ahora;
                  const href = `/dashboard/ventas/${negocio.id}`;
                  return (
                    <Tr key={negocio.id}>
                      <Td>
                        {/* Dos líneas por celda: la cuenta y, debajo, el negocio. */}
                        <Link href={href} className="flex min-w-0 items-center gap-3">
                          <Avatar name={nombreEmpresa(negocio)} shape="square" size="md" />
                          <span className="min-w-0">
                            <span className="block max-w-72 truncate font-medium text-foreground group-hover:text-primary">{nombreEmpresa(negocio)}</span>
                            <span className="block max-w-72 truncate text-xs text-muted-foreground">{negocio.name}</span>
                          </span>
                        </Link>
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            negocio.status === "ganada"
                              ? "success"
                              : negocio.status === "perdida"
                                ? "danger"
                                : "info"
                          }
                        >
                          {etapaDe(negocio)}
                        </Badge>
                      </Td>
                      <Td align="right" className={montoDe(negocio) > 0 ? "font-medium text-foreground" : "text-muted-foreground"}>
                        {formatoMonto(montoDe(negocio))}
                      </Td>
                      <Td>
                        {negocio.next_action_at ? (
                          <span className="block min-w-0">
                            <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${vencida ? "font-medium text-danger" : "text-foreground"}`}>
                              {vencida && <AlertTriangle size={12} aria-hidden="true" />}
                              {fecha.format(new Date(negocio.next_action_at))}
                            </span>
                            {negocio.next_action_note && (
                              <span className="block max-w-64 truncate text-xs text-muted-foreground">{negocio.next_action_note}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Sin agendar</span>
                        )}
                      </Td>
                      <Td className="w-10 pr-3">
                        <Link href={href} aria-label={`Abrir ${nombreEmpresa(negocio)}`} className="flex justify-end">
                          <ChevronRight size={16} className="text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
                        </Link>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
