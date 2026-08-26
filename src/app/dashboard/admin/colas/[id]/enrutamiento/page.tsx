import { notFound } from "next/navigation";

import { saveContactCenterQueue } from "@/app/actions/contact-center-queues";
import { ActionForm, ActionSubmit, Field, Input, SectionCard, Select } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function QueueRoutingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data: queue } = await supabase.from("contact_center_queues").select("routing_mode, service_level_seconds, max_concurrent_per_agent").eq("id", id).maybeSingle();
  if (!queue) notFound();

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,34rem)_minmax(20rem,1fr)]">
      <SectionCard title="Estrategia ACD" description="La misma política distribuye interacciones de todas las fuentes conectadas a esta cola.">
        <ActionForm action={saveContactCenterQueue} success="Enrutamiento actualizado" className="space-y-4 p-4">
          <input type="hidden" name="queue_id" value={id} />
          <Field label="Estrategia de asignación"><Select name="routing_mode" defaultValue={queue.routing_mode}><option value="least_loaded">Automática · menor carga</option><option value="manual">Manual · selección desde cola</option></Select></Field>
          <Field label="Concurrencia máxima por agente"><Input name="max_concurrent_per_agent" type="number" min={1} max={500} defaultValue={queue.max_concurrent_per_agent ?? ""} placeholder="Sin límite" /></Field>
          <Field label="Nivel de servicio (minutos)"><Input name="service_level_minutes" type="number" min={1} max={1440} required defaultValue={Math.round(queue.service_level_seconds / 60)} /></Field>
          <ActionSubmit pendingLabel="Guardando…">Guardar enrutamiento</ActionSubmit>
        </ActionForm>
      </SectionCard>
      <SectionCard title="Comportamiento" description="Reglas operativas de la estrategia seleccionada.">
        <div className="space-y-3 p-4 text-sm leading-6 text-muted-foreground">
          <p><strong className="text-foreground">Menor carga:</strong> entrega al miembro activo con menos interacciones abiertas.</p>
          <p><strong className="text-foreground">Capacidad:</strong> si todos llegan al máximo, la interacción permanece visible sin asignar.</p>
          <p><strong className="text-foreground">Manual:</strong> no asigna automáticamente; un responsable la distribuye desde Performance o la bandeja.</p>
          <p><strong className="text-foreground">SLA:</strong> mide cuánto lleva esperando una respuesta del equipo, sin mezclarlo con el tiempo del cliente.</p>
        </div>
      </SectionCard>
    </div>
  );
}
