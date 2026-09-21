import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { MessageCircle } from "lucide-react";

import { cambiarEstadoCita } from "@/app/actions/citas";
import { Badge, EmptyState, PageHeader, SectionCard, SubmitButton, buttonClasses } from "@/components/ui";
import { ZONA_CLINICA, enlaceWhatsApp, fechaEnChile, instanteEnChile, primero, sumarDias, type Cita } from "@/lib/citas";
import { PACIENTES_POR_EDICION, VENTAS_POR_EDICION } from "@/lib/ediciones";
import { estadoVacuna } from "@/lib/mascotas";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

/**
 * A quién hay que contactar hoy.
 *
 * No es un embudo: es la bandeja de la recepción. Cada bloque nace de los
 * datos que ya existen (citas, vacunas, presupuestos, atenciones) y cada fila
 * trae el mensaje listo para WhatsApp. Cuando la clínica active el envío
 * automático, estas mismas listas son las que saldrán solas.
 */

const DIA = 24 * 60 * 60 * 1000;
const hora = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "2-digit", month: "short" });
const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function primerNombre(nombre: string): string {
  return nombre.split(" ")[0] ?? nombre;
}

function WhatsApp({ telefono, mensaje }: { telefono: string | null | undefined; mensaje: string }) {
  const enlace = enlaceWhatsApp(telefono, mensaje);
  if (!enlace) return <span className="text-xs text-muted-foreground">Sin celular</span>;
  return (
    <a href={enlace} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "secondary", size: "sm" })}>
      <MessageCircle size={14} aria-hidden="true" /> WhatsApp
    </a>
  );
}

type Vacuna = { id: string; nombre: string; especie: string; proxima_vacuna: string | null; sales_companies: { id: string; name: string; phone: string | null } | { id: string; name: string; phone: string | null }[] | null };
type Presupuesto = { id: string; name: string; next_action_at: string | null; one_time_amount: number | null; company_id: string; sales_companies: { name: string; phone: string | null } | { name: string; phone: string | null }[] | null };
type Cuenta = { id: string; name: string; phone: string | null; atenciones: { fecha: string }[] | null };

