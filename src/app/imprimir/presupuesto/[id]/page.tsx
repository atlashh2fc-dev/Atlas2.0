import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { BotonImprimir } from "./imprimir-boton";

export const metadata: Metadata = { title: "Presupuesto", robots: { index: false } };
export const dynamic = "force-dynamic";

const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "long", year: "numeric" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Item = { description: string | null; quantity: number | null; one_time_price: number | null; sales_products: { name: string } | { name: string }[] | null };

/**
 * El presupuesto en una hoja: para imprimirlo, guardarlo como PDF o
 * entregarlo en el mesón. Se arma con lo que ya está en Atlas (ítems del
 * presupuesto, datos de la ficha y de la clínica) y deja espacio para la
 * firma de aceptación.
 */
export default async function ImprimirPresupuestoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin", "supervisor"]);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const { data: negocio } = await supabase
    .from("sales_opportunities")
    .select("id, name, one_time_amount, created_at, organization_id, sales_companies(name, rut, phone, email), sales_opportunity_items(description, quantity, one_time_price, sales_products(name)), organizations(name)")
    .eq("id", id)
    .maybeSingle();
  if (!negocio) notFound();
  const uno = <T,>(valor: T | T[] | null | undefined): T | null => (Array.isArray(valor) ? valor[0] ?? null : valor ?? null);
  const persona = uno(negocio.sales_companies as unknown as { name: string; rut: string | null; phone: string | null; email: string | null } | null);
  const clinica = uno(negocio.organizations as unknown as { name: string } | null)?.name ?? "";
  const items = ((negocio.sales_opportunity_items ?? []) as unknown as Item[]).map((item) => ({
    detalle: item.description || uno(item.sales_products)?.name || negocio.name,
    cantidad: Number(item.quantity ?? 1),
    precio: Number(item.one_time_price ?? 0),
  }));
  const total = Number(negocio.one_time_amount ?? 0) || items.reduce((suma, item) => suma + item.cantidad * item.precio, 0);
  const lineas = items.length ? items : [{ detalle: negocio.name, cantidad: 1, precio: total }];
  const sumaLineas = lineas.reduce((suma, item) => suma + item.cantidad * item.precio, 0);
  const emitido = new Date();
  const vence = new Date(emitido.getTime() + 30 * 24 * 60 * 60 * 1000);

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-3xl justify-end print:hidden">
        <BotonImprimir />
      </div>
      <article className="mx-auto max-w-3xl space-y-8 rounded-xl border border-border bg-white p-8 text-[#111] shadow-sm print:max-w-none print:rounded-none print:border-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b border-[#ddd] pb-6">
          <div>
            <p className="text-xl font-semibold">{clinica}</p>
            <p className="text-sm text-[#555]">Presupuesto N.º {negocio.id.slice(0, 8).toUpperCase()}</p>
          </div>
          <div className="text-right text-sm text-[#555]">
            <p>Emitido el {fecha.format(emitido)}</p>
            <p>Válido hasta el {fecha.format(vence)}</p>
          </div>
        </header>

        <section className="grid gap-1 text-sm">
          <p><span className="text-[#555]">Para:</span> <span className="font-medium">{persona?.name ?? "—"}</span></p>
          {persona?.rut && <p><span className="text-[#555]">RUT:</span> {persona.rut}</p>}
          {(persona?.phone || persona?.email) && <p className="text-[#555]">{[persona?.phone, persona?.email].filter(Boolean).join(" · ")}</p>}
          <p className="pt-2"><span className="text-[#555]">Tratamiento:</span> <span className="font-medium">{negocio.name}</span></p>
        </section>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#ddd] text-left text-[#555]">
              <th className="py-2 font-medium">Detalle</th>
              <th className="py-2 text-right font-medium">Cant.</th>
              <th className="py-2 text-right font-medium">Valor</th>
              <th className="py-2 text-right font-medium">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((linea, indice) => (
              <tr key={indice} className="border-b border-[#eee]">
                <td className="py-2 pr-4">{linea.detalle}</td>
                <td className="py-2 text-right tabular-nums">{linea.cantidad}</td>
                <td className="py-2 text-right tabular-nums">{pesos.format(linea.precio)}</td>
                <td className="py-2 text-right tabular-nums">{pesos.format(linea.cantidad * linea.precio)}</td>
              </tr>
            ))}
            {total !== sumaLineas && (
              <tr className="border-b border-[#eee] text-[#555]">
                <td className="py-2 pr-4" colSpan={3}>Materiales y ajustes</td>
                <td className="py-2 text-right tabular-nums">{pesos.format(total - sumaLineas)}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-4 text-right font-semibold" colSpan={3}>Total</td>
              <td className="pt-4 text-right text-lg font-semibold tabular-nums">{pesos.format(total)}</td>
            </tr>
          </tfoot>
        </table>

        <p className="text-xs text-[#555]">
          Los valores están expresados en pesos chilenos. El presupuesto puede cambiar si durante el tratamiento aparecen hallazgos que no se pudieron ver en la
          evaluación; cualquier cambio se conversa y se aprueba antes.
        </p>

        <footer className="grid grid-cols-2 gap-10 pt-12 text-center text-xs text-[#555]">
          <div className="border-t border-[#999] pt-2">Firma de aceptación<br />{persona?.name ?? ""}</div>
          <div className="border-t border-[#999] pt-2">{clinica}</div>
        </footer>
      </article>
    </main>
  );
}
