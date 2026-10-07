import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { BotonImprimir } from "../../presupuesto/[id]/imprimir-boton";

export const metadata: Metadata = { title: "Consentimiento", robots: { index: false } };
export const dynamic = "force-dynamic";

const fechaHora = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** El consentimiento firmado en una hoja: para el archivo físico o como PDF. */
export default async function ImprimirConsentimientoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin", "supervisor"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("consentimientos").select("titulo, texto, estado, firmante_nombre, firmante_rut, firma_svg, firmado_at, firmado_desde, token, organizations(name)").eq("id", id).maybeSingle();
  if (!data) notFound();
  const clinica = (Array.isArray(data.organizations) ? data.organizations[0] : data.organizations) as { name: string } | null;
  return (
    <main className="min-h-screen bg-background px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-3xl justify-end print:hidden"><BotonImprimir /></div>
      <article className="mx-auto max-w-3xl space-y-6 rounded-xl border border-border bg-white p-8 text-[#111] print:max-w-none print:border-0">
        <header className="border-b border-[#ddd] pb-4">
          <p className="text-lg font-semibold">{clinica?.name}</p>
          <h1 className="text-xl font-semibold">{data.titulo}</h1>
        </header>
        <div className="whitespace-pre-line text-sm leading-relaxed">{data.texto}</div>
        {data.estado === "firmado" ? (
          <footer className="space-y-2 border-t border-[#ddd] pt-4 text-sm">
            {data.firma_svg && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.firma_svg)}`} alt="Firma" className="h-28 w-64 object-contain" />
            )}
            <p>Firmado por {data.firmante_nombre}{data.firmante_rut ? ` (${data.firmante_rut})` : ""} el {fechaHora.format(new Date(data.firmado_at as string))}{data.firmado_desde === "enlace" ? ", desde su celular" : ", en la clínica"}.</p>
            <p className="text-xs text-[#666]">Código de verificación: {String(data.token).slice(0, 12).toUpperCase()}</p>
          </footer>
        ) : (
          <p className="text-sm text-[#a00]">Documento {data.estado === "anulado" ? "anulado" : "pendiente de firma"}.</p>
        )}
      </article>
    </main>
  );
}
