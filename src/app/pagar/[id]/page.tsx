import type { Metadata } from "next";
import Image from "next/image";

import { leerPagoPublico, primero } from "@/lib/pagos/servidor";
import { pasarelaActiva } from "@/lib/pagos/pasarela";

export const metadata: Metadata = { title: "Pagar | Atlas", robots: { index: false } };
export const dynamic = "force-dynamic";

const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });

const MENSAJES: Record<string, { titulo: string; texto: string; tono: "ok" | "aviso" | "error" }> = {
  ok: { titulo: "Pago recibido", texto: "Gracias. La clínica ya lo tiene registrado; no necesitas hacer nada más.", tono: "ok" },
  rechazado: { titulo: "El pago no se completó", texto: "La tarjeta fue rechazada o la transacción no se autorizó. Puedes intentarlo de nuevo.", tono: "error" },
  anulado: { titulo: "Pago cancelado", texto: "Saliste de Webpay sin completar el pago. Puedes volver a intentarlo cuando quieras.", tono: "aviso" },
  error: { titulo: "No pudimos conectar con la pasarela", texto: "Inténtalo de nuevo en un momento. Si persiste, avisa a la clínica.", tono: "error" },
  "no-existe": { titulo: "Este enlace no es válido", texto: "Pide a la clínica que te envíe uno nuevo.", tono: "error" },
};

/**
 * La página pública de pago: la abre el tutor o el paciente desde el enlace
 * que le mandó la clínica, o la recepción cuando cobra en el mesón con
 * Webpay. No exige cuenta en Atlas; el id del pago es la llave.
 */
export default async function PagarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ resultado?: string }>;
}) {
  const { id } = await params;
  const { resultado } = await searchParams;
  const pago = await leerPagoPublico(id);
  const mensaje = resultado ? MENSAJES[resultado] : undefined;
  const pasarela = pasarelaActiva();
  const clinica = pago ? primero(pago.organizations)?.name ?? "la clínica" : "la clínica";
  const persona = pago ? primero(pago.sales_companies)?.name ?? "" : "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-12 text-foreground">
      <article className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <header className="flex items-center gap-3 border-b border-border pb-5">
          <Image src="/atlas-logo.png" alt="Atlas" width={44} height={44} className="rounded-xl" />
          <div>
            <p className="text-sm font-medium text-primary">{clinica}</p>
            <h1 className="text-xl font-semibold tracking-tight">Pago en línea</h1>
          </div>
        </header>

        {!pago ? (
          <div className="mt-6 space-y-2">
            <h2 className="text-base font-semibold">Este enlace no es válido</h2>
            <p className="text-sm text-muted-foreground">Pide a la clínica que te envíe uno nuevo.</p>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            {mensaje && (
              <div
                role="status"
                className={`rounded-lg border px-4 py-3 text-sm ${
                  mensaje.tono === "ok"
                    ? "border-success/30 bg-success-bg text-success"
                    : mensaje.tono === "aviso"
                      ? "border-warning/30 bg-warning-bg text-warning"
                      : "border-danger/30 bg-danger-bg text-danger"
                }`}
              >
                <p className="font-medium">{mensaje.titulo}</p>
                <p>{mensaje.texto}</p>
              </div>
            )}

            <dl className="space-y-2 text-sm">
              {persona && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">A nombre de</dt>
                  <dd className="text-right font-medium">{persona}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Monto</dt>
                <dd className="text-right text-2xl font-semibold tabular-nums">{pesos.format(Number(pago.monto))}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Estado</dt>
                <dd className="text-right font-medium">
                  {pago.estado === "pagado"
                    ? `Pagado${pago.pagado_at ? ` · ${fecha.format(new Date(pago.pagado_at))}` : ""}`
                    : pago.estado === "pendiente"
                      ? "Pendiente"
                      : pago.estado === "anulado"
                        ? "Cancelado"
                        : "Rechazado"}
                </dd>
              </div>
              {pago.referencia && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Autorización</dt>
                  <dd className="text-right tabular-nums">{pago.referencia}</dd>
                </div>
              )}
            </dl>

            {pago.estado === "pendiente" && (
              <form method="POST" action="/api/pagos/webpay/iniciar" className="space-y-3">
                <input type="hidden" name="pago" value={pago.id} />
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Pagar {pesos.format(Number(pago.monto))} con {pasarela.etiqueta}
                </button>
                <p className="text-center text-xs text-muted-foreground">
                  Te llevamos al sitio seguro de Transbank. Puedes pagar con débito o crédito.
                  {!pasarela.produccion && " Ambiente de prueba: no se cobra dinero real."}
                </p>
              </form>
            )}

            {pago.estado === "pagado" && !mensaje && (
              <p className="text-sm text-muted-foreground">Este pago ya fue recibido. Gracias.</p>
            )}
          </div>
        )}
      </article>
    </main>
  );
}
