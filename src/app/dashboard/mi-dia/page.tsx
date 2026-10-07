import Link from "next/link";
import { connection } from "next/server";
import { CalendarDays, CalendarX2, ChevronLeft, ChevronRight, HandCoins, UserRoundX } from "lucide-react";

import { marcarMiCita } from "@/app/actions/mi-dia";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { ActionForm, ActionSubmit, Badge, EmptyState, PageHeader, SectionCard, buttonClasses } from "@/components/ui";
import { ETIQUETA_ESTADO, ZONA_CLINICA, esFechaValida, fechaEnChile, instanteEnChile, ocupaHorario, sumarDias, type EstadoCita } from "@/lib/citas";
import { ATENCION_POR_EDICION, clinicaDe } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

/**
 * Mi día: lo que ve quien atiende (el barbero, la doctora). Solo sus
 * citas, con lo justo para trabajar: a quién, a qué hora, qué viene a
 * hacerse. Marca en sala, atendida o no vino; la confirmación y los cobros
 * siguen en la recepción. Abajo, su comisión del mes en curso.
 */

type MiCita = {
  id: string;
  inicio: string;
  fin: string;
  motivo: string;
  estado: EstadoCita;
  nota: string | null;
  box: string | null;
  origen: string | null;
  persona: string;
  mascota: string | null;
  especie: string | null;
};

type MiAgenda = { profesional: { id: string; nombre: string; color: string }; citas: MiCita[] } | null;
type MiLiquidacion = { atenciones: number; servicios: number; comision_servicios: number; porcentaje_servicios: number; productos: number; porcentaje_productos: number; propinas: number } | null;

const hora = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fechaLarga = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, weekday: "long", day: "numeric", month: "long" });
const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function Marcar({ cita, estado, etiqueta, variante = "secondary" }: { cita: string; estado: string; etiqueta: string; variante?: "secondary" | "ghost" }) {
  return (
    <ActionForm action={marcarMiCita} success={estado === "atendida" ? "Atendida" : estado === "en_sala" ? "En sala" : "Marcada como no vino"}>
      <input type="hidden" name="cita_id" value={cita} />
      <input type="hidden" name="estado" value={estado} />
      <ActionSubmit size="sm" variant={variante} pendingLabel="…" className="min-h-11 sm:min-h-8">{etiqueta}</ActionSubmit>
    </ActionForm>
  );
}

