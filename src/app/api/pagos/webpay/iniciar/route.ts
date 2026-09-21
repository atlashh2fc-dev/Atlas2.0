import { NextResponse } from "next/server";

import { pasarelaActiva } from "@/lib/pagos/pasarela";
import { guardarToken, leerPagoPublico, origenDe } from "@/lib/pagos/servidor";

export const dynamic = "force-dynamic";

/**
 * Manda a la persona a pagar. Crea la transacción en la pasarela, guarda el
 * token en el pago y responde con un formulario que se envía solo: Webpay
 * exige llegar por POST con `token_ws`.
 *
 * Es pública a propósito: el enlace de pago lo abre el tutor o el paciente
 * desde WhatsApp, sin cuenta en Atlas. Solo actúa sobre un pago pendiente
 * cuyo id (imposible de adivinar) venga en el formulario.
 */
export async function POST(request: Request) {
  const formulario = await request.formData();
  const id = String(formulario.get("pago") ?? "");
  const pago = await leerPagoPublico(id);
  const origen = origenDe(request);

  if (!pago) return NextResponse.redirect(`${origen}/pagar/${encodeURIComponent(id)}?resultado=no-existe`, 303);
  if (pago.estado !== "pendiente") return NextResponse.redirect(`${origen}/pagar/${pago.id}`, 303);

  const pasarela = pasarelaActiva();
  let transaccion;
  try {
    transaccion = await pasarela.crear({ pagoId: pago.id, monto: Number(pago.monto), urlRetorno: `${origen}/api/pagos/webpay/retorno` });
    await guardarToken(pago.id, transaccion.token);
  } catch (error) {
    console.error("[pagos] no se pudo iniciar el cobro en línea", error instanceof Error ? error.message : error);
    return NextResponse.redirect(`${origen}/pagar/${pago.id}?resultado=error`, 303);
  }

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Redirigiendo a Webpay…</title>
<meta name="robots" content="noindex"><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#333}</style></head>
<body><form id="ir" method="${transaccion.metodo}" action="${transaccion.url}">
<input type="hidden" name="${transaccion.campoToken ?? "token_ws"}" value="${transaccion.token}">
<p>Te estamos llevando a ${pasarela.etiqueta}… <button type="submit">Continuar</button></p>
</form><script>document.getElementById("ir").submit();</script></body></html>`;
  return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
