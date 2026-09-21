import { NextResponse } from "next/server";

import { pasarelaActiva } from "@/lib/pagos/pasarela";
import { cerrarPago, leerPagoPorToken, origenDe } from "@/lib/pagos/servidor";

export const dynamic = "force-dynamic";

/**
 * La vuelta desde Webpay. Llega por POST con `token_ws` cuando la persona
 * terminó el flujo, con `TBK_TOKEN` cuando lo abandonó, y por GET cuando se
 * venció el tiempo. En todos los casos se cierra el pago y se vuelve a la
 * página pública de pago con el resultado.
 */
async function manejar(request: Request, campos: URLSearchParams | FormData) {
  const origen = origenDe(request);
  const valor = (nombre: string) => {
    const bruto = campos.get(nombre);
    return typeof bruto === "string" ? bruto.trim() : "";
  };
  const tokenWs = valor("token_ws");
  const tokenAbandono = valor("TBK_TOKEN");
  const token = tokenWs || tokenAbandono;
  if (!token) return NextResponse.redirect(`${origen}/pagar/?resultado=sin-token`, 303);

  const pago = await leerPagoPorToken(token);
  if (!pago) return NextResponse.redirect(`${origen}/pagar/?resultado=no-existe`, 303);
  if (pago.estado !== "pendiente") return NextResponse.redirect(`${origen}/pagar/${pago.id}`, 303);

  if (!tokenWs) {
    await cerrarPago(pago.id, "anulado", null, { motivo: "abandonado", orden: valor("TBK_ORDEN_COMPRA") || null });
    return NextResponse.redirect(`${origen}/pagar/${pago.id}?resultado=anulado`, 303);
  }

  const resultado = await pasarelaActiva().confirmar(tokenWs);
  // Si la pasarela dice que cobró otro monto, no se da por pagado: queda
  // rechazado con el detalle para revisarlo a mano.
  const montoCoincide = resultado.monto === null || Math.round(resultado.monto) === Math.round(Number(pago.monto));
  const estado = resultado.estado === "pagado" && montoCoincide ? "pagado" : resultado.estado === "pagado" ? "fallido" : resultado.estado;
  await cerrarPago(pago.id, estado, resultado.referencia, { ...resultado.detalle, monto_pasarela: resultado.monto, monto_coincide: montoCoincide });
  return NextResponse.redirect(`${origen}/pagar/${pago.id}?resultado=${estado === "pagado" ? "ok" : "rechazado"}`, 303);
}

export async function POST(request: Request) {
  return manejar(request, await request.formData());
}

export async function GET(request: Request) {
  return manejar(request, new URL(request.url).searchParams);
}
