import Link from "next/link";
import { connection } from "next/server";
import { HandCoins, ShoppingBag, Wallet } from "lucide-react";

import { registrarPropina, venderProducto } from "@/app/actions/mostrador";
import { CreatePanel } from "@/components/create-panel";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { EmptyState, Field, Input, NavTabs, PageHeader, SectionCard, Select, Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui";
import { ZONA_CLINICA, esFechaValida, fechaEnChile, sumarDias } from "@/lib/citas";
import { ATENCION_POR_EDICION, VENTAS_POR_EDICION, clinicaDe } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

/**
 * Mostrador y comisiones.
 *
 * Lo que se vende en el mesón (productos, con descuento de stock), las
 * propinas de cada profesional, y la liquidación del período: cuánto
 * atendió cada uno, su comisión por servicios y productos, sus propinas y
 * el total a pagarle. Los porcentajes se definen en Equipo.
 */

type Liquidacion = {
  profesional_id: string;
  nombre: string;
  color: string;
  atenciones: number;
  servicios: number;
  comision_servicios: number;
  productos: number;
  comision_productos: number;
  propinas: number;
  total: number;
};

const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const fechaHora = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const mesLargo = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", month: "long", year: "numeric" });
const MEDIOS = [
  { valor: "efectivo", etiqueta: "Efectivo" },
  { valor: "debito", etiqueta: "Débito" },
  { valor: "credito", etiqueta: "Crédito" },
  { valor: "transferencia", etiqueta: "Transferencia" },
  { valor: "otro", etiqueta: "Otro" },
];

function finDeMes(inicio: string): string {
  const [anio, mes] = inicio.split("-").map(Number);
  return new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
}

export default async function MostradorPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  await connection();
  const { edicion } = await contextoDeMiEmpresa();
  const clinica = clinicaDe(edicion);
  const at = ATENCION_POR_EDICION[clinica];
  const ventas = VENTAS_POR_EDICION[clinica];
  const hoy = fechaEnChile(new Date());
  const { mes } = await searchParams;
  const desde = mes && /^\d{4}-\d{2}$/.test(mes) && esFechaValida(`${mes}-01`) ? `${mes}-01` : `${hoy.slice(0, 7)}-01`;
  const hasta = finDeMes(desde);
  const mesAnterior = sumarDias(desde, -1).slice(0, 7);
  const mesSiguiente = sumarDias(hasta, 1).slice(0, 7);

  const supabase = await createClient();
  const [{ data: liquidacionData, error }, { data: productosData }, { data: profesionalesData }, { data: ventasData }, { data: propinasData }] = await Promise.all([
    supabase.rpc("liquidacion_de_profesionales", { p_desde: desde, p_hasta: hasta }),
    supabase.from("insumos").select("id, nombre, precio_venta, stock").eq("activo", true).order("nombre").limit(400),
    supabase.from("profesionales").select("id, nombre").eq("activo", true).order("orden").order("nombre"),
    supabase.from("ventas_productos").select("id, nombre, cantidad, total, medio, vendido_at, profesional_id").gte("vendido_at", `${desde}T00:00:00-03:00`).lte("vendido_at", `${hasta}T23:59:59-03:00`).order("vendido_at", { ascending: false }).limit(200),
    supabase.from("propinas").select("id, monto, medio, recibida_at, profesional_id, nota").gte("recibida_at", `${desde}T00:00:00-03:00`).lte("recibida_at", `${hasta}T23:59:59-03:00`).order("recibida_at", { ascending: false }).limit(200),
  ]);
  const liquidacion = ((liquidacionData ?? []) as Liquidacion[]).map((fila) => ({
    ...fila,
    atenciones: Number(fila.atenciones),
    servicios: Number(fila.servicios),
    comision_servicios: Number(fila.comision_servicios),
    productos: Number(fila.productos),
    comision_productos: Number(fila.comision_productos),
    propinas: Number(fila.propinas),
    total: Number(fila.total),
  }));
  const productos = (productosData ?? []) as { id: string; nombre: string; precio_venta: number | null; stock: number | null }[];
  const profesionales = (profesionalesData ?? []) as { id: string; nombre: string }[];
  const nombreDe = new Map(profesionales.map((profesional) => [profesional.id, profesional.nombre]));
  const ventasMes = (ventasData ?? []) as { id: string; nombre: string; cantidad: number; total: number; medio: string; vendido_at: string; profesional_id: string | null }[];
  const propinasMes = (propinasData ?? []) as { id: string; monto: number; medio: string; recibida_at: string; profesional_id: string; nota: string | null }[];
  const totalServicios = liquidacion.reduce((suma, fila) => suma + fila.servicios, 0);
  const totalProductos = ventasMes.reduce((suma, venta) => suma + Number(venta.total), 0);
  const totalPropinas = propinasMes.reduce((suma, propina) => suma + Number(propina.monto), 0);
  const totalAPagar = liquidacion.reduce((suma, fila) => suma + fila.total, 0);
  const titulo = mesLargo.format(new Date(`${desde}T12:00:00Z`));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mostrador y comisiones"
        icon={Wallet}
        description={`Productos vendidos, propinas y lo que corresponde pagarle a cada ${at.profesional.toLowerCase()} en ${titulo}.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CreatePanel label="Propina" title="Registrar propina" description="Queda en la liquidación del profesional." action={registrarPropina} submitLabel="Registrar" successLabel="Propina registrada">
              <Field label={`¿Para qué ${at.profesional.toLowerCase()}?`}>
                <Select name="profesional_id" required defaultValue="">
                  <option value="" disabled>Elige…</option>
                  {profesionales.map((profesional) => <option key={profesional.id} value={profesional.id}>{profesional.nombre}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Monto"><Input name="monto" required inputMode="numeric" placeholder="2000" /></Field>
                <Field label="Medio">
                  <Select name="medio" defaultValue="efectivo">{MEDIOS.map((medio) => <option key={medio.valor} value={medio.valor}>{medio.etiqueta}</option>)}</Select>
                </Field>
              </div>
            </CreatePanel>
            <CreatePanel label="Vender producto" title="Vender producto" description="Descuenta del stock y suma a la comisión de quien vendió." action={venderProducto} submitLabel="Registrar venta" successLabel="Venta registrada">
              <Field label="Producto">
                <Select name="insumo_id" required defaultValue="">
                  <option value="" disabled>Elige…</option>
                  {productos.map((producto) => (
                    <option key={producto.id} value={producto.id}>
                      {producto.nombre}{producto.precio_venta ? ` · ${pesos.format(producto.precio_venta)}` : ""}{producto.stock !== null ? ` · stock ${producto.stock}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Cantidad"><Input name="cantidad" inputMode="decimal" defaultValue="1" /></Field>
                <Field label="Precio unitario"><Input name="precio" inputMode="numeric" placeholder="El de la lista" /></Field>
                <Field label="Medio">
                  <Select name="medio" defaultValue="debito">{MEDIOS.map((medio) => <option key={medio.valor} value={medio.valor}>{medio.etiqueta}</option>)}</Select>
                </Field>
              </div>
              <Field label="¿Quién vendió? (para su comisión)">
                <Select name="profesional_id" defaultValue="">
                  <option value="">Nadie en particular</option>
                  {profesionales.map((profesional) => <option key={profesional.id} value={profesional.id}>{profesional.nombre}</option>)}
                </Select>
              </Field>
            </CreatePanel>
          </div>
        }
      />
      <NavTabs
        tabs={[
          { label: "Por cobrar", href: "/dashboard/caja" },
          { label: "Mostrador y comisiones", href: "/dashboard/caja/mostrador" },
          { label: ventas.negocios, href: "/dashboard/ventas" },
        ]}
      />

      <nav aria-label="Período" className="flex items-center gap-2 text-sm">
        <Link href={`/dashboard/caja/mostrador?mes=${mesAnterior}`} className="inline-flex min-h-9 items-center rounded-lg border border-border px-3 text-muted-foreground hover:text-foreground">← Mes anterior</Link>
        <span className="font-medium capitalize">{titulo}</span>
        {hasta < hoy && <Link href={`/dashboard/caja/mostrador?mes=${mesSiguiente}`} className="inline-flex min-h-9 items-center rounded-lg border border-border px-3 text-muted-foreground hover:text-foreground">Mes siguiente →</Link>}
      </nav>

      <KpiStrip>
        <KpiStripItem label="Servicios atendidos" value={pesos.format(totalServicios)} icon={Wallet} detail="Según las atenciones registradas" />
        <KpiStripItem label="Productos vendidos" value={pesos.format(totalProductos)} icon={ShoppingBag} detail={`${ventasMes.length} ventas`} />
        <KpiStripItem label="Propinas" value={pesos.format(totalPropinas)} icon={HandCoins} detail={`${propinasMes.length} propinas`} />
        <KpiStripItem label="A pagar al equipo" value={pesos.format(totalAPagar)} icon={HandCoins} detail="Comisiones + propinas" />
      </KpiStrip>

      <SectionCard title="Liquidación" description={`Comisión según el porcentaje de cada ${at.profesional.toLowerCase()} (en Equipo). Las propinas van completas.`}>
        {error ? (
          <p className="text-sm text-danger">No se pudo calcular la liquidación. Vuelve a cargar.</p>
        ) : liquidacion.length === 0 ? (
          <EmptyState icon={Wallet} title="Sin movimientos en el período" description="Cuando se registren atenciones, ventas o propinas, aparecen acá." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Th>{at.profesional}</Th>
                <Th align="right">Atenciones</Th>
                <Th align="right">Servicios</Th>
                <Th align="right">Comisión servicios</Th>
                <Th align="right">Productos</Th>
                <Th align="right">Comisión productos</Th>
                <Th align="right">Propinas</Th>
                <Th align="right">Total a pagar</Th>
              </Thead>
              <Tbody>
                {liquidacion.map((fila) => (
                  <Tr key={fila.profesional_id}>
                    <Td>
                      <span className="inline-flex items-center gap-2 whitespace-nowrap font-medium">
                        <span className="size-2 rounded-full" style={{ backgroundColor: fila.color }} aria-hidden="true" /> {fila.nombre}
                      </span>
                    </Td>
                    <Td align="right" className="tabular-nums">{fila.atenciones}</Td>
                    <Td align="right" className="tabular-nums">{pesos.format(fila.servicios)}</Td>
                    <Td align="right" className="tabular-nums">{pesos.format(fila.comision_servicios)}</Td>
                    <Td align="right" className="tabular-nums">{pesos.format(fila.productos)}</Td>
                    <Td align="right" className="tabular-nums">{pesos.format(fila.comision_productos)}</Td>
                    <Td align="right" className="tabular-nums">{pesos.format(fila.propinas)}</Td>
                    <Td align="right" className="font-semibold tabular-nums">{pesos.format(fila.total)}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Productos vendidos" description={`${ventasMes.length} en ${titulo}`}>
          {ventasMes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay ventas. Usa «Vender producto».</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {ventasMes.slice(0, 30).map((venta) => (
                <li key={venta.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{venta.cantidad} × {venta.nombre}</span>
                    <span className="block text-xs text-muted-foreground">{fechaHora.format(new Date(venta.vendido_at))}{venta.profesional_id ? ` · ${nombreDe.get(venta.profesional_id) ?? ""}` : ""}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{pesos.format(Number(venta.total))}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Propinas" description={`${propinasMes.length} en ${titulo}`}>
          {propinasMes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay propinas. Usa «Propina».</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {propinasMes.slice(0, 30).map((propina) => (
                <li key={propina.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{nombreDe.get(propina.profesional_id) ?? "—"}</span>
                    <span className="block text-xs text-muted-foreground">{fechaHora.format(new Date(propina.recibida_at))} · {propina.medio}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{pesos.format(Number(propina.monto))}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
