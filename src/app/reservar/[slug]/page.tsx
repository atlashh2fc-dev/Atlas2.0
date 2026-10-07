import type { Metadata } from "next";

import { clientePublico } from "@/lib/reserva.server";
import type { ReservaPublica } from "@/lib/reserva";

import { AsistenteDeReserva } from "./asistente";

export const dynamic = "force-dynamic";

async function leer(slug: string): Promise<ReservaPublica | null> {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  const { data, error } = await clientePublico().rpc("reserva_publica", { p_slug: slug });
  if (error) {
    console.error("[reserva] página", error.message);
    return null;
  }
  return (data as ReservaPublica | null) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const datos = await leer(slug);
  return {
    title: datos ? `Reserva tu hora · ${datos.empresa}` : "Reserva tu hora",
    description: datos ? `Elige el servicio y la hora en ${datos.empresa}. Te confirmamos por WhatsApp.` : undefined,
    robots: { index: false, follow: false },
  };
}

/**
 * La reserva en línea de una empresa. La abre cualquiera desde el enlace de
 * Instagram, Google o la web de la clínica; con `?embebido=1` se muestra sin
 * marco para ir dentro de un iframe.
 */
export default async function ReservarPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ embebido?: string }> }) {
  const { slug } = await params;
  const { embebido } = await searchParams;
  const datos = await leer(slug);
  const sinMarco = embebido === "1";

  return (
    <main className={`min-h-screen bg-background text-foreground ${sinMarco ? "px-4 py-4" : "px-4 py-8 sm:py-12"}`}>
      <div className="mx-auto w-full max-w-lg space-y-6">
        {!datos ? (
          <section className="space-y-2 rounded-xl border border-border bg-surface p-6 text-center">
            <h1 className="text-lg font-semibold">Esta reserva no está disponible</h1>
            <p className="text-sm text-muted-foreground">Puede que el enlace haya cambiado. Pide el enlace actualizado a la clínica.</p>
          </section>
        ) : (
          <>
            {!sinMarco && (
              <header className="space-y-1">
                <p className="text-sm font-medium text-primary">Reserva tu hora</p>
                <h1 className="text-2xl font-semibold tracking-tight">{datos.empresa}</h1>
                {datos.mensaje && <p className="text-sm text-muted-foreground">{datos.mensaje}</p>}
              </header>
            )}
            {datos.servicios.length === 0 || datos.profesionales.length === 0 ? (
              <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted-foreground">
                Por ahora no hay horas para reservar en línea. Escríbenos y te buscamos un espacio.
              </p>
            ) : (
              <AsistenteDeReserva slug={slug} datos={datos} embebido={sinMarco} />
            )}
            {!sinMarco && <p className="pt-4 text-center text-[11px] text-muted-foreground">Reservas con Atlas</p>}
          </>
        )}
      </div>
    </main>
  );
}
