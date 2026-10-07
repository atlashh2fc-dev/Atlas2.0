import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, MessageSquareText, Settings2 } from "lucide-react";

import { guardarRecordatorios } from "@/app/actions/configuracion-agenda";
import { TextoPlantillaEditor } from "@/components/texto-plantilla-editor";
import { ActionForm, ActionSubmit, Callout, Field, PageHeader, SectionCard, Select, buttonClasses } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { configuracionDesdeFila, HORAS_DE_ENVIO, OPCIONES_ANTICIPACION, resumenRecordatorio } from "@/lib/configuracion-agenda";
import { clinicaDe } from "@/lib/ediciones";
import { PLANTILLAS, PLANTILLAS_EDITABLES, type ClavePlantilla } from "@/lib/mensajes/plantillas";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

/**
 * Configurar la agenda: cuándo sale el recordatorio de cita, si la respuesta
 * de la persona confirma o cancela sola, y el texto de cada mensaje.
 *
 * Supervisión ve la configuración; solo un administrador la cambia.
 */

const MENSAJES_DE_CITA: ClavePlantilla[] = ["cita_confirmar", "cita_recordatorio", "cita_confirmada", "cita_cancelada", "cita_reagendar"];

export default async function ConfiguracionAgendaPage() {
  await connection();
  const profile = await requireProfile(["admin", "supervisor"]);
  const puedeEditar = profile.role === "admin";
  const { edicion, empresa } = await contextoDeMiEmpresa();
  const tipo = clinicaDe(edicion);
  const supabase = await createClient();
  const { data: orgId } = await supabase.rpc("current_org_id");
  const { data } = typeof orgId === "string"
    ? await supabase.from("configuracion_agenda").select("*").eq("organization_id", orgId).maybeSingle()
    : { data: null };
  const configuracion = configuracionDesdeFila(data);

  const deSeguimiento: ClavePlantilla[] = [
    "presupuesto",
    ...(tipo === "vet" ? (["vacuna", "control"] as ClavePlantilla[]) : []),
    ...(tipo === "dental" ? (["control"] as ClavePlantilla[]) : []),
    ...(tipo === "barber" ? (["mantencion"] as ClavePlantilla[]) : []),
  ];

  const editor = (clave: ClavePlantilla) => (
    <TextoPlantillaEditor
      key={clave}
      clave={clave}
      nombre={PLANTILLAS[clave].nombre}
      original={PLANTILLAS[clave].cuerpo}
      propio={configuracion.textos[clave] ?? null}
      variables={PLANTILLAS_EDITABLES[clave] ?? []}
      clinica={empresa ?? "tu clínica"}
      puedeEditar={puedeEditar}
    />
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Configurar la agenda"
        icon={Settings2}
        description="Cuándo sale el recordatorio, qué pasa cuando la persona responde y con qué palabras le escribe Atlas."
        actions={
          <Link href="/dashboard/citas" className={buttonClasses({ variant: "ghost" })}>
            <ArrowLeft size={16} aria-hidden="true" /> Volver a la agenda
          </Link>
        }
      />

      {!puedeEditar && <Callout tone="info">Puedes ver la configuración. Para cambiarla, pídeselo a un administrador.</Callout>}

      <SectionCard title="Recordatorio de cita" description={resumenRecordatorio(configuracion)}>
        <ActionForm action={guardarRecordatorios} success="Listo: los próximos recordatorios salen así" className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="¿Cuándo sale?">
              <Select name="recordatorio_dias_antes" defaultValue={String(configuracion.recordatorio_dias_antes)} disabled={!puedeEditar}>
                {OPCIONES_ANTICIPACION.map((opcion) => (
                  <option key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</option>
                ))}
              </Select>
            </Field>
            <Field label="Desde qué hora">
              <Select name="recordatorio_desde" defaultValue={configuracion.recordatorio_desde} disabled={!puedeEditar}>
                {HORAS_DE_ENVIO.map((hora) => (
                  <option key={hora} value={hora}>{hora}</option>
                ))}
              </Select>
            </Field>
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-3">
            <input
              type="checkbox"
              name="confirmacion_automatica"
              value="si"
              defaultChecked={configuracion.confirmacion_automatica}
              disabled={!puedeEditar}
              className="mt-0.5 size-4 accent-[var(--color-primary)]"
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium text-foreground">La respuesta confirma o cancela sola</span>
              <span className="block text-xs text-muted-foreground">
                «Sí», «confirmo» o 👍 confirman la cita. «No» o «no puedo» la cancelan y liberan la hora. «Quiero cambiar la hora» deja una tarea para
                ofrecer otra. Lo que no queda claro (una pregunta, un mensaje largo) lo lee una persona en Conversaciones.
              </span>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            Si la cita se agenda cuando ya pasó el día del recordatorio, sale igual ese mismo día, siempre que falten más de 2 horas. Nunca sale
            después de las 21:00.
          </p>
          {puedeEditar && (
            <div className="flex justify-end">
              <ActionSubmit pendingLabel="Guardando…">Guardar recordatorio</ActionSubmit>
            </div>
          )}
        </ActionForm>
      </SectionCard>

      <SectionCard
        title={<span className="flex items-center gap-2"><MessageSquareText size={16} aria-hidden="true" /> Mensajes de la cita</span>}
        description="El recordatorio y la respuesta que recibe la persona cuando contesta."
      >
        <div className="divide-y divide-border [&>*]:py-5 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">{MENSAJES_DE_CITA.map(editor)}</div>
      </SectionCard>

      <SectionCard title="Mensajes de seguimiento" description="Los que hacen volver: presupuestos sin respuesta y controles pendientes.">
        <div className="divide-y divide-border [&>*]:py-5 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">{deSeguimiento.map(editor)}</div>
      </SectionCard>
    </div>
  );
}
