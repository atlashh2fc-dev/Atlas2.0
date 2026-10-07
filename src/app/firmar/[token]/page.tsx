import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";

import { clientePublico } from "@/lib/reserva.server";

import { FormularioDeFirma } from "./formulario";

export const metadata: Metadata = { title: "Firmar consentimiento", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Publico = { titulo: string; texto: string; estado: string; empresa: string; firmante: string | null; firmado_at: string | null; persona: string };

const fechaHora = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * El consentimiento que la clínica mandó por WhatsApp: se lee completo y se
 * firma con el dedo. Sin cuenta: el token largo es la llave.
 */
export default async function FirmarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let documento: Publico | null = null;
  if (/^[a-f0-9]{32,64}$/.test(token)) {
    const { data } = await clientePublico().rpc("consentimiento_publico", { p_token: token });
    documento = (data as Publico | null) ?? null;
  }
  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground">
      <article className="mx-auto w-full max-w-2xl space-y-6 rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-8">
        {!documento ? (
          <div className="space-y-2 text-center">
            <h1 className="text-lg font-semibold">Este enlace no es válido</h1>
            <p className="text-sm text-muted-foreground">Puede que el documento se haya anulado. Pide uno nuevo a la clínica.</p>
          </div>
        ) : (
          <>
            <header className="space-y-1">
              <p className="text-sm font-medium text-primary">{documento.empresa}</p>
              <h1 className="text-xl font-semibold tracking-tight">{documento.titulo}</h1>
            </header>
            <div className="whitespace-pre-line rounded-lg bg-surface-muted/50 p-4 text-sm leading-relaxed">{documento.texto}</div>
            {documento.estado === "firmado" ? (
              <p className="flex items-center gap-2 rounded-lg bg-success-bg px-4 py-3 text-sm text-success" role="status">
                <CheckCircle2 size={18} aria-hidden="true" /> Firmado por {documento.firmante}
                {documento.firmado_at ? ` el ${fechaHora.format(new Date(documento.firmado_at))}` : ""}. Gracias.
              </p>
            ) : (
              <FormularioDeFirma token={token} nombre={documento.persona} />
            )}
          </>
        )}
      </article>
    </main>
  );
}
