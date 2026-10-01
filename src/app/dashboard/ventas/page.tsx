import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { BadgeDollarSign, Briefcase, CalendarClock, Filter, Trophy } from "lucide-react";

import { NuevoNegocio } from "@/components/nuevo-negocio";
import { VistaSegmentada } from "@/components/vista-segmentada";
import {
  Badge,
  EmptyState,
  MetricCard,
  NavTabs,
  PageHeader,
  SectionCard,
  Table,
  TableEmpty,
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
const fecha = new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" });

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
  noStore();
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
        description={enVentas ? "Cómo van tus negocios: en qué etapa está cada uno y qué toca hacer." : voc.descripcion}
        actions={<NuevoNegocio voc={voc} />}
      />
      {enVentas && (
        <>
          <NavTabs tabs={PESTANAS_VENTAS} />
          <VistaSegmentada etiqueta="Ver negocios como" activa="lista" opciones={VISTAS_NEGOCIOS} />
        </>
      )}

      {/* Las métricas usan la tarjeta del estándar, igual que el resto de los tableros. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="En juego"
          value={pesos.format(mensualAbierto)}
          hint={`${abiertas.length} ${abiertas.length === 1 ? `${voc.negocio.toLowerCase()} abierto` : `${voc.negocios.toLowerCase()} abiertos`}`}
          tooltip={`Suma del monto ${mensual ? "mensual " : ""}de los ${voc.negocios.toLowerCase()} que siguen abiertos.`}
          icon={BadgeDollarSign}
          iconTone="green"
        />
        <MetricCard
          label={mensual ? "Ganado" : "Aceptado"}
          value={pesos.format(mensualGanado)}
          hint={`${ganadas.length} ${ganadas.length === 1 ? `${voc.negocio.toLowerCase()} cerrado` : `${voc.negocios.toLowerCase()} cerrados`}`}
          tone={mensualGanado > 0 ? "good" : "default"}
          tooltip={`Monto ${mensual ? "mensual " : ""}ya comprometido por los ${voc.negocios.toLowerCase()} ganados.`}
          icon={Trophy}
          iconTone="green"
        />
        <MetricCard
          label="Para hoy"
          value={vencidas.length}
          hint={`de ${abiertas.length} ${abiertas.length === 1 ? "abierto" : "abiertos"}`}
          tone={vencidas.length > 0 ? "warn" : "good"}
          tooltip={`${voc.negocios} cuya próxima acción ya venció.`}
          icon={CalendarClock}
          iconTone="amber"
        />
      </div>

      {/* En Center el tablero ya es el embudo: repetirlo acá es ruido. */}
      {!enVentas && (
        <SectionCard title="Embudo" description="Cuánto hay en cada etapa, solo negocios abiertos." icon={Filter} tone="rose">
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-5">
            {listaEtapas
              .filter((etapa) => !etapa.is_won && !etapa.is_lost)
              .map((etapa) => {
                const casilla = porEtapa.get(etapa.id);
                return (
                  <div
                    key={etapa.id}
                    className={`rounded-lg border border-border border-l-2 bg-background px-3 py-2.5 ${(casilla?.total ?? 0) > 0 ? "border-l-[var(--tone-rose)]" : "border-l-border-strong"}`}
                  >
                    <p className="text-xs font-medium text-muted-foreground">{etapa.name}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                      {casilla?.total ?? 0}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {(casilla?.monto ?? 0) > 0
                        ? `${pesos.format(casilla?.monto ?? 0)}${mensual ? "/mes" : ""}`
                        : "sin monto todavía"}
                    </p>
                  </div>
                );
              })}
          </div>
        </SectionCard>
      )}

      <SectionCard title={voc.negocios} description="Ordenados por la próxima acción: primero lo vencido." icon={Briefcase} tone="green">
        {listaOportunidades.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title={`Todavía no hay ${voc.negocios.toLowerCase()}`}
            description="Crea la primera con el botón de arriba, o deja que llegue desde una campaña."
          />
        ) : (
          <Table>
            <Thead>
              <Th>{voc.cuenta}</Th>
              <Th>{voc.negocio}</Th>
              <Th>Etapa</Th>
              <Th>{mensual ? "Mensual" : "Monto"}</Th>
              <Th>Próxima acción</Th>
            </Thead>
            <Tbody>
              {listaOportunidades.length === 0 && (
                <TableEmpty colSpan={5}>Sin {voc.negocios.toLowerCase()}.</TableEmpty>
              )}
              {listaOportunidades.map((negocio) => {
                const vencida =
                  negocio.status === "abierta" && negocio.next_action_at && negocio.next_action_at <= ahora;
                return (
                  <Tr key={negocio.id}>
                    <Td className="font-medium text-foreground">
                      <Link className="hover:underline" href={`/dashboard/ventas/${negocio.id}`}>
                        {nombreEmpresa(negocio)}
                      </Link>
                    </Td>
                    <Td className="text-muted-foreground">{negocio.name}</Td>
                    <Td>
                      <Badge
                        tone={
                          negocio.status === "ganada"
                            ? "success"
                            : negocio.status === "perdida"
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {etapaDe(negocio)}
                      </Badge>
                    </Td>
                    <Td className={montoDe(negocio) > 0 ? undefined : "text-muted-foreground"}>
                      {formatoMonto(montoDe(negocio))}
                    </Td>
                    <Td className={vencida ? "text-danger" : "text-muted-foreground"}>
                      {negocio.next_action_at
                        ? `${fecha.format(new Date(negocio.next_action_at))}${negocio.next_action_note ? ` · ${negocio.next_action_note}` : ""}`
                        : "Sin agendar"}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