export default async function MiDiaPage({ searchParams }: { searchParams: Promise<{ dia?: string }> }) {
  await connection();
  const { edicion } = await contextoDeMiEmpresa();
  const at = ATENCION_POR_EDICION[clinicaDe(edicion)];
  const ahora = new Date();
  const hoy = fechaEnChile(ahora);
  const { dia: diaParam } = await searchParams;
  const dia = esFechaValida(diaParam) ? diaParam : hoy;
  const inicioMes = `${hoy.slice(0, 7)}-01`;

  const supabase = await createClient();
  const [{ data: agendaData, error }, { data: liquidacionData }] = await Promise.all([
    supabase.rpc("mi_agenda", { p_desde: instanteEnChile(dia, "00:00").toISOString(), p_hasta: instanteEnChile(sumarDias(dia, 1), "00:00").toISOString() }),
    supabase.rpc("mi_liquidacion", { p_desde: inicioMes, p_hasta: hoy }),
  ]);
  const agenda = (agendaData as MiAgenda) ?? null;
  const liquidacion = (liquidacionData as MiLiquidacion) ?? null;

  if (!agenda) {
    return (
      <div className="space-y-5">
        <PageHeader title="Mi día" icon={CalendarDays} description="Tus citas y tu comisión." />
        <EmptyState
          icon={UserRoundX}
          title="Tu usuario todavía no está en la agenda"
          description={error ? "No pudimos leer tu agenda. Vuelve a cargar." : `Pídele a la administración que te ligue en Agenda › Equipo (campo «Su usuario en Atlas»). Desde ese momento ves acá tus ${at.citas}.`}
        />
      </div>
    );
  }

  const citas = agenda.citas;
  const activas = citas.filter((cita) => ocupaHorario(cita.estado));
  const atendidas = activas.filter((cita) => cita.estado === "atendida").length;
  const siguiente = activas.find((cita) => new Date(cita.fin) > ahora && cita.estado !== "atendida");
  const comisionProductos = liquidacion ? Math.round((Number(liquidacion.productos) * Number(liquidacion.porcentaje_productos)) / 100) : 0;
  const totalMes = liquidacion ? Number(liquidacion.comision_servicios) + comisionProductos + Number(liquidacion.propinas) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Hola, ${agenda.profesional.nombre.replace(/^Dra?\.\s*/i, "").split(" ")[0]}`}
        icon={CalendarDays}
        description={`${fechaLarga.format(instanteEnChile(dia, "12:00")).replace(/^./, (letra) => letra.toUpperCase())} · ${activas.length} ${activas.length === 1 ? at.cita : at.citas}${atendidas ? `, ${atendidas} atendidas` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/dashboard/mi-dia?dia=${sumarDias(dia, -1)}`} className={buttonClasses({ variant: "secondary", size: "sm", className: "min-h-11 sm:min-h-8" })} aria-label="Día anterior"><ChevronLeft size={16} aria-hidden="true" /></Link>
            <Link href="/dashboard/mi-dia" className={buttonClasses({ variant: "secondary", size: "sm", className: `min-h-11 sm:min-h-8 ${dia === hoy ? "border-primary/50 text-primary" : ""}` })}>Hoy</Link>
            <Link href={`/dashboard/mi-dia?dia=${sumarDias(dia, 1)}`} className={buttonClasses({ variant: "secondary", size: "sm", className: "min-h-11 sm:min-h-8" })} aria-label="Día siguiente"><ChevronRight size={16} aria-hidden="true" /></Link>
          </div>
        }
      />

      {siguiente && dia === hoy && (
        <section className="rounded-xl border border-primary/30 bg-primary/5 p-4" aria-label="Lo que sigue">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">Lo que sigue</p>
          <p className="mt-1 text-lg font-semibold">{hora.format(new Date(siguiente.inicio))} · {siguiente.mascota ? `${siguiente.mascota} (${siguiente.persona})` : siguiente.persona}</p>
          <p className="text-sm text-muted-foreground">{siguiente.motivo}{siguiente.box ? ` · ${siguiente.box}` : ""}{siguiente.nota ? ` · ${siguiente.nota}` : ""}</p>
        </section>
      )}

      <SectionCard title={`Mis ${at.citas}`}>
        {citas.length === 0 ? (
          <EmptyState icon={CalendarX2} title={`Sin ${at.citas} este día`} description="Cuando la recepción o la reserva en línea te agenden, aparecen acá." />
        ) : (
          <ul className="divide-y divide-border">
            {citas.map((cita) => {
              const etiqueta = ETIQUETA_ESTADO[cita.estado];
              const pendiente = cita.estado === "reservada" || cita.estado === "confirmada";
              const yaPaso = new Date(cita.inicio) <= ahora;
              return (
                <li key={cita.id} className={`flex flex-col gap-3 py-3 sm:flex-row sm:items-center ${ocupaHorario(cita.estado) ? "" : "opacity-60"}`}>
                  <div className="w-16 shrink-0 tabular-nums">
                    <span className="block font-semibold">{hora.format(new Date(cita.inicio))}</span>
                    <span className="block text-xs text-muted-foreground">{hora.format(new Date(cita.fin))}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{cita.mascota ? `${cita.mascota} · ${cita.persona}` : cita.persona}</p>
                    <p className="truncate text-sm text-muted-foreground">{cita.motivo}{cita.box ? ` · ${cita.box}` : ""}</p>
                    {cita.nota && <p className="text-xs text-muted-foreground">{cita.nota}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={etiqueta.tone}>{etiqueta.label}</Badge>
                    {cita.origen === "reserva_online" && <Badge tone="info">En línea</Badge>}
                    {pendiente && <Marcar cita={cita.id} estado="en_sala" etiqueta="Llegó" />}
                    {(pendiente || cita.estado === "en_sala") && yaPaso && <Marcar cita={cita.id} estado="atendida" etiqueta="Atendida" />}
                    {pendiente && yaPaso && <Marcar cita={cita.id} estado="no_vino" etiqueta="No vino" variante="ghost" />}
                    {cita.estado === "en_sala" && !yaPaso && <Marcar cita={cita.id} estado="atendida" etiqueta="Atendida" />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {liquidacion && (
        <section aria-label="Mi comisión del mes" className="space-y-2">
          <h2 className="text-sm font-semibold">Mi mes hasta hoy</h2>
          <KpiStrip>
            <KpiStripItem label="Atendido" value={pesos.format(Number(liquidacion.servicios))} icon={CalendarDays} detail={`${liquidacion.atenciones} ${Number(liquidacion.atenciones) === 1 ? "atención" : "atenciones"}`} />
            <KpiStripItem label="Mi comisión" value={pesos.format(Number(liquidacion.comision_servicios) + comisionProductos)} icon={HandCoins} detail={`${Number(liquidacion.porcentaje_servicios)}% servicios · ${Number(liquidacion.porcentaje_productos)}% productos`} />
            <KpiStripItem label="Propinas" value={pesos.format(Number(liquidacion.propinas))} icon={HandCoins} />
            <KpiStripItem label="Total del mes" value={pesos.format(totalMes)} icon={HandCoins} detail="Comisión + propinas" />
          </KpiStrip>
        </section>
      )}
    </div>
  );
}
