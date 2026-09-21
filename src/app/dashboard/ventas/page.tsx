import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { crearOportunidad } from "@/app/actions/ventas";
import { CreatePanel } from "@/components/create-panel";
import {
  Badge,
  EmptyState,
  Field,
  MetricCard,
  Input,
  PageHeader,
  SectionCard,
  Select,
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
  const voc = VENTAS_POR_EDICION[(await contextoDeMiEmpresa()).edicion];
  const mensual = voc.monto === "mensual";

  const [{ data: etapas }, { data: oportunidades }, { data: productos }] = await Promise.all([
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
    supabase
      .from("sales_products")
      .select("code, name, monthly_price, one_time_price")
      .eq("active", true)
      .order("name"),
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
        description={voc.descripcion}
        actions={
          <CreatePanel
            label={voc.nuevo}
            title={voc.nuevo}
            description={`Si ${voc.cuenta.toLowerCase() === "empresa" ? "la empresa" : `el ${voc.cuenta.toLowerCase()}`} ya existe, se reutiliza. El precio sale del catálogo salvo que escribas otro.`}
            action={crearOportunidad}
            submitLabel={voc.nuevo.replace(/^Nuev[oa] /, "Crear ")}
            successLabel={`${voc.negocio} creado`}
          >
            <Field label={voc.cuenta}>
              <Input name="empresa" required placeholder={voc.cuentaPlaceholder} data-autofocus />
            </Field>
            <Field label="RUT (opcional)">
              <Input name="rut" placeholder="76.123.456-7" />
            </Field>
            <Field label={voc.negocio}>
              <Input name="nombre" required placeholder={voc.negocioPlaceholder} />
            </Field>
            <Field label={voc.producto}>
              <Select name="producto" defaultValue="">
                <option value="">Sin {voc.producto.toLowerCase()} del catálogo</option>
                {(productos ?? []).map((producto) => (
                  <option key={producto.code} value={producto.code}>
                    {producto.name}
                    {mensual
                      ? producto.monthly_price
                        ? ` · ${pesos.format(Number(producto.monthly_price))}/mes`
                        : ""
                      : producto.one_time_price
                        ? ` · ${pesos.format(Number(producto.one_time_price))}`
                        : ""}
                  </option>
                ))}
              </Select>
            </Field>
            {mensual ? (
              <Field label="Monto mensual (deja vacío para usar el del catálogo)">
                <Input name="monto_mensual" inputMode="numeric" placeholder="69990" />
              </Field>
            ) : (
              <Field label="Monto del presupuesto">
                <Input name="monto_unico" inputMode="numeric" placeholder="1850000" />
              </Field>
            )}
            {!voc.personas && (
              <Field label="Contacto">
                <Input name="contacto" placeholder="María Soto" />
              </Field>
            )}
            <Field label={voc.personas ? "Correo" : "Correo del contacto"}>
              <Input name="contacto_email" type="email" placeholder="maria@laespiga.cl" />
            </Field>
            <Field label="WhatsApp o teléfono">
              <Input name="contacto_telefono" placeholder="+56 9 1111 1111" />
            </Field>
            <Field label="Cierre estimado">
              <Input name="cierre_estimado" type="date" />
            </Field>
            <Field label="Origen">
              <Select name="origen" defaultValue="">
                <option value="">Sin origen</option>
                {voc.origenes.map((origen) => (
                  <option key={origen.value} value={origen.value}>
                    {origen.label}
                  </option>
                ))}
              </Select>
            </Field>
          </CreatePanel>
        }
      />

      {/* Las métricas usan la tarjeta del estándar, igual que el resto de los tableros. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="En juego"
          value={pesos.format(mensualAbierto)}
          hint={`${abiertas.length} ${abiertas.length === 1 ? `${voc.negocio.toLowerCase()} abierto` : `${voc.negocios.toLowerCase()} abiertos`}`}
          tooltip={`Suma del monto ${mensual ? "mensual " : ""}de los ${voc.negocios.toLowerCase()} que siguen abiertos.`}
        />
        <MetricCard
          label={mensual ? "Ganado" : "Aceptado"}
          value={pesos.format(mensualGanado)}
          hint={`${ganadas.length} ${ganadas.length === 1 ? `${voc.negocio.toLowerCase()} cerrado` : `${voc.negocios.toLowerCase()} cerrados`}`}
          tone={mensualGanado > 0 ? "good" : "default"}
          tooltip={`Monto ${mensual ? "mensual " : ""}ya comprometido por los ${voc.negocios.toLowerCase()} ganados.`}
        />
        <MetricCard
          label="Para hoy"
          value={vencidas.length}
          hint={`de ${abiertas.length} ${abiertas.length === 1 ? "abierto" : "abiertos"}`}
          tone={vencidas.length > 0 ? "warn" : "default"}
          tooltip={`${voc.negocios} cuya próxima acción ya venció.`}
        />
      </div>

      <SectionCard title="Embudo" description="Cuánto hay en cada etapa, solo negocios abiertos.">
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-5">
          {listaEtapas
            .filter((etapa) => !etapa.is_won && !etapa.is_lost)
            .map((etapa) => {
              const casilla = porEtapa.get(etapa.id);
              return (
                <div key={etapa.id} className="rounded-lg border border-border bg-surface p-4 shadow-sm">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{etapa.name}</p>
                  <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
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

      <SectionCard title={voc.negocios} description="Ordenados por la próxima acción: primero lo vencido.">
        {listaOportunidades.length === 0 ? (
          <EmptyState
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
