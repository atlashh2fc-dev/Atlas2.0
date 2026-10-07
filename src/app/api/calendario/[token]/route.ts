import { NextResponse } from "next/server";

import { clientePublico } from "@/lib/reserva.server";
import { calendarioIcs, type CitaDeCalendario } from "@/lib/calendario";

/**
 * La agenda de un profesional en formato iCalendar, para suscribirla en
 * Google Calendar, Apple o Outlook. El token largo del enlace es la llave;
 * la base solo entrega hora, motivo y primer nombre.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limpio = token.replace(/\.ics$/, "");
  if (!/^[a-f0-9]{32,64}$/.test(limpio)) return new NextResponse("No encontrado", { status: 404 });
  const { data, error } = await clientePublico().rpc("calendario_de_profesional", { p_token: limpio });
  if (error || !data) return new NextResponse("No encontrado", { status: 404 });
  const datos = data as { profesional: string; empresa: string; citas: CitaDeCalendario[] };
  return new NextResponse(calendarioIcs(datos.profesional, datos.empresa, datos.citas), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, max-age=300",
      "content-disposition": `inline; filename="agenda.ics"`,
    },
  });
}
