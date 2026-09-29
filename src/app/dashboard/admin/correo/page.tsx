import { unstable_noStore as noStore } from "next/cache";
import { Mail } from "lucide-react";

import { guardarBuzon } from "@/app/actions/buzon";
import { Callout, Field, Input, PageHeader, SectionCard, SubmitButton } from "@/components/ui";
import { ZONA_CLINICA } from "@/lib/citas";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

/**
 * El correo de la clínica. Con el buzón conectado, Atlas lee lo que llega
 * (cada diez minutos), lo liga a la ficha y responde desde el mismo buzón.
 * La clave se guarda en el Vault de la base; acá nunca se vuelve a mostrar.
 */

const cuando = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function CorreoPage() {
  noStore();
  const { empresa, edicion } = await contextoDeMiEmpresa();
  // En las clínicas es "el correo de la clínica"; en el contact center, el
  // buzón desde el que salen las propuestas (cotizador Equifax) y se leen las respuestas.
  const clinica = edicion !== "center";
  const supabase = await createClient();
  const { data: buzon } = await supabase
    .from("inbound_mailboxes")
    .select("address, label, imap_host, imap_port, smtp_host, smtp_port, usuario, remitente, clave_secreto, last_synced_at, last_sync_error, active")
    .is("campaign_id", null)
    .limit(1)
    .maybeSingle();

  return (
    <div className="space-y-5">
      <PageHeader
        title={clinica ? "Correo de la clínica" : "Correo de envío"}
        description={
          clinica
            ? `El buzón desde el que ${empresa ?? "la clínica"} lee y responde. Lo que llega se liga a la ficha; las respuestas salen por el mismo buzón.`
            : `El buzón único de la cuenta Equifax. Las propuestas y respuestas salen de acá con el nombre y la firma de cada ejecutivo; Atlas lee lo que llega cada diez minutos, lo liga al registro y se lo asigna a quien tiene la agenda o envió la propuesta.`
        }
      />

      {buzon ? (
        <Callout tone={buzon.last_sync_error ? "warning" : "success"}>
          <p className="font-medium">
            {buzon.address}
            {buzon.clave_secreto ? " · clave guardada" : " · falta la clave"}
          </p>
          <p>
            {buzon.last_sync_error
              ? `Última lectura falló: ${buzon.last_sync_error}`
              : buzon.last_synced_at
                ? `Última lectura ${cuando.format(new Date(buzon.last_synced_at))}.`
                : "Todavía no se ha leído. Se lee cada diez minutos."}
          </p>
        </Callout>
      ) : (
        <Callout tone="info">
          <p className="font-medium">Todavía no hay buzón</p>
          <p>
            {clinica
              ? "Sin buzón, los correos de recordatorio se simulan en la demostración y no salen en una clínica real. Conecta la casilla de la clínica acá."
              : "Sin buzón, los ejecutivos solo pueden mandar propuestas por WhatsApp. Conecta la casilla desde la que deben salir los correos."}
          </p>
        </Callout>
      )}

      <SectionCard icon={Mail} tone="teal" title="Buzón" description="Los datos que te entrega tu proveedor de correo. Si el servidor IMAP y el SMTP son el mismo, repítelo. Gmail y Outlook exigen una contraseña de aplicación.">
        <form action={guardarBuzon} className="grid gap-4 px-4 py-4 sm:grid-cols-2">
          <Field label="Dirección">
            <Input name="address" type="email" required defaultValue={buzon?.address ?? ""} placeholder={clinica ? "contacto@clinica.cl" : "propuestas@empresa.cl"} />
          </Field>
          <Field label="Nombre para mostrar">
            <Input name="remitente" defaultValue={buzon?.remitente ?? empresa ?? ""} placeholder={empresa ?? (clinica ? "Clínica" : "Empresa")} />
          </Field>
          <Field label="Servidor IMAP (lectura)">
            <Input name="imap_host" required defaultValue={buzon?.imap_host ?? ""} placeholder="imap.proveedor.cl" />
          </Field>
          <Field label="Puerto IMAP">
            <Input name="imap_port" inputMode="numeric" defaultValue={buzon?.imap_port ?? 993} />
          </Field>
          <Field label="Servidor SMTP (envío)">
            <Input name="smtp_host" required defaultValue={buzon?.smtp_host ?? ""} placeholder="smtp.proveedor.cl" />
          </Field>
          <Field label="Puerto SMTP">
            <Input name="smtp_port" inputMode="numeric" defaultValue={buzon?.smtp_port ?? 465} />
          </Field>
          <Field label="Usuario">
            <Input name="usuario" defaultValue={buzon?.usuario ?? ""} placeholder="Normalmente la misma dirección" />
          </Field>
          <Field label={buzon?.clave_secreto ? "Clave (deja vacío para mantenerla)" : "Clave"}>
            <Input name="clave" type="password" autoComplete="new-password" placeholder="••••••••" />
          </Field>
          <Field label="Etiqueta">
            <Input name="label" defaultValue={buzon?.label ?? (clinica ? "Correo de la clínica" : "Correo de envío")} />
          </Field>
          <div className="flex items-end">
            <SubmitButton pendingLabel="Guardando…">Guardar buzón</SubmitButton>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
