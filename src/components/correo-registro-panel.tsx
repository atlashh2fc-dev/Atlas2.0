import { Check, Mail, Reply } from "lucide-react";

import { marcarCorreoAtendido, responderCorreoDeRegistro } from "@/app/actions/correo-registro";
import { ActionForm, ActionSubmit, Badge, SectionCard } from "@/components/ui";
import { sinCita } from "@/lib/correo/sin-cita";

/**
 * El correo con el cliente dentro de la ficha: lo que respondió al buzón de la
 * cuenta, a quién quedó asignado y lo que se le contestó. Se contesta desde
 * acá, por el mismo buzón, para que el hilo no se vaya a una casilla personal.
 */

export type CorreoRecibido = {
  id: string;
  from_name: string | null;
  from_address: string;
  subject: string;
  body_text: string;
  received_at: string;
  status: "new" | "converted";
  asignacion: "agenda" | "cotizacion" | "propietario" | "supervision" | "cola" | "reasignado" | null;
  profiles: { full_name: string } | { full_name: string }[] | null;
};

export type CorreoEnviado = {
  id: string;
  respuesta_a: string | null;
  destinatario: string;
  asunto: string;
  cuerpo: string;
  estado: "enviando" | "enviado" | "fallido";
  error: string | null;
  created_at: string;
  profiles: { full_name: string } | { full_name: string }[] | null;
};

const MOTIVO: Record<NonNullable<CorreoRecibido["asignacion"]>, string> = {
  agenda: ", que tiene la agenda",
  cotizacion: ", que envió la propuesta",
  propietario: ", que es el ejecutivo del registro",
  supervision: " por supervisión",
  cola: " por la cola de correo",
  reasignado: ", porque quien lo tenía no estaba disponible",
};

const cuando = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function uno<T>(valor: T | T[] | null): T | null {
  return Array.isArray(valor) ? valor[0] ?? null : valor;
}

export function CorreoRegistroPanel({
  leadId,
  recibidos,
  enviados,
  puedeResponder,
}: {
  leadId: string;
  recibidos: CorreoRecibido[];
  enviados: CorreoEnviado[];
  puedeResponder: boolean;
}) {
  if (!recibidos.length) return null;
  const hilo = [
    ...recibidos.map((correo) => ({ tipo: "recibido" as const, fecha: correo.received_at, correo })),
    ...enviados.map((correo) => ({ tipo: "enviado" as const, fecha: correo.created_at, correo })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const pendientes = recibidos.filter((correo) => correo.status === "new");
  const ultimo = [...recibidos].sort((a, b) => b.received_at.localeCompare(a.received_at))[0]!;

  return (
    <SectionCard
      title="Correo con el cliente"
      description="Respuestas que llegaron al buzón de la cuenta. Se contestan desde acá, por el mismo buzón."
      icon={Mail}
      tone="teal"
      actions={pendientes.length ? <Badge tone="warning">{pendientes.length} sin atender</Badge> : <Badge tone="success">Al día</Badge>}
    >
      <div className="space-y-3 p-4">
        {hilo.map((item) => {
          if (item.tipo === "recibido") {
            const correo = item.correo;
            const dueno = uno(correo.profiles)?.full_name ?? null;
            return (
              <article key={`r-${correo.id}`} className={`rounded-xl border p-4 ${correo.status === "new" ? "border-warning/50 bg-warning/5" : "border-border bg-surface-muted"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {correo.from_name || correo.from_address}
                    {correo.from_name && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{correo.from_address}</span>}
                  </p>
                  <time className="text-xs text-muted-foreground">{cuando.format(new Date(correo.received_at))}</time>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{correo.subject}</p>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{sinCita(correo.body_text)}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {dueno
                    ? `Asignada a ${dueno}${correo.asignacion ? MOTIVO[correo.asignacion] : ""}.`
                    : "Sin ejecutivo asignado: la atiende supervisión."}
                  {correo.status === "converted" ? " Atendida." : ""}
                </p>
              </article>
            );
          }
          const correo = item.correo;
          return (
            <article key={`e-${correo.id}`} className="ml-6 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{uno(correo.profiles)?.full_name ?? "Ejecutivo"} → {correo.destinatario}</p>
                <time className="text-xs text-muted-foreground">{cuando.format(new Date(correo.created_at))}</time>
              </div>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{correo.cuerpo}</p>
              {correo.estado === "fallido" && <p className="mt-2 text-xs text-danger">No salió: {correo.error ?? "el servidor de correo lo rechazó"}.</p>}
            </article>
          );
        })}

        {puedeResponder && (
          <ActionForm action={responderCorreoDeRegistro} success="Respuesta enviada" className="border-t border-border pt-4">
            <input type="hidden" name="lead_id" value={leadId} />
            <input type="hidden" name="correo_id" value={ultimo.id} />
            <label className="block text-sm font-medium text-foreground" htmlFor="correo-registro-texto">
              Responder a {ultimo.from_name || ultimo.from_address}
            </label>
            <textarea
              id="correo-registro-texto"
              name="texto"
              required
              minLength={2}
              maxLength={20000}
              rows={4}
              placeholder="Tu firma se agrega sola al final."
              className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              <ActionSubmit pendingLabel="Enviando…">
                <Reply size={15} aria-hidden="true" /> Enviar respuesta
              </ActionSubmit>
            </div>
          </ActionForm>
        )}
        {puedeResponder && pendientes.length > 0 && (
          <ActionForm action={marcarCorreoAtendido} success="Marcada como atendida" className="flex justify-end">
            <input type="hidden" name="lead_id" value={leadId} />
            <input type="hidden" name="correo_id" value={pendientes.at(-1)?.id ?? ""} />
            <ActionSubmit variant="ghost" size="sm" pendingLabel="Guardando…">
              <Check size={14} aria-hidden="true" /> Ya la atendí por otro medio
            </ActionSubmit>
          </ActionForm>
        )}
      </div>
    </SectionCard>
  );
}