export default async function RecordatoriosPage() {
  noStore();
  const { edicion, empresa } = await contextoDeMiEmpresa();
  const esVet = edicion === "vet";
  const voc = PACIENTES_POR_EDICION[esVet ? "vet" : "dental"];
  const ventas = VENTAS_POR_EDICION[esVet ? "vet" : "dental"];
  const clinica = empresa ?? "la clínica";
  const ahora = new Date();
  const hoy = fechaEnChile(ahora);
  const manana = sumarDias(hoy, 1);
  const mesesSinVenir = esVet ? 12 : 6;
  const corteInactivos = sumarDias(hoy, -30 * mesesSinVenir);

  const supabase = await createClient();
  const [{ data: citasData }, { data: vacunasData }, { data: presupuestosData }, { data: cuentasData }] = await Promise.all([
    supabase
      .from("citas")
      .select("id, cuenta_id, mascota_id, profesional_id, inicio, fin, motivo, estado, nota, sales_companies(name, phone), mascotas(nombre, especie), profesionales(nombre)")
      .eq("estado", "reservada")
      .gte("inicio", instanteEnChile(manana, "00:00").toISOString())
      .lt("inicio", instanteEnChile(sumarDias(manana, 1), "00:00").toISOString())
      .order("inicio"),
    esVet
      ? supabase
          .from("mascotas")
          .select("id, nombre, especie, proxima_vacuna, sales_companies(id, name, phone)")
          .not("proxima_vacuna", "is", null)
          .lte("proxima_vacuna", sumarDias(hoy, 30))
          .order("proxima_vacuna")
          .limit(150)
      : Promise.resolve({ data: [] }),
    supabase
      .from("sales_opportunities")
      .select("id, name, next_action_at, one_time_amount, company_id, sales_companies(name, phone)")
      .eq("status", "abierta")
      .not("next_action_at", "is", null)
      .lte("next_action_at", new Date(ahora.getTime() - 7 * DIA).toISOString())
      .order("next_action_at")
      .limit(150),
    supabase
      .from("sales_companies")
      .select("id, name, phone, atenciones(fecha)")
      .order("fecha", { referencedTable: "atenciones", ascending: false })
      .limit(1, { referencedTable: "atenciones" })
      .order("name")
      .limit(600),
  ]);

  const citas = (citasData ?? []) as unknown as (Cita & { profesionales: { nombre: string } | { nombre: string }[] | null })[];
  const vacunas = ((vacunasData ?? []) as unknown as Vacuna[]).filter((mascota) => {
    const estado = estadoVacuna(mascota.proxima_vacuna, ahora);
    return estado === "vencida" || estado === "por_vencer";
  });
  const presupuestos = (presupuestosData ?? []) as unknown as Presupuesto[];
  const inactivos = ((cuentasData ?? []) as unknown as Cuenta[])
    .map((cuenta) => ({ ...cuenta, ultima: cuenta.atenciones?.[0]?.fecha ?? null }))
    .filter((cuenta) => cuenta.ultima !== null && cuenta.ultima < corteInactivos)
    .sort((a, b) => (a.ultima ?? "").localeCompare(b.ultima ?? ""))
    .slice(0, 40);

  const total = citas.length + vacunas.length + presupuestos.length + inactivos.length;
  const dias = (desde: string) => Math.floor((ahora.getTime() - new Date(desde).getTime()) / DIA);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Recordatorios"
        description={`${total} ${total === 1 ? "contacto pendiente" : "contactos pendientes"}. Cada fila trae el mensaje listo; lo que confirmes o agendes desaparece de acá.`}
      />

      <SectionCard
        title={`Citas de mañana sin confirmar · ${citas.length}`}
        description="Confirmar hoy evita la hora perdida de mañana. El mensaje pregunta si la persona viene."
      >
        {citas.length === 0 ? (
          <EmptyState title="Todo confirmado para mañana" description="Las citas de mañana ya están confirmadas o no hay ninguna." />
        ) : (
          <ul className="divide-y divide-border">
            {citas.map((cita) => {
              const cuenta = primero(cita.sales_companies);
              const mascota = primero(cita.mascotas);
              const profesional = primero(cita.profesionales)?.nombre ?? "";
              const nombre = cuenta?.name ?? "—";
              const mensaje = `Hola ${primerNombre(nombre)}, te recordamos ${mascota ? `la hora de ${mascota.nombre}` : "tu hora"} mañana a las ${hora.format(new Date(cita.inicio))} con ${profesional} en ${clinica} (${cita.motivo}). ¿Nos confirmas que vienes?`;
              return (
                <li key={cita.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="w-14 tabular-nums text-foreground">{hora.format(new Date(cita.inicio))}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/pacientes/${cita.cuenta_id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                      {mascota ? `${mascota.nombre} · ${nombre}` : nombre}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {cita.motivo} · {profesional}
                    </p>
                  </div>
                  <WhatsApp telefono={cuenta?.phone} mensaje={mensaje} />
                  <form action={cambiarEstadoCita}>
                    <input type="hidden" name="cita_id" value={cita.id} />
                    <input type="hidden" name="cuenta_id" value={cita.cuenta_id} />
                    <input type="hidden" name="estado" value="confirmada" />
                    <input type="hidden" name="volver" value="/dashboard/recordatorios" />
                    <SubmitButton size="sm" pendingLabel="…">Confirmada</SubmitButton>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {esVet && (
        <SectionCard
          title={`Vacunas vencidas o por vencer · ${vacunas.length}`}
          description="Las de los próximos 30 días y las que ya vencieron. Agendar desde acá deja la hora tomada."
        >
          {vacunas.length === 0 ? (
            <EmptyState title="Vacunas al día" description="Ninguna mascota tiene la vacuna vencida ni por vencer en 30 días." />
          ) : (
            <ul className="divide-y divide-border">
              {vacunas.map((mascota) => {
                const tutor = primero(mascota.sales_companies);
                const estado = estadoVacuna(mascota.proxima_vacuna, ahora);
                const mensaje = `Hola ${primerNombre(tutor?.name ?? "")}, la vacuna de ${mascota.nombre} ${estado === "vencida" ? "venció" : "vence"} el ${fecha.format(new Date(`${mascota.proxima_vacuna}T12:00:00`))}. ¿Agendamos una hora en ${clinica}?`;
                return (
                  <li key={mascota.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Badge tone={estado === "vencida" ? "danger" : "warning"}>{estado === "vencida" ? "Vencida" : "Por vencer"}</Badge>
                    <div className="min-w-0 flex-1">
                      <Link href={`/dashboard/pacientes/${tutor?.id ?? ""}`} className="font-medium text-foreground hover:text-primary hover:underline">
                        {mascota.nombre} · {tutor?.name ?? "—"}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {mascota.especie} · vacuna {mascota.proxima_vacuna ? fecha.format(new Date(`${mascota.proxima_vacuna}T12:00:00`)) : "—"}
                      </p>
                    </div>
                    <WhatsApp telefono={tutor?.phone} mensaje={mensaje} />
                    <Link href="/dashboard/citas" className={buttonClasses({ size: "sm" })}>
                      Agendar
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      )}

      <SectionCard
        title={`${ventas.negocios} sin respuesta hace más de 7 días · ${presupuestos.length}`}
        description={`${ventas.negocios} abiertos cuya próxima acción ya venció. Un mensaje corto suele destrabarlos.`}
      >
        {presupuestos.length === 0 ? (
          <EmptyState title="Nada vencido" description={`Todos los ${ventas.negocios.toLowerCase()} abiertos tienen su próxima acción al día.`} />
        ) : (
          <ul className="divide-y divide-border">
            {presupuestos.map((presupuesto) => {
              const cuenta = primero(presupuesto.sales_companies);
              const mensaje = `Hola ${primerNombre(cuenta?.name ?? "")}, te escribimos de ${clinica} por el ${ventas.negocio.toLowerCase()} "${presupuesto.name}". ¿Te quedó alguna duda o quieres que agendemos?`;
              return (
                <li key={presupuesto.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Badge tone="warning">{dias(presupuesto.next_action_at as string)} días</Badge>
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/ventas/${presupuesto.id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                      {presupuesto.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {cuenta?.name ?? "—"} · {pesos.format(Number(presupuesto.one_time_amount ?? 0))}
                    </p>
                  </div>
                  <WhatsApp telefono={cuenta?.phone} mensaje={mensaje} />
                  <Link href={`/dashboard/pacientes/${presupuesto.company_id}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                    Ficha
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title={`${voc.titulo} que no vuelven hace más de ${mesesSinVenir} meses · ${inactivos.length}`}
        description={esVet ? "Un control anual es la visita que más se olvida y la que más recompra trae." : "El control semestral: la visita que mantiene la boca sana y la agenda llena."}
      >
        {inactivos.length === 0 ? (
          <EmptyState title="Nadie fuera de plazo" description="Todas las fichas con atenciones han vuelto dentro del plazo." />
        ) : (
          <ul className="divide-y divide-border">
            {inactivos.map((cuenta) => {
              const mensaje = `Hola ${primerNombre(cuenta.name)}, en ${clinica} notamos que ${esVet ? "hace un año no vemos a tu mascota" : "hace más de seis meses no vienes a control"}. ¿Agendamos una hora?`;
              return (
                <li key={cuenta.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="w-24 text-xs text-muted-foreground">Última {cuenta.ultima ? fecha.format(new Date(`${cuenta.ultima}T12:00:00`)) : "—"}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/pacientes/${cuenta.id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                      {cuenta.name}
                    </Link>
                  </div>
                  <WhatsApp telefono={cuenta.phone} mensaje={mensaje} />
                  <Link href="/dashboard/citas" className={buttonClasses({ size: "sm" })}>
                    Agendar
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
