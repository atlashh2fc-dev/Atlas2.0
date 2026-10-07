import Link from "next/link";
import { connection } from "next/server";
import { FlaskConical } from "lucide-react";

import { cambiarEstadoOrden } from "@/app/actions/laboratorio";
import { ActionForm, ActionSubmit, Badge, EmptyState, PageHeader, SectionCard, Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui";
import { fechaEnChile } from "@/lib/citas";
import { ESTADO_ORDEN, ordenAtrasada } from "@/lib/laboratorio";
import { createClient } from "@/lib/supabase/server";

type Orden = {
  id: string;
  cuenta_id: string;
  laboratorio: string;
  trabajo: string;
  piezas: string | null;
  color: string | null;
  enviada_el: string;
  entrega_estimada: string | null;
  estado: string;
  sales_companies: { name: string } | { name: string }[] | null;
};

const fecha = (valor: string | null) => (valor ? valor.split("-").reverse().join("/") : "—");

/**
 * Laboratorio: lo que está afuera y cuándo vuelve. Arriba lo atrasado; una
 * orden se marca «llegó» y luego «instalada» desde acá o desde la ficha.
 */
export default async function LaboratorioPage() {
  await connection();
  const hoy = fechaEnChile(new Date());
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ordenes_laboratorio")
    .select("id, cuenta_id, laboratorio, trabajo, piezas, color, enviada_el, entrega_estimada, estado, sales_companies(name)")
    .in("estado", ["enviada", "en_prueba", "recibida"])
    .order("entrega_estimada", { ascending: true, nullsFirst: false })
    .limit(300);
  const ordenes = (data ?? []) as unknown as Orden[];
  const atrasadas = ordenes.filter((orden) => ordenAtrasada(orden, hoy));
  const nombre = (orden: Orden) => (Array.isArray(orden.sales_companies) ? orden.sales_companies[0]?.name : orden.sales_companies?.name) ?? "—";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Laboratorio"
        icon={FlaskConical}
        description="Trabajos que están en el laboratorio o esperando instalación. Las órdenes se crean desde la ficha del paciente."
        meta={atrasadas.length ? <Badge tone="danger">{atrasadas.length} atrasadas</Badge> : undefined}
      />
      <SectionCard title="Pendientes" description={`${ordenes.length} órdenes abiertas`}>
        {error ? (
          <p className="px-5 pb-4 text-sm text-danger">No se pudo leer el laboratorio. Vuelve a cargar.</p>
        ) : ordenes.length === 0 ? (
          <EmptyState icon={FlaskConical} title="Nada pendiente" description="Cuando mandes un trabajo, crea la orden desde la ficha del paciente." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Th>Paciente</Th>
                <Th>Trabajo</Th>
                <Th>Laboratorio</Th>
                <Th>Enviada</Th>
                <Th>Llega</Th>
                <Th>Estado</Th>
                <Th align="right"><span className="sr-only">Acciones</span></Th>
              </Thead>
              <Tbody>
                {ordenes.map((orden) => {
                  const info = ESTADO_ORDEN[orden.estado] ?? ESTADO_ORDEN.enviada;
                  const atrasada = ordenAtrasada(orden, hoy);
                  return (
                    <Tr key={orden.id}>
                      <Td><Link href={`/dashboard/pacientes/${orden.cuenta_id}`} className="font-medium hover:text-primary hover:underline">{nombre(orden)}</Link></Td>
                      <Td>{orden.trabajo}{orden.piezas ? ` · ${orden.piezas}` : ""}{orden.color ? ` · ${orden.color}` : ""}</Td>
                      <Td>{orden.laboratorio}</Td>
                      <Td className="tabular-nums">{fecha(orden.enviada_el)}</Td>
                      <Td className={`tabular-nums ${atrasada ? "font-medium text-danger" : ""}`}>{fecha(orden.entrega_estimada)}</Td>
                      <Td><Badge tone={atrasada ? "danger" : info.tone}>{atrasada ? "Atrasada" : info.label}</Badge></Td>
                      <Td align="right">
                        {info.siguiente && (
                          <ActionForm action={cambiarEstadoOrden} success="Orden actualizada">
                            <input type="hidden" name="id" value={orden.id} />
                            <input type="hidden" name="cuenta_id" value={orden.cuenta_id} />
                            <input type="hidden" name="estado" value={info.siguiente.estado} />
                            <ActionSubmit size="sm" variant="secondary" pendingLabel="…">{info.siguiente.label}</ActionSubmit>
                          </ActionForm>
                        )}
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
