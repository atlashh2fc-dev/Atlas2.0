import Link from "next/link";
import { connection } from "next/server";
import { headers } from "next/headers";
import { CalendarCheck, Copy, HandCoins, Link2, MessageCircle, Receipt, Wallet } from "lucide-react";

import { enviarMensaje } from "@/app/actions/mensajes";
import { cobrarEnLinea, registrarPago } from "@/app/actions/pagos";
import { ActionForm, ActionSubmit, Avatar, Badge, Callout, EmptyState, Input, NavTabs, PageHeader, SectionCard, Select, Table, Tbody, Td, Th, Thead, Tr, buttonClasses } from "@/components/ui";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { ZONA_CLINICA, fechaEnChile } from "@/lib/citas";
import { PACIENTES_POR_EDICION, VENTAS_POR_EDICION, clinicaDe } from "@/lib/ediciones";
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
const hora = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dia = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "numeric", month: "short" });

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
  await connection();
  const { edicion, empresa } = await contextoDeMiEmpresa();
  const clinica = clinicaDe(edicion);
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
  const variablesEnlace = pagoCompartir
    ? { nombre: primerNombre(primero(pagoCompartir.sales_companies)?.name ?? ""), monto: pesos.format(Number(pagoCompartir.monto)), clinica: empresa ?? "la clínica", url: urlEnlace }
    : null;

  return (
    <div className="space-y-5">
      <PageHeader title="Caja" icon={Wallet} description={`Lo pendiente de pago, ficha por ficha. En el mesón o en línea con ${pasarela.etiqueta}.`} />
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
            {variablesEnlace && pagoCompartir.estado === "pendiente" && (
              <ActionForm action={enviarMensaje} success="Enlace enviado por WhatsApp">
                <input type="hidden" name="cuenta_id" value={pagoCompartir.cuenta_id} />
                <input type="hidden" name="plantilla" value="enlace_pago" />
                <input type="hidden" name="regla" value="enlace_pago" />
                <input type="hidden" name="origen_ref" value={pagoCompartir.id} />
                <input type="hidden" name="variables" value={JSON.stringify(variablesEnlace)} />
                <ActionSubmit size="sm" pendingLabel="Enviando…">
                  <MessageCircle size={14} aria-hidden="true" /> Enviar por WhatsApp desde Atlas
                </ActionSubmit>
              </ActionForm>
            )}
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

      <KpiStrip columns={4}>
        <KpiStripItem
          label="Por cobrar"
          value={pesos.format(totalPorCobrar)}
          icon={Wallet}
          tone={totalPorCobrar > 0 ? "warn" : "default"}
          detail={`${saldos.length} ${saldos.length === 1 ? "ficha con saldo" : "fichas con saldo"}`}
        />
        <KpiStripItem label="Cobrado hoy" value={pesos.format(cobradoHoy)} icon={HandCoins} tone={cobradoHoy > 0 ? "good" : "default"} detail="Pagos recibidos hoy" />
        <KpiStripItem
          label="Cobrado este mes"
          value={pesos.format(cobradoMes)}
          icon={CalendarCheck}
          detail={`${cobrados.length} ${cobrados.length === 1 ? "pago" : "pagos"} desde el 1`}
          progress={cobradoMes + totalPorCobrar > 0 ? (cobradoMes / (cobradoMes + totalPorCobrar)) * 100 : undefined}
        />
        <KpiStripItem
          label="En línea pendientes"
          value={String(enLineaPendientes)}
          icon={Link2}
          tone={enLineaPendientes > 0 ? "warn" : "default"}
          detail="Enlaces enviados sin pagar"
        />
      </KpiStrip>

      <SectionCard
        title="Por cobrar"
        description={`Cada fila es un ${voc.singular.toLowerCase()} con atenciones sin pagar. Cobrar en el mesón las deja al día; el enlace las deja al día cuando la persona paga.`}
      >
        {error ? (
          <p className="px-4 py-6 text-sm text-danger">No se pudieron leer las atenciones. Vuelve a cargar para reintentar.</p>
        ) : saldos.length === 0 ? (
          <EmptyState icon={Wallet} title="Nada por cobrar" description="Todas las atenciones registradas están pagadas." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Th>{voc.singular}</Th>
                <Th>Atenciones</Th>
                <Th align="right">Saldo</Th>
                <Th>Cobrar</Th>
              </Thead>
              <Tbody>
                {saldos.map(([cuentaId, cuenta]) => (
                  <Tr key={cuentaId} className="align-top">
                    <Td>
                      <span className="flex min-w-0 items-center gap-3">
                        <Avatar name={cuenta.nombre} size="md" />
                        <span className="min-w-0">
                          <Link href={`/dashboard/pacientes/${cuentaId}`} className="block truncate font-medium text-foreground hover:text-primary hover:underline">
                            {cuenta.nombre}
                          </Link>
                          {cuenta.telefono && <span className="block text-xs tabular-nums text-muted-foreground">{cuenta.telefono}</span>}
                        </span>
                      </span>
                    </Td>
                    <Td className="max-w-xs">
                      <span className="block truncate text-foreground">{cuenta.lineas.map((linea) => linea.descripcion).join(" · ")}</span>
                      <span className="block text-xs text-muted-foreground">
                        {cuenta.lineas.length} {cuenta.lineas.length === 1 ? "atención" : "atenciones"} · desde {fecha.format(new Date(`${cuenta.lineas[0].fecha}T12:00:00`)).replace(".", "")}
                      </span>
                    </Td>
                    <Td align="right" className="whitespace-nowrap text-[15px] font-semibold text-foreground">{pesos.format(cuenta.total)}</Td>
                    <Td>
                      <div className="flex flex-col gap-2">
                        <ActionForm action={registrarPago} success={`Pago de ${cuenta.nombre} registrado`} className="flex flex-wrap items-center gap-1.5">
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
                          <ActionSubmit size="sm" variant="secondary" pendingLabel="Cobrando…">Cobrar</ActionSubmit>
                        </ActionForm>
                        {/* Un formulario por destino: ActionForm no incluye en el FormData el botón que lo envió. */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <ActionForm action={cobrarEnLinea} success="Enlace de pago creado">
                            <input type="hidden" name="cuenta_id" value={cuentaId} />
                            <input type="hidden" name="monto" value={Math.round(cuenta.total)} />
                            <input type="hidden" name="destino" value="enlace" />
                            <ActionSubmit size="sm" variant="secondary" pendingLabel="Creando…">
                              <MessageCircle size={14} aria-hidden="true" /> Enlace de pago
                            </ActionSubmit>
                          </ActionForm>
                          <ActionForm action={cobrarEnLinea} success={`Abriendo ${pasarela.etiqueta}`}>
                            <input type="hidden" name="cuenta_id" value={cuentaId} />
                            <input type="hidden" name="monto" value={Math.round(cuenta.total)} />
                            <input type="hidden" name="destino" value="pagar" />
                            <ActionSubmit size="sm" variant="ghost" pendingLabel="Abriendo…">
                              Pagar acá con {pasarela.etiqueta}
                            </ActionSubmit>
                          </ActionForm>
                        </div>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Pagos del mes" description="Todo lo cobrado y lo que está en camino, del más reciente al más antiguo.">
        {pagos.length === 0 ? (
          <EmptyState icon={Receipt} title="Sin pagos este mes" description="Aparecen acá al cobrar en el mesón o cuando alguien paga un enlace." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Th>Cuándo</Th>
                <Th>{voc.singular}</Th>
                <Th>Medio</Th>
                <Th>Estado</Th>
                <Th align="right">Monto</Th>
              </Thead>
              <Tbody>
                {pagos.slice(0, 60).map((pago) => {
                  const etiqueta = ETIQUETA_ESTADO_PAGO[pago.estado];
                  const instante = new Date(pago.pagado_at ?? pago.created_at);
                  const nombre = primero(pago.sales_companies)?.name ?? "—";
                  return (
                    <Tr key={pago.id}>
                      <Td className="whitespace-nowrap">
                        <span className="block text-foreground">{dia.format(instante).replace(".", "")}</span>
                        <span className="block text-xs tabular-nums text-muted-foreground">{hora.format(instante)}</span>
                      </Td>
                      <Td>
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={nombre} size="sm" />
                          <Link href={`/dashboard/pacientes/${pago.cuenta_id}`} className="truncate font-medium text-foreground hover:text-primary hover:underline">
                            {nombre}
                          </Link>
                        </span>
                      </Td>
                      <Td>
                        <span className="block text-foreground">{ETIQUETA_MEDIO[pago.medio] ?? pago.medio}</span>
                        <span className="block text-xs text-muted-foreground">
                          {pago.referencia ?? (pago.estado === "pendiente" ? (
                            <Link href={`/dashboard/caja?enlace=${pago.id}`} className="font-medium text-primary hover:underline">
                              Ver enlace
                            </Link>
                          ) : "Sin referencia")}
                        </span>
                      </Td>
                      <Td>
                        <Badge tone={etiqueta.tone}>{etiqueta.label}</Badge>
                      </Td>
                      <Td align="right" className="whitespace-nowrap font-semibold text-foreground">{pesos.format(Number(pago.monto))}</Td>
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
