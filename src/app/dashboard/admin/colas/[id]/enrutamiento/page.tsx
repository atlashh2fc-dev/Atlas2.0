import { notFound } from "next/navigation";
import { Route, ScrollText } from "lucide-react";

import { saveContactCenterQueue } from "@/app/actions/contact-center-queues";
import { ActionForm, ActionSubmit, Field, Input, SectionCard, Select } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function QueueRoutingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data: queue } = await supabase.from("contact_center_queues").select("routing_mode, service_level_seconds, max_concurrent_per_agent, max_correos_por_agente, sla_correo_segundos").eq("id", id).maybeSingle();
  if (!queue) notFound();

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,34rem)_minmax(20rem,1fr)]">
      <SectionCard icon={Route} tone="rose" title="Estrategia ACD" description="La misma política distribuye interacciones de todas las fuentes conectadas a esta cola.">
        <ActionForm action={saveContactCenterQueue} success="Enrutamiento actualizado" className="space-y-4 p-4">
          <input type="hidden" name="queue_id" value={id} />
          <Field label="Estrategia de asignación"><Select name="routing_mode" defaultValue={queue.routing_mode}><option value="least_loaded">Automática · menor carga</option><option value="manual">Manual · selección desde cola</option></Select></Field>
          <fieldset className="space-y-3 rounded-xl border border-border p-3">
            <legend className="px-1 text-xs font-semibold text-muted-foreground">WhatsApp</legend>
            <Field label="Conversaciones abiertas por ejecutivo"><Input name="max_concurrent_per_agent" type="number" min={1} max={500} defaultValue={queue.max_concurrent_per_agent ?? ""} placeholder="Sin límite" /></Field>
            <Field label="Responder antes de (minutos)"><Input name="service_level_minutes" type="number" min={1} max={1440} required defaultValue={Math.round(queue.service_level_seconds / 60)} /></Field>
          </fieldset>
          <fieldset className="space-y-3 rounded-xl border border-border p-3">
            <legend className="px-1 text-xs font-semibold text-muted-foreground">Correo</legend>
            <Field label="Clientes con correo pendiente por ejecutivo"><Input name="max_correos_por_agente" type="number" min={1} max={500} required defaultValue={queue.max_correos_por_agente ?? 10} /></Field>
            <Field label="Primera respuesta antes de (horas)"><Input name="sla_correo_horas" type="number" min={0.25} max={168} step={0.25} required defaultValue={(queue.sla_correo_segundos ?? 14400) / 3600} /></Field>
          </fieldset>
          <ActionSubmit pendingLabel="Guardando…">Guardar enrutamiento</ActionSubmit>
        </ActionForm>
      </SectionCard>
      <SectionCard icon={ScrollText} tone="slate" title="Comportamiento" description="Reglas operativas de la estrategia seleccionada.">
        <div className="space-y-3 p-4 text-sm leading-6 text-muted-foreground">
          <p><strong className="text-foreground">Menor carga:</strong> entrega al miembro con menos interacciones abiertas, primero a quien está conectado y con ese canal prendido.</p>
          <p><strong className="text-foreground">Correo:</strong> si el cliente ya tiene dueño (agenda, propuesta o registro) le llega a él; si no, a la cola. Si el dueño no está y vence la primera respuesta, pasa a otro miembro.</p>
          <p><strong className="text-foreground">Voz:</strong> la reparte el discador por campaña. Una pausa como «Correo / cotizaciones» saca de voz y deja recibir correo.</p>
          <p><strong className="text-foreground">Capacidad:</strong> si todos llegan al máximo, la interacción permanece visible sin asignar.</p>
          <p><strong className="text-foreground">Manual:</strong> no asigna automáticamente; un responsable la distribuye desde Performance o la bandeja.</p>
          <p><strong className="text-foreground">SLA:</strong> mide cuánto lleva esperando una respuesta del equipo, sin mezclarlo con el tiempo del cliente.</p>
        </div>
      </SectionCard>
    </div>
  );
}
