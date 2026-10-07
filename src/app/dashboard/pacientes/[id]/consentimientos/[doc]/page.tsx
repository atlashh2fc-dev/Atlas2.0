import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileSignature, Printer, Send } from "lucide-react";

import { anularConsentimiento, enviarEnlaceConsentimiento, firmarConsentimiento } from "@/app/actions/consentimientos";
import { CamposDeFirma } from "@/components/firmar-formulario";
import { ActionForm, ActionSubmit, Badge, PageHeader, SectionCard, buttonClasses } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fechaHora = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * Un consentimiento de la ficha. Pendiente: se firma acá (la tablet del
 * mesón) o se manda el enlace al celular. Firmado: queda el texto, quién,
 * cuándo y la firma; se imprime o guarda como PDF.
 */
export default async function ConsentimientoPage({ params }: { params: Promise<{ id: string; doc: string }> }) {
  const { id, doc } = await params;
  if (!UUID.test(id) || !UUID.test(doc)) notFound();
  const supabase = await createClient();
  const { data } = await supabase
    .from("consentimientos")
    .select("id, cuenta_id, titulo, texto, estado, firmante_nombre, firmante_rut, firma_svg, firmado_at, firmado_desde, created_at, sales_companies(name, rut, phone, email)")
    .eq("id", doc)
    .eq("cuenta_id", id)
    .maybeSingle();
  if (!data) notFound();
  const persona = (Array.isArray(data.sales_companies) ? data.sales_companies[0] : data.sales_companies) as { name: string; rut: string | null; phone: string | null; email: string | null } | null;
  const firmado = data.estado === "firmado";
  const anulado = data.estado === "anulado";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title={data.titulo}
        icon={FileSignature}
        description={persona?.name}
        meta={<Badge tone={firmado ? "success" : anulado ? "neutral" : "warning"}>{firmado ? "Firmado" : anulado ? "Anulado" : "Pendiente de firma"}</Badge>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/dashboard/pacientes/${id}`} className={buttonClasses({ variant: "ghost" })}><ArrowLeft size={16} aria-hidden="true" /> Ficha</Link>
            {firmado && (
              <Link href={`/imprimir/consentimiento/${doc}`} target="_blank" className={buttonClasses({ variant: "secondary" })}><Printer size={16} aria-hidden="true" /> Imprimir o PDF</Link>
            )}
          </div>
        }
      />

      <SectionCard title="Documento">
        <div className="whitespace-pre-line text-sm leading-relaxed text-foreground">{data.texto}</div>
        {firmado && (
          <div className="mt-6 space-y-2 border-t border-border pt-4">
            {data.firma_svg && (
              // Como imagen: un SVG dentro de <img> no ejecuta nada.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.firma_svg)}`} alt={`Firma de ${data.firmante_nombre ?? ""}`} className="h-28 w-64 rounded-md border border-border bg-white object-contain p-1" />
            )}
            <p className="text-sm">
              Firmado por <span className="font-medium">{data.firmante_nombre}</span>
              {data.firmante_rut ? ` (${data.firmante_rut})` : ""} el {fechaHora.format(new Date(data.firmado_at as string))}
              {data.firmado_desde === "enlace" ? ", desde su celular" : ", en la clínica"}.
            </p>
          </div>
        )}
      </SectionCard>

      {!firmado && !anulado && (
        <>
          <SectionCard title="Firmar ahora" description="Pásale la pantalla a la persona: lee, escribe su nombre y firma con el dedo.">
            <ActionForm action={firmarConsentimiento} success="Consentimiento firmado">
              <input type="hidden" name="id" value={doc} />
              <input type="hidden" name="cuenta_id" value={id} />
              <CamposDeFirma nombreInicial={persona?.name} rutInicial={persona?.rut}>
                {(listo) => (
                  <div className="flex justify-end">
                    <ActionSubmit disabled={!listo} pendingLabel="Guardando…">Firmar y guardar</ActionSubmit>
                  </div>
                )}
              </CamposDeFirma>
            </ActionForm>
          </SectionCard>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ActionForm action={enviarEnlaceConsentimiento} success={persona?.phone ? "Enlace enviado por WhatsApp" : "Enlace enviado por correo"}>
              <input type="hidden" name="id" value={doc} />
              <ActionSubmit variant="secondary" pendingLabel="Enviando…" disabled={!persona?.phone && !persona?.email}>
                <Send size={16} aria-hidden="true" /> Mandar enlace para firmar en su celular
              </ActionSubmit>
            </ActionForm>
            <ActionForm action={anularConsentimiento} success="Documento anulado" confirm={{ title: "¿Anular este consentimiento?", description: "Queda en la ficha como anulado y ya no se puede firmar.", confirmLabel: "Anular", tone: "danger" }}>
              <input type="hidden" name="id" value={doc} />
              <input type="hidden" name="cuenta_id" value={id} />
              <ActionSubmit variant="ghost" pendingLabel="…">Anular</ActionSubmit>
            </ActionForm>
          </div>
        </>
      )}
    </div>
  );
}
