import { unstable_noStore as noStore } from "next/cache";
import { Mail } from "lucide-react";

import { guardarBuzon, guardarBuzonDeEnvio } from "@/app/actions/buzon";
import { CampanasDelBuzon, type OpcionCampana } from "@/components/campanas-del-buzon";
import { ActionForm, ActionSubmit, Badge, Callout, Field, Input, PageHeader, SectionCard, SubmitButton } from "@/components/ui";
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
  // El contact center tiene un buzón por cuenta, elegido por campaña.
  if (edicion === "center") return <BuzonesDeEnvio empresa={empresa} />;
  const clinica = true;
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

type BuzonDeEnvio = {
  id: string;
  address: string;
  label: string;
  imap_host: string | null;
  imap_port: number | null;
  smtp_host: string | null;
  smtp_port: number | null;
  usuario: string | null;
  remitente: string | null;
  clave_secreto: string | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
};

/**
 * Los buzones de envío del contact center. Cada cuenta (Equifax, Abogado
 * Legal…) tiene el suyo y marca qué campañas lo usan: sus propuestas y
 * respuestas salen de ahí con el nombre del ejecutivo, y lo que llega se liga
 * a registros de esas campañas y se asigna a su dueño.
 */
async function BuzonesDeEnvio({ empresa }: { empresa: string | null }) {
  const supabase = await createClient();
  const [{ data: buzonesData }, { data: campanasData }, { data: enlacesData }] = await Promise.all([
    supabase
      .from("inbound_mailboxes")
      .select("id, address, label, imap_host, imap_port, smtp_host, smtp_port, usuario, remitente, clave_secreto, last_synced_at, last_sync_error")
      .is("campaign_id", null)
      .eq("active", true)
      .order("created_at"),
    supabase.from("campaigns").select("id, name").eq("is_active", true).order("name"),
    supabase.from("buzon_campanas").select("campaign_id, mailbox_id"),
  ]);
  const buzones = (buzonesData ?? []) as BuzonDeEnvio[];
  const campanas = (campanasData ?? []) as { id: string; name: string }[];
  const enlaces = (enlacesData ?? []) as { campaign_id: string; mailbox_id: string }[];
  const direccion = new Map(buzones.map((buzon) => [buzon.id, buzon.address]));

  const opcionesPara = (mailboxId: string | null): OpcionCampana[] =>
    campanas.map((campana) => {
      const enlace = enlaces.find((fila) => fila.campaign_id === campana.id);
      return {
        id: campana.id,
        nombre: campana.name,
        otroBuzon: enlace && enlace.mailbox_id !== mailboxId ? direccion.get(enlace.mailbox_id) ?? "otro buzón" : null,
      };
    });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Correo de envío"
        description={`Un buzón por cuenta de ${empresa ?? "la empresa"}. Las propuestas y respuestas de sus campañas salen de ahí con el nombre y la firma de cada ejecutivo; lo que llega se lee cada diez minutos, se liga al registro y se asigna a quien tiene la agenda o envió la propuesta.`}
      />

      {buzones.map((buzon) => {
        const marcadas = enlaces.filter((fila) => fila.mailbox_id === buzon.id).map((fila) => fila.campaign_id);
        return (
          <SectionCard
            key={buzon.id}
            icon={Mail}
            tone="teal"
            title={buzon.label || buzon.address}
            description={buzon.address}
            actions={
              buzon.last_sync_error ? (
                <Badge tone="danger">Falló la lectura</Badge>
              ) : buzon.last_synced_at ? (
                <Badge tone="success">Leído {cuando.format(new Date(buzon.last_synced_at))}</Badge>
              ) : (
                <Badge tone="warning">Sin leer todavía</Badge>
              )
            }
          >
            {buzon.last_sync_error && (
              <Callout tone="danger" className="mx-4 mt-4">
                <p className="font-medium">No se pudo leer el buzón</p>
                <p>{buzon.last_sync_error}. Casi siempre es la clave o el usuario: corrígelos y guarda.</p>
              </Callout>
            )}
            <FormularioBuzon buzon={buzon} opciones={opcionesPara(buzon.id)} marcadas={marcadas} empresa={empresa} />
          </SectionCard>
        );
      })}

      {buzones.length === 0 ? (
        <SectionCard icon={Mail} tone="teal" title="Conectar un buzón" description="Los datos que te entrega tu proveedor de correo (en cPanel: Cuentas de correo › Connect Devices). Si el servidor IMAP y el SMTP son el mismo, repítelo.">
          <FormularioBuzon buzon={null} opciones={opcionesPara(null)} marcadas={[]} empresa={empresa} />
        </SectionCard>
      ) : (
        <details className="group rounded-xl border border-dashed border-border bg-surface">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-primary">
            <Mail size={15} aria-hidden="true" /> Conectar otro buzón para otra cuenta
          </summary>
          <div className="border-t border-border">
            <FormularioBuzon buzon={null} opciones={opcionesPara(null)} marcadas={[]} empresa={empresa} />
          </div>
        </details>
      )}
    </div>
  );
}

function FormularioBuzon({ buzon, opciones, marcadas, empresa }: { buzon: BuzonDeEnvio | null; opciones: OpcionCampana[]; marcadas: string[]; empresa: string | null }) {
  return (
    <ActionForm action={guardarBuzonDeEnvio} success={buzon ? "Buzón guardado" : "Buzón conectado"} className="grid gap-4 px-4 py-4 sm:grid-cols-2">
      {buzon && <input type="hidden" name="id" value={buzon.id} />}
      <Field label="Dirección">
        <Input name="address" type="email" required defaultValue={buzon?.address ?? ""} placeholder="ventas@empresa.cl" />
      </Field>
      <Field label="Nombre para mostrar">
        <Input name="remitente" defaultValue={buzon?.remitente ?? ""} placeholder={empresa ?? "Empresa"} />
      </Field>
      <Field label="Servidor IMAP (lectura)">
        <Input name="imap_host" required defaultValue={buzon?.imap_host ?? ""} placeholder="mail.empresa.cl" />
      </Field>
      <Field label="Puerto IMAP">
        <Input name="imap_port" inputMode="numeric" defaultValue={buzon?.imap_port ?? 993} />
      </Field>
      <Field label="Servidor SMTP (envío)">
        <Input name="smtp_host" required defaultValue={buzon?.smtp_host ?? ""} placeholder="mail.empresa.cl" />
      </Field>
      <Field label="Puerto SMTP">
        <Input name="smtp_port" inputMode="numeric" defaultValue={buzon?.smtp_port ?? 465} />
      </Field>
      <Field label="Usuario">
        <Input name="usuario" defaultValue={buzon?.usuario ?? ""} placeholder="La dirección completa" />
      </Field>
      <Field label={buzon?.clave_secreto ? "Clave (deja vacío para mantenerla)" : "Clave"}>
        <Input name="clave" type="password" autoComplete="new-password" required={!buzon} placeholder="••••••••" />
      </Field>
      <Field label="Etiqueta">
        <Input name="label" defaultValue={buzon?.label ?? ""} placeholder="Buzón Equifax" />
      </Field>
      <div />
      <CampanasDelBuzon opciones={opciones} marcadas={marcadas} />
      <div className="flex justify-end sm:col-span-2">
        <ActionSubmit pendingLabel="Guardando…">{buzon ? "Guardar buzón" : "Conectar buzón"}</ActionSubmit>
      </div>
    </ActionForm>
  );
}
