import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { Copy, MessageCircle } from "lucide-react";

import { cobrarEnLinea, registrarPago } from "@/app/actions/pagos";
import { Badge, Callout, EmptyState, Input, NavTabs, PageHeader, SectionCard, Select, SubmitButton, buttonClasses } from "@/components/ui";
import { ZONA_CLINICA, enlaceWhatsApp, fechaEnChile } from "@/lib/citas";
import { PACIENTES_POR_EDICION, VENTAS_POR_EDICION } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { ETIQUETA_ESTADO_PAGO, ETIQUETA_MEDIO, MEDIOS_EN_CAJA, type EstadoPago, type MedioDePago } from "@/lib/pagos/medios";
import { pasarelaActiva } from "@/lib/pagos/pasarela";
import { createClient } from "@/lib/supabase/server";

/**
 * Caja: lo que hay que cobrar, ficha por ficha, y cómo se cobra.
 *
 * Cada atención nace "por cobrar". Se cobra en el mesón (efectivo, tarjeta
 * en el POS, transferencia) o en línea: un enlace de pago que la persona
 * abre desde WhatsApp y paga con Webpay. Los presupuestos, que son lo que
 * todavía no se hizo, viven en la pestaña de al lado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "2-digit", month: "short" });
const fechaHora = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

type Pendiente = { id: string; cuenta_id: string; descripcion: string; precio: number | null; fecha: string; sales_companies: { name: string; phone: string | null } | { name: string; phone: string | null }[] | null };
type Pago = { id: string; cuenta_id: string; monto: number; medio: MedioDePago; estado: EstadoPago; referencia: string | null; pagado_at: string | null; created_at: string; sales_companies: { name: string; phone: string | null } | { name: string; phone: string | null }[] | null };

function primero<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}

function primerNombre(nombre: string): string {
  return nombre.split(" ")[0] ?? nombre;
}

export default async function CajaPage({ searchParams }: { searchParams: Promise<{ enlace?: string }> }) {
  noStore();
  const { edicion, empresa } = await contextoDeMiEmpresa();
  const clinica = edicion === "vet" ? "vet" : "dental";
  const voc = PACIENTES_POR_EDICION[clinica];
  const ventas = VENTAS_POR_EDICION[clinica];
  const hoy = fechaEnChile(new Date());
  const inicioDeMes = `${hoy.slice(0, 7)}-01`;
  const { enlace } = await searchParams;
  const pasarela = pasarelaActiva();

  const cabeceras = await headers();
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host") ?? "";
  const proto = cabeceras.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origen = host ? `${proto}://${host}` : "";

  const supabase = await createClient();
  const [{ data: pendientesData, error }, { data: pagosData }, { data: pagoEnlace }] = await Promise.all([
    supabase
      .from("atenciones")
      .select("id, cuenta_id, descripcion, precio, fecha, sales_companies(name, phone)")
      .eq("pagado", false)
      .order("fecha")
      .limit(3000),
    supabase
      .from("pagos")
      .select("id, cuenta_id, monto, medio, estado, referencia, pagado_at, created_at, sales_companies(name, phone)")
      .gte("created_at", `${inicioDeMes}T00:00:00-03:00`)
      .order("created_at", { ascending: false })
      .limit(500),
    enlace && UUID.test(enlace)
      ? supabase.from("pagos").select("id, cuenta_id, monto, medio, estado, referencia, pagado_at, created_at, sales_companies(name, phone)").eq("id", enlace).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const pendientes = (pendientesData ?? []) as unknown as Pendiente[];
  const pagos = (pagosData ?? []) as unknown as Pago[];
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
  const cobrados = pagos.filter((pago) => pago.estado === "pagado");
  const cobradoMes = cobrados.reduce((total, pago) => total + Number(pago.monto), 0);
  const cobradoHoy = cobrados.filter((pago) => pago.pagado_at && fechaEnChile(new Date(pago.pagado_at)) === hoy).reduce((total, pago) => total + Number(pago.monto), 0);
  const enLineaPendientes = pagos.filter((pago) => pago.estado === "pendiente").length;

  const pagoCompartir = (pagoEnlace as unknown as Pago | null) ?? null;
  const urlEnlace = pagoCompartir ? `${origen}/pagar/${pagoCompartir.id}` : null;
  const mensajeEnlace = pagoCompartir
    ? `Hola ${primerNombre(primero(pagoCompartir.sales_companies)?.name ?? "")}, te dejamos el enlace para pagar ${pesos.format(Number(pagoCompartir.monto))} en ${empresa ?? "la clínica"}: ${urlEnlace}`
    : "";

  return (
    <div className="space-y-5">
      <PageHeader title="Caja" description={`Lo pendiente de pago, ficha por ficha. En el mesón o en línea con ${pasarela.etiqueta}.`} />
      <NavTabs
        tabs={[
          { label: "Por cobrar", href: "/dashboard/caja" },
          { label: ventas.negocios, href: "/dashboard/ventas" },
        ]}
      />

      {pagoCompartir && urlEnlace && (
        <Callout tone={pagoCompartir.estado === "pagado" ? "success" : "info"}>
          <p className="mb-2 font-medium">{pagoCompartir.estado === "pagado" ? "Este enlace ya fue pagado" : "Enlace de pago listo para enviar"}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-surface-muted px-2 py-1 text-xs">{urlEnlace}</code>
            <a href={enlaceWhatsApp(primero(pagoCompartir.sales_companies)?.phone, mensajeEnlace) ?? "#"} target="_blank" rel="noreferrer" className={buttonClasses({ size: "sm" })}>
              <MessageCircle size={14} aria-hidden="true" /> Enviar por WhatsApp
            </a>
            <Link href={urlEnlace} target="_blank" className={buttonClasses({ variant: "secondary", size: "sm" })}>
              <Copy size={14} aria-hidden="true" /> Abrir
            </Link>
            <span className="text-xs text-muted-foreground">
              {primero(pagoCompartir.sales_companies)?.name} · {pesos.format(Number(pagoCompartir.monto))}
              {!pasarela.produccion && " · ambiente de prueba, no cobra dinero real"}
            </span>
          </div>
        </Callout>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Por cobrar", valor: pesos.format(totalPorCobrar), detalle: `${saldos.length} ${saldos.length === 1 ? "ficha con saldo" : "fichas con saldo"}` },
          { label: "Cobrado hoy", valor: pesos.format(cobradoHoy), detalle: "Pagos recibidos hoy" },
          { label: "Cobrado este mes", valor: pesos.format(cobradoMes), detalle: `${cobrados.length} ${cobrados.length === 1 ? "pago" : "pagos"} desde el 1` },
          { label: "En línea pendientes", valor: String(enLineaPendientes), detalle: "Enlaces enviados sin pagar" },
        ].map((metrica) => (
          <div key={metrica.label} className="rounded-xl border border-border bg-surface px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{metrica.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{metrica.valor}</p>
            <p className="text-xs text-muted-foreground">{metrica.detalle}</p>
          </div>
        ))}
      </div>

      <SectionCard
        title="Por cobrar"
        description={`Cada fila es ${voc.singular.toLowerCase() === "tutor" ? "un tutor" : "un paciente"} con atenciones sin pagar. Cobrar en el mesón las deja al día; el enlace las deja al día cuando la persona paga.`}
      >
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
                  <th className="px-3 py-2 font-medium text-right">Saldo</th>
                  <th className="px-4 py-2 font-medium">Cobrar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {saldos.map(([cuentaId, cuenta]) => (
                  <tr key={cuentaId} className="align-top">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/pacientes/${cuentaId}`} className="font-medium text-foreground hover:text-primary hover:underline">
                        {cuenta.nombre}
                      </Link>
                      {cuenta.telefono && <p className="text-xs text-muted-foreground">{cuenta.telefono}</p>}
                    </td>
                    <td className="max-w-xs px-3 py-3 text-muted-foreground">
                      <p className="truncate">{cuenta.lineas.map((linea) => linea.descripcion).join(" · ")}</p>
                      <p className="text-xs">
                        {cuenta.lineas.length} {cuenta.lineas.length === 1 ? "atención" : "atenciones"} · desde {fecha.format(new Date(`${cuenta.lineas[0].fecha}T12:00:00`))}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-foreground">{pesos.format(cuenta.total)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-2">
                        <form action={registrarPago} className="flex flex-wrap items-center gap-1.5">
                          <input type="hidden" name="cuenta_id" value={cuentaId} />
                          <Input name="monto" inputMode="numeric" defaultValue={Math.round(cuenta.total)} aria-label="Monto" className="w-28" />
                          <Select name="medio" defaultValue="debito" aria-label="Medio de pago" className="w-36">
                            {MEDIOS_EN_CAJA.map((medio) => (
                              <option key={medio} value={medio}>
                                {ETIQUETA_MEDIO[medio]}
                              </option>
                            ))}
                          </Select>
                          <Input name="referencia" placeholder="Voucher / comprobante" aria-label="Referencia" className="w-40" />
                          <SubmitButton size="sm" pendingLabel="Cobrando…">Cobrar</SubmitButton>
                        </form>
                        <form action={cobrarEnLinea} className="flex flex-wrap items-center gap-1.5">
                          <input type="hidden" name="cuenta_id" value={cuentaId} />
                          <input type="hidden" name="monto" value={Math.round(cuenta.total)} />
                          <button type="submit" name="destino" value="enlace" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                            <MessageCircle size={14} aria-hidden="true" /> Enlace de pago
                          </button>
                          <button type="submit" name="destino" value="pagar" className={buttonClasses({ variant: "ghost", size: "sm" })}>
                            Pagar acá con Webpay
                          </button>
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

      <SectionCard title="Pagos del mes" description="Todo lo cobrado y lo que está en camino, del más reciente al más antiguo.">
        {pagos.length === 0 ? (
          <EmptyState title="Sin pagos este mes" description="Aparecen acá al cobrar en el mesón o cuando alguien paga un enlace." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Cuándo</th>
                  <th className="px-3 py-2 font-medium">{voc.singular}</th>
                  <th className="px-3 py-2 font-medium">Medio</th>
                  <th className="px-3 py-2 font-medium">Referencia</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2 font-medium text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pagos.slice(0, 60).map((pago) => {
                  const etiqueta = ETIQUETA_ESTADO_PAGO[pago.estado];
                  return (
                    <tr key={pago.id}>
                      <td className="px-4 py-2.5 text-muted-foreground">{fechaHora.format(new Date(pago.pagado_at ?? pago.created_at))}</td>
                      <td className="px-3 py-2.5">
                        <Link href={`/dashboard/pacientes/${pago.cuenta_id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                          {primero(pago.sales_companies)?.name ?? "—"}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{ETIQUETA_MEDIO[pago.medio] ?? pago.medio}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {pago.referencia ?? (pago.estado === "pendiente" ? (
                          <Link href={`/dashboard/caja?enlace=${pago.id}`} className="text-primary hover:underline">
                            Ver enlace
                          </Link>
                        ) : "—")}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={etiqueta.tone}>{etiqueta.label}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{pesos.format(Number(pago.monto))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
