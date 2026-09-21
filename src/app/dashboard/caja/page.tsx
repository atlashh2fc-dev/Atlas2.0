import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { cobrarCuenta } from "@/app/actions/atenciones";
import { EmptyState, NavTabs, PageHeader, SectionCard, SubmitButton, buttonClasses } from "@/components/ui";
import { ZONA_CLINICA, fechaEnChile } from "@/lib/citas";
import { PACIENTES_POR_EDICION, VENTAS_POR_EDICION } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

/**
 * Caja: lo que hay que cobrar, ficha por ficha.
 *
 * Cada atención nace "por cobrar" y se paga acá o desde la ficha. Los
 * presupuestos, que son lo que todavía no se hizo, viven en la pestaña de al
 * lado: la misma pantalla del embudo, con su nombre de clínica.
 */

const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "2-digit", month: "short" });

type Pendiente = { id: string; cuenta_id: string; descripcion: string; precio: number | null; fecha: string; sales_companies: { name: string; phone: string | null } | { name: string; phone: string | null }[] | null };

function primero<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}

export default async function CajaPage() {
  noStore();
  const { edicion } = await contextoDeMiEmpresa();
  const clinica = edicion === "vet" ? "vet" : "dental";
  const voc = PACIENTES_POR_EDICION[clinica];
  const ventas = VENTAS_POR_EDICION[clinica];
  const hoy = fechaEnChile(new Date());
  const inicioDeMes = `${hoy.slice(0, 7)}-01`;

  const supabase = await createClient();
  const [{ data: pendientesData, error }, { data: cobradasData }] = await Promise.all([
    supabase
      .from("atenciones")
      .select("id, cuenta_id, descripcion, precio, fecha, sales_companies(name, phone)")
      .eq("pagado", false)
      .order("fecha")
      .limit(3000),
    supabase.from("atenciones").select("precio, fecha").eq("pagado", true).gte("fecha", inicioDeMes).limit(5000),
  ]);

  const pendientes = (pendientesData ?? []) as unknown as Pendiente[];
  const porCuenta = new Map<string, { nombre: string; telefono: string | null; total: number; lineas: Pendiente[] }>();
  for (const atencion of pendientes) {
    const cuenta = porCuenta.get(atencion.cuenta_id) ?? {
      nombre: primero(atencion.sales_companies)?.name ?? "—",
      telefono: primero(atencion.sales_companies)?.phone ?? null,
      total: 0,
      lineas: [],
    };
    cuenta.total += Number(atencion.precio ?? 0);
    cuenta.lineas.push(atencion);
    porCuenta.set(atencion.cuenta_id, cuenta);
  }
  const saldos = [...porCuenta.entries()].sort((a, b) => b[1].total - a[1].total);
  const totalPorCobrar = saldos.reduce((total, [, cuenta]) => total + cuenta.total, 0);
  const cobradoMes = (cobradasData ?? []).reduce((total, atencion) => total + Number(atencion.precio ?? 0), 0);
  const hoyCobrado = (cobradasData ?? []).filter((atencion) => atencion.fecha === hoy).reduce((total, atencion) => total + Number(atencion.precio ?? 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Caja" description="Lo pendiente de pago, ficha por ficha, y lo cobrado en el mes." />
      <NavTabs
        tabs={[
          { label: "Por cobrar", href: "/dashboard/caja" },
          { label: ventas.negocios, href: "/dashboard/ventas" },
        ]}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Por cobrar", valor: pesos.format(totalPorCobrar), detalle: `${saldos.length} ${saldos.length === 1 ? "ficha con saldo" : "fichas con saldo"}` },
          { label: "Cobrado este mes", valor: pesos.format(cobradoMes), detalle: "Atenciones pagadas desde el 1" },
          { label: "Atendido hoy y pagado", valor: pesos.format(hoyCobrado), detalle: "Lo de hoy que ya quedó al día" },
        ].map((metrica) => (
          <div key={metrica.label} className="rounded-xl border border-border bg-surface px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{metrica.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{metrica.valor}</p>
            <p className="text-xs text-muted-foreground">{metrica.detalle}</p>
          </div>
        ))}
      </div>

      <SectionCard title="Por cobrar" description={`Cada fila es ${voc.singular.toLowerCase() === "tutor" ? "un tutor" : "un paciente"} con atenciones sin pagar. Cobrar deja todas sus atenciones al día.`}>
        {error ? (
          <p className="px-4 py-6 text-sm text-danger">No se pudieron leer las atenciones. Vuelve a cargar para reintentar.</p>
        ) : saldos.length === 0 ? (
          <EmptyState title="Nada por cobrar" description="Todas las atenciones registradas están pagadas." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">{voc.singular}</th>
                  <th className="px-3 py-2 font-medium">Atenciones</th>
                  <th className="px-3 py-2 font-medium">Desde</th>
                  <th className="px-3 py-2 font-medium text-right">Saldo</th>
                  <th className="px-4 py-2 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {saldos.map(([cuentaId, cuenta]) => (
                  <tr key={cuentaId}>
                    <td className="px-4 py-2.5">
                      <Link href={`/dashboard/pacientes/${cuentaId}`} className="font-medium text-foreground hover:text-primary hover:underline">
                        {cuenta.nombre}
                      </Link>
                      {cuenta.telefono && <p className="text-xs text-muted-foreground">{cuenta.telefono}</p>}
                    </td>
                    <td className="max-w-md px-3 py-2.5 text-muted-foreground">
                      <p className="truncate">{cuenta.lineas.map((linea) => linea.descripcion).join(" · ")}</p>
                      <p className="text-xs">{cuenta.lineas.length} {cuenta.lineas.length === 1 ? "atención" : "atenciones"}</p>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{fecha.format(new Date(`${cuenta.lineas[0].fecha}T12:00:00`))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{pesos.format(cuenta.total)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <Link href={`/dashboard/pacientes/${cuentaId}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                          Ficha
                        </Link>
                        <form action={cobrarCuenta}>
                          <input type="hidden" name="cuenta_id" value={cuentaId} />
                          <SubmitButton size="sm" pendingLabel="Cobrando…">Cobrar</SubmitButton>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
