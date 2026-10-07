import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { ArrowLeft, MailPlus } from "lucide-react";

import { EditorCorreos } from "@/components/campanas-correo/editor-correos";
import { Pasos } from "@/components/campanas-correo/pasos";
import { Callout, PageHeader } from "@/components/ui";
import { capacidadesDeCorreo, empresaActual } from "@/lib/campanas-correo.server";

/** Campaña nueva: primero los correos; al guardar sigue la audiencia. */
export default async function NuevaCampanaCorreoPage() {
  await connection();
  const empresa = await empresaActual();
  if (!empresa) redirect("/dashboard/campanas-correo");
  const capacidades = await capacidadesDeCorreo(empresa.slug);
  if (!capacidades.ok || capacidades.datos.remitentes.length === 0) redirect("/dashboard/campanas-correo");

  return (
    <div className="space-y-5">
      <Link href="/dashboard/campanas-correo" className="inline-flex min-h-8 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={15} aria-hidden="true" /> Campañas de correo
      </Link>
      <PageHeader title="Nueva campaña de correo" icon={MailPlus} description="Escribe los correos y mira cómo llegan. Al guardar, eliges la audiencia en Bigdata y cuándo sale." />
      <Pasos actual="correos" />
      {capacidades.datos.remitentes.length > 1 && (
        <Callout>El remitente define la marca, el dominio desde el que sale y a dónde llegan las respuestas. No se cambia después de crear la campaña.</Callout>
      )}
      <EditorCorreos
        modo="crear"
        remitentes={capacidades.datos.remitentes}
        variables={capacidades.datos.variables}
        maxPasos={capacidades.datos.limites.pasosMax}
        imagenMb={capacidades.datos.limites.imagenMb}
        inicial={{
          nombre: "",
          remitenteId: capacidades.datos.remitentes[0]?.id,
          limiteDiario: 50,
          ctaUrl: null,
          ctaTexto: null,
          cabecera: { imagen_url: null, titulo: null, bajada: null, precio: null },
          pasos: [],
        }}
      />
    </div>
  );
}
