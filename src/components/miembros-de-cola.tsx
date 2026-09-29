import { Users } from "lucide-react";

import { saveContactCenterQueueMembers } from "@/app/actions/contact-center-queues";
import { ActionForm, ActionSubmit, EmptyState, SectionCard } from "@/components/ui";
import type { AppRole } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";

/**
 * Quién atiende la cola. Administración ve y define el roster completo;
 * supervisión ve solo a los ejecutivos de sus equipos (su RLS de perfiles) y
 * los mueve de cola según la carga del día, sin tocar a los de otros equipos.
 */
export async function MiembrosDeCola({ queueId, rol }: { queueId: string; rol: AppRole }) {
  const supabase = await createClient();
  const [{ data: members }, { data: agents }] = await Promise.all([
    supabase.from("contact_center_queue_members").select("profile_id").eq("queue_id", queueId).eq("is_active", true),
    supabase.from("profiles").select("id, full_name, email").eq("role", "agente").eq("active", true).order("full_name"),
  ]);
  const selected = new Set((members ?? []).map((member) => member.profile_id));
  const visibles = (agents ?? []).filter((agent) => selected.has(agent.id)).length;

  return (
    <SectionCard
      icon={Users}
      tone="blue"
      title={rol === "admin" ? `Miembros de la cola (${selected.size})` : `Tus ejecutivos en esta cola (${visibles})`}
      description={
        rol === "admin"
          ? "Quienes están acá reciben el WhatsApp y el correo de las fuentes de la cola, según su presencia y capacidad. La voz se reparte por la campaña en el discador."
          : "Marca a quienes deben atender esta cola. Reciben su WhatsApp y su correo cuando tienen ese canal prendido; los ejecutivos de otros equipos no cambian."
      }
    >
      <ActionForm action={saveContactCenterQueueMembers} success="Miembros actualizados" className="p-4">
        <input type="hidden" name="queue_id" value={queueId} />
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {(agents ?? []).map((agent) => (
            <label key={agent.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-background p-3 transition-colors hover:border-border-strong has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input type="checkbox" name="profile_ids" value={agent.id} defaultChecked={selected.has(agent.id)} className="accent-primary" />
              <span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground">{agent.full_name}</span><span className="block truncate text-xs text-muted-foreground">{agent.email}</span></span>
            </label>
          ))}
        </div>
        {(agents ?? []).length === 0 && <EmptyState icon={Users} title={rol === "admin" ? "No hay agentes activos disponibles." : "No tienes ejecutivos activos en tus equipos."} className="py-6" />}
        <ActionSubmit className="mt-4" pendingLabel="Guardando…">Guardar miembros</ActionSubmit>
      </ActionForm>
    </SectionCard>
  );
}
