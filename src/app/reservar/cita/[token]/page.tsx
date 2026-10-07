import type { Metadata } from "next";
import { CalendarCheck2, CalendarX2 } from "lucide-react";

import { clientePublico } from "@/lib/reserva.server";

import { CancelarCita } from "./cancelar";

export const metadata: Metadata = { title: "Tu hora", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type CitaPublica = {
  empresa: string;
  servicio: string;
  profesional: string;
  inicio: string;
  estado: string;
  mascota: string | null;
  cancelable: boolean;
  reserva_slug: string | null;
};

const fechaLarga = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", weekday: "long", day: "numeric", month: "long" });
const hora = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const ESTADO: Record<string, string> = {
  reservada: "Reservada",
  confirmada: "Confirmada",
  en_sala: "En atención",
  atendida: "Atendida",
  no_vino: "No asististe",
  cancelada: "Cancelada",
};

/**
 * La hora que alguien reservó en línea, vista desde el enlace que le llegó.
 * El token largo es la llave; desde acá se puede cancelar hasta 2 horas
 * antes, y la hora queda libre para otra persona.
 */
export default async function MiCitaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let cita: CitaPublica | null = null;
  if (/^[a-f0-9]{32,64}$/.test(token)) {
    const { data } = await clientePublico().rpc("cita_publica", { p_token: token });
    cita = (data as CitaPublica | null) ?? null;
  }
  const cancelada = cita?.estado === "cancelada";

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <article className="mx-auto w-full max-w-md space-y-5 rounded-xl border border-border bg-surface p-6 shadow-sm">
        {!cita ? (
          <div className="space-y-2 text-center">
            <h1 className="text-lg font-semibold">No encontramos esta hora</h1>
            <p className="text-sm text-muted-foreground">Revisa que el enlace esté completo o escríbele a la clínica.</p>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3">
              <span className={`flex size-11 items-center justify-center rounded-full ${cancelada ? "bg-surface-muted text-muted-foreground" : "bg-success-bg text-success"}`}>
                {cancelada ? <CalendarX2 size={22} aria-hidden="true" /> : <CalendarCheck2 size={22} aria-hidden="true" />}
              </span>
              <div>
                <p className="text-sm font-medium text-primary">{cita.empresa}</p>
                <h1 className="text-xl font-semibold tracking-tight">{cancelada ? "Hora cancelada" : "Tu hora"}</h1>
              </div>
            </header>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Cuándo</dt><dd className="text-right font-medium first-letter:uppercase">{fechaLarga.format(new Date(cita.inicio))}, {hora.format(new Date(cita.inicio))}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Servicio</dt><dd className="text-right font-medium">{cita.servicio}{cita.mascota ? ` · ${cita.mascota}` : ""}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Con</dt><dd className="text-right font-medium">{cita.profesional}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Estado</dt><dd className="text-right font-medium">{ESTADO[cita.estado] ?? cita.estado}</dd></div>
            </dl>
            {cita.cancelable ? (
              <CancelarCita token={token} />
            ) : !cancelada && ["reservada", "confirmada"].includes(cita.estado) ? (
              <p className="text-sm text-muted-foreground">Faltan menos de 2 horas: para cancelar, escríbele directamente a la clínica.</p>
            ) : null}
            {cita.reserva_slug && (cancelada || !cita.cancelable) && (
              <a href={`/reservar/${cita.reserva_slug}`} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Reservar otra hora
              </a>
            )}
          </>
        )}
      </article>
    </main>
  );
}
