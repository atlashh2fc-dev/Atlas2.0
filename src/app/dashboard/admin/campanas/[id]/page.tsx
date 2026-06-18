import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  setCampaignWorkflow,
  addCampaignAgent,
  removeCampaignAgent,
  toggleCampaignActive,
} from "@/app/actions/campaigns";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", id).single();
  if (!campaign) notFound();

  const [{ data: workflows }, { data: members }, { data: agents }, { count: leadCount }] =
    await Promise.all([
      supabase.from("workflows").select("id, name").order("name"),
      supabase
        .from("campaign_agents")
        .select("id, profile_id, profiles(full_name, email)")
        .eq("campaign_id", id)
        .order("assigned_at", { ascending: true }),
      supabase.from("profiles").select("id, full_name, email").eq("role", "agente").order("full_name"),
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", id),
    ]);

  const assignedIds = new Set((members ?? []).map((m) => m.profile_id));
  const availableAgents = (agents ?? []).filter((a) => !assignedIds.has(a.id));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/dashboard/admin/campanas" className="text-xs text-muted-foreground hover:text-primary">
            ← Campañas
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-foreground">{campaign.name}</h1>
          {campaign.description && (
            <p className="text-sm text-muted-foreground">{campaign.description}</p>
          )}
        </div>
        <form action={toggleCampaignActive}>
          <input type="hidden" name="campaign_id" value={campaign.id} />
          <input type="hidden" name="active" value={String(campaign.is_active)} />
          <button
            type="submit"
            className={`rounded-lg px-3 py-2 text-xs font-medium ${
              campaign.is_active
                ? "border border-border text-foreground hover:bg-surface-muted"
                : "bg-primary text-primary-foreground hover:bg-primary-hover"
            }`}
          >
            {campaign.is_active ? "Desactivar campaña" : "Activar campaña"}
          </button>
        </form>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-xs text-muted-foreground">Leads en esta campaña (BBDD)</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{leadCount ?? 0}</p>
          <Link
            href={`/dashboard/leads/cargar?campaign_id=${campaign.id}`}
            className="mt-2 inline-block text-xs text-primary hover:underline"
          >
            Cargar más leads a esta campaña →
          </Link>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5 sm:col-span-2">
          <p className="mb-2 text-xs text-muted-foreground">Flujo productivo</p>
          <form action={setCampaignWorkflow} className="flex items-center gap-2">
            <input type="hidden" name="campaign_id" value={campaign.id} />
            <select
              name="workflow_id"
              defaultValue={campaign.workflow_id ?? ""}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Sin flujo asignado</option>
              {(workflows ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Guardar
            </button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Este es el flujo que los ejecutivos verán al gestionar leads de esta campaña. Edítalo en{" "}
            <Link href="/dashboard/admin/flujos" className="text-primary hover:underline">
              Flujos de gestión
            </Link>
            .
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Ejecutivos asignados</h2>
        <div className="divide-y divide-border">
          {(members ?? []).length === 0 && (
            <p className="py-3 text-sm text-muted-foreground">Sin ejecutivos asignados todavía.</p>
          )}
          {(members ?? []).map((m) => {
            const profileRaw = m.profiles as
              | { full_name: string; email: string }
              | { full_name: string; email: string }[]
              | null;
            const profile = Array.isArray(profileRaw) ? profileRaw[0] ?? null : profileRaw;
            return (
              <div key={m.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium text-foreground">{profile?.full_name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{profile?.email ?? "—"}</p>
                </div>
                <form action={removeCampaignAgent}>
                  <input type="hidden" name="campaign_id" value={campaign.id} />
                  <input type="hidden" name="membership_id" value={m.id} />
                  <button
                    type="submit"
                    className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-muted"
                  >
                    Quitar
                  </button>
                </form>
              </div>
            );
          })}
        </div>
        <form action={addCampaignAgent} className="mt-4 flex max-w-md items-center gap-2">
          <input type="hidden" name="campaign_id" value={campaign.id} />
          <select
            name="profile_id"
            defaultValue=""
            required
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="" disabled>
              Selecciona un ejecutivo
            </option>
            {availableAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name} ({a.email})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Agregar
          </button>
        </form>
      </div>
    </div>
  );
}
