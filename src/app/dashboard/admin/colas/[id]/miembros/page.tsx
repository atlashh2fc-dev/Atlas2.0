import { saveContactCenterQueueMembers } from "@/app/actions/contact-center-queues";
import { ActionForm, ActionSubmit, SectionCard } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function QueueMembersPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: members }, { data: agents }] = await Promise.all([
    supabase.from("contact_center_queue_members").select("profile_id").eq("queue_id", id).eq("is_active", true),
    supabase.from("profiles").select("id, full_name, email").eq("role", "agente").eq("active", true).order("full_name"),
  ]);
  const selected = new Set((members ?? []).map((member) => member.profile_id));

  return (
    <SectionCard title={`Miembros de la cola (${selected.size})`} description="La membresía ACD es independiente del proveedor y de la propiedad comercial de un lead.">
      <ActionForm action={saveContactCenterQueueMembers} success="Miembros actualizados" className="p-4">
        <input type="hidden" name="queue_id" value={id} />
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {(agents ?? []).map((agent) => (
            <label key={agent.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 hover:bg-surface-muted">
              <input type="checkbox" name="profile_ids" value={agent.id} defaultChecked={selected.has(agent.id)} className="accent-primary" />
              <span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground">{agent.full_name}</span><span className="block truncate text-xs text-muted-foreground">{agent.email}</span></span>
            </label>
          ))}
        </div>
        {(agents ?? []).length === 0 && <p className="text-sm text-muted-foreground">No hay agentes activos disponibles.</p>}
        <ActionSubmit className="mt-4" pendingLabel="Guardando…">Guardar miembros</ActionSubmit>
      </ActionForm>
    </SectionCard>
  );
}
