import Link from "next/link";

import { SectionCard } from "@/components/ui";
import { ETIQUETA_ESTADO, ZONA_CLINICA, fechaEnChile, minutosEnChile, ocupaHorario, type Cita, type Profesional } from "@/lib/citas";

/**
 * La semana de la agenda: una columna por día, las citas pintadas con el
 * color de cada profesional. Sirve para ver de un vistazo qué días vienen
 * llenos y dónde hay espacio; el detalle y las acciones están en el día
 * (se abre tocando el encabezado).
 */

const ALTO_HORA = 48;
const ANCHO_HORAS = 48;
const hora = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const cabecera = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", weekday: "short" });
const numero = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", day: "numeric" });

type Bloqueo = { id: string; profesional_id: string | null; desde: string; hasta: string; motivo: string | null };

export function SemanaDeAgenda({
  dias,
  hoy,
  citas,
  profesionales,
  bloqueos,
  apertura,
  cierre,
  enlaceDia,
  quien,
}: {
  dias: string[];
  hoy: string;
  citas: Cita[];
  profesionales: Profesional[];
  bloqueos: Bloqueo[];
  apertura: number;
  cierre: number;
  enlaceDia: (fecha: string) => string;
  quien: (cita: Cita) => string;
}) {
  const color = new Map(profesionales.map((profesional) => [profesional.id, profesional.color]));
  const nombre = new Map(profesionales.map((profesional) => [profesional.id, profesional.nombre]));
  const horas = cierre - apertura;
  const alto = horas * ALTO_HORA;
  const y = (minutos: number) => ((minutos - apertura * 60) / 60) * ALTO_HORA;
  const activasPorDia = new Map(dias.map((fecha) => [fecha, citas.filter((cita) => fechaEnChile(new Date(cita.inicio)) === fecha && ocupaHorario(cita.estado))]));

  return (
    <SectionCard title="Semana" description="Toca un día para ver el detalle por profesional y confirmar, pasar a sala o dar por atendida.">
      <div className="max-h-[70vh] overflow-auto">
        <div className="min-w-[760px]">
          <div className="sticky top-0 z-20 flex border-b border-border bg-surface" style={{ paddingLeft: ANCHO_HORAS }}>
            {dias.map((fecha) => {
              const instante = new Date(`${fecha}T12:00:00Z`);
              const activas = activasPorDia.get(fecha) ?? [];
              const sinConfirmar = activas.filter((cita) => cita.estado === "reservada").length;
              return (
                <Link
                  key={fecha}
                  href={enlaceDia(fecha)}
                  aria-current={fecha === hoy ? "date" : undefined}
                  className="flex min-h-14 flex-1 flex-col items-center justify-center border-l border-border px-1 py-1.5 hover:bg-surface-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="text-[11px] capitalize text-muted-foreground">{cabecera.format(instante).replace(".", "")}</span>
                  <span className={`flex size-7 items-center justify-center rounded-full text-sm font-semibold ${fecha === hoy ? "bg-primary text-primary-foreground" : "text-foreground"}`}>{numero.format(instante)}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {activas.length} {activas.length === 1 ? "cita" : "citas"}
                    {sinConfirmar ? ` · ${sinConfirmar} s/c` : ""}
                  </span>
                </Link>
              );
            })}
          </div>
          <div className="relative flex" style={{ height: alto }}>
            <div className="sticky left-0 z-10 shrink-0 bg-surface" style={{ width: ANCHO_HORAS }}>
              {Array.from({ length: horas }).map((_, indice) => (
                <div key={indice} className="absolute right-2 text-[11px] tabular-nums text-muted-foreground" style={{ top: indice * ALTO_HORA - 7 }}>
                  {String(apertura + indice).padStart(2, "0")}:00
                </div>
              ))}
            </div>
            {dias.map((fecha) => {
              const propias = citas.filter((cita) => fechaEnChile(new Date(cita.inicio)) === fecha);
              // Citas que se pisan en el mismo día (distintos profesionales) se reparten el ancho.
              const carriles: { fin: number }[] = [];
              const ubicadas = propias
                .slice()
                .sort((a, b) => a.inicio.localeCompare(b.inicio))
                .map((cita) => {
                  const inicio = new Date(cita.inicio).getTime();
                  let carril = carriles.findIndex((ocupado) => ocupado.fin <= inicio);
                  if (carril === -1) {
                    carriles.push({ fin: new Date(cita.fin).getTime() });
                    carril = carriles.length - 1;
                  } else {
                    carriles[carril] = { fin: new Date(cita.fin).getTime() };
                  }
                  return { cita, carril };
                });
              const totalCarriles = Math.max(1, carriles.length);
              const inicioDia = new Date(`${fecha}T00:00:00-04:00`).getTime();
              return (
                <div key={fecha} className={`relative flex-1 border-l border-border ${fecha === hoy ? "bg-primary/[0.03]" : ""}`}>
                  {Array.from({ length: horas }).map((_, indice) => (
                    <div key={indice} className="absolute inset-x-0 border-t border-border/60" style={{ top: indice * ALTO_HORA }} aria-hidden="true" />
                  ))}
                  {bloqueos
                    .filter((bloqueo) => !bloqueo.profesional_id)
                    .filter((bloqueo) => fechaEnChile(new Date(bloqueo.desde)) <= fecha && fechaEnChile(new Date(bloqueo.hasta)) >= fecha)
                    .map((bloqueo) => (
                      <div
                        key={bloqueo.id}
                        className="absolute inset-0 z-[1] flex items-start justify-center pt-2 text-[11px] text-muted-foreground"
                        style={{ backgroundImage: "repeating-linear-gradient(135deg, var(--surface-muted) 0 6px, transparent 6px 12px)" }}
                      >
                        <span className="rounded bg-surface px-1.5">{bloqueo.motivo ?? "Cerrado"}</span>
                      </div>
                    ))}
                  {ubicadas.map(({ cita, carril }) => {
                    const top = Math.max(0, y(minutosEnChile(new Date(cita.inicio))));
                    const duracion = Math.max(15, (new Date(cita.fin).getTime() - new Date(cita.inicio).getTime()) / 60000);
                    const activa = ocupaHorario(cita.estado);
                    const tono = color.get(cita.profesional_id) ?? "#64748b";
                    return (
                      <Link
                        key={cita.id}
                        href={`/dashboard/pacientes/${cita.cuenta_id}`}
                        title={`${hora.format(new Date(cita.inicio))} · ${quien(cita)} · ${cita.motivo} · ${nombre.get(cita.profesional_id) ?? ""} · ${ETIQUETA_ESTADO[cita.estado].label}`}
                        className={`absolute z-[2] overflow-hidden rounded-md px-1 text-[10px] leading-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activa ? "text-foreground" : "text-muted-foreground line-through opacity-60"}`}
                        style={{
                          top: top + 1,
                          height: Math.max(14, (duracion / 60) * ALTO_HORA - 2),
                          left: `calc(${(carril / totalCarriles) * 100}% + 2px)`,
                          width: `calc(${100 / totalCarriles}% - 4px)`,
                          backgroundColor: activa ? `color-mix(in srgb, ${tono} 22%, var(--surface))` : "var(--surface)",
                          borderLeft: `3px solid ${tono}`,
                        }}
                      >
                        <span className="font-semibold tabular-nums">{hora.format(new Date(cita.inicio))}</span> {quien(cita)}
                      </Link>
                    );
                  })}
                  {fecha === hoy && (() => {
                    const ahora = Date.now();
                    const minutos = minutosEnChile(new Date(ahora));
                    if (minutos < apertura * 60 || minutos > cierre * 60 || ahora < inicioDia) return null;
                    return <div className="pointer-events-none absolute inset-x-0 z-[3] border-t-2 border-danger" style={{ top: y(minutos) }} aria-hidden="true" />;
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        {profesionales.map((profesional) => (
          <span key={profesional.id} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: profesional.color }} aria-hidden="true" /> {profesional.nombre}
          </span>
        ))}
      </div>
    </SectionCard>
  );
}
