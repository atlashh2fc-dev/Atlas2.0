import { notFound } from "next/navigation";

import { saveContactCenterQueue } from "@/app/actions/contact-center-queues";
import { ActionForm, ActionSubmit, Field, Input, SectionCard, Select } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Grupo, PieDeFormulario } from "../../../_diseno";

export default async function QueueRoutingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data: queue } = await supabase.from("contact_center_queues").select("routing_mode, service_level_seconds, max_concurrent_per_agent, max_correos_por_agente, sla_correo_segundos").eq("id", id).maybeSingle();
  if (!queue) notFound();

  return (
    <div className="space-y-5">
      <SectionCard title="Estrategia ACD" description="La misma política distribuye interacciones de todas las fuentes conectadas a esta cola.">
        <ActionForm action={saveContactCenterQueue} success="Enrutamiento actualizado" className="divide-y divide-border border-t border-border">
          <input type="hidden" name="queue_id" value={id} />
          <Grupo titulo="Asignación" descripcion="Automática entrega al miembro con menos carga; manual deja la interacción en la cola para que alguien la reparta." columnas={1}>
            <Field label="Estrategia de asignación" className="max-w-sm">
              <Select name="routing_mode" defaultValue={queue.routing_mode}>
                <option value="least_loaded">Automática · menor carga</option>
                <option value="manual">Manual · selección desde cola</option>
              </Select>
            </Field>
          </Grupo>
          <Grupo titulo="WhatsApp" descripcion="Cuántas conversaciones lleva cada ejecutivo a la vez y en cuánto debe responder.">
            <Field label="Conversaciones abiertas por ejecutivo">
              <Input name="max_concurrent_per_agent" type="number" min={1} max={500} defaultValue={queue.max_concurrent_per_agent ?? ""} placeholder="Sin límite" />
            </Field>
            <Field label="Responder antes de (minutos)">
              <Input name="service_level_minutes" type="number" min={1} max={1440} required defaultValue={Math.round(queue.service_level_seconds / 60)} />
            </Field>
          </Grupo>
          <Grupo titulo="Correo" descripcion="Cuántos clientes con correo pendiente lleva cada ejecutivo y el plazo de la primera respuesta.">
            <Field label="Clientes con correo pendiente por ejecutivo">
              <Input name="max_correos_por_agente" type="number" min={1} max={500} required defaultValue={queue.max_correos_por_agente ?? 10} />
            </Field>
            <Field label="Primera respuesta antes de (horas)">
              <Input name="sla_correo_horas" type="number" min={0.25} max={168} step={0.25} required defaultValue={(queue.sla_correo_segundos ?? 14400) / 3600} />
            </Field>
          </Grupo>
          <PieDeFormulario>
            <ActionSubmit pendingLabel="Guardando…">Guardar enrutamiento</ActionSubmit>
          </PieDeFormulario>
        </ActionForm>
      </SectionCard>
      <SectionCard title="Cómo se comporta" description="Reglas operativas de la estrategia seleccionada.">
        <dl className="divide-y divide-border/70 border-t border-border text-sm">
          {COMPORTAMIENTO.map((regla) => (
            <div key={regla.titulo} className="grid gap-1 px-5 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
              <dt className="font-medium text-foreground">{regla.titulo}</dt>
              <dd className="leading-relaxed text-muted-foreground">{regla.texto}</dd>
            </div>
          ))}
        </dl>
      </SectionCard>
    </div>
  );
}

const COMPORTAMIENTO = [
  { titulo: "Menor carga", texto: "Entrega al miembro con menos interacciones abiertas, primero a quien está conectado y con ese canal prendido." },
  { titulo: "Correo", texto: "Si el cliente ya tiene dueño (agenda, propuesta o registro) le llega a él; si no, a la cola. Si el dueño no está y vence la primera respuesta, pasa a otro miembro." },
  { titulo: "Voz", texto: "La reparte el discador por campaña. Una pausa como «Correo / cotizaciones» saca de voz y deja recibir correo." },
  { titulo: "Capacidad", texto: "Si todos llegan al máximo, la interacción permanece visible sin asignar." },
  { titulo: "Manual", texto: "No asigna automáticamente; un responsable la distribuye desde Performance o la bandeja." },
  { titulo: "SLA", texto: "Mide cuánto lleva esperando una respuesta del equipo, sin mezclarlo con el tiempo del cliente." },
];
