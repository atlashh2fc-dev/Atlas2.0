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
import { upsertDialerCampaignConfig } from "@/app/actions/dialer-config";
import { DIAL_MODES, type DialerCampaignConfig } from "@/lib/types";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", id).single();
  if (!campaign) notFound();

  const [{ data: workflows }, { data: members }, { data: agents }, { count: leadCount }, { data: dialerConfig }] =
    await Promise.all([
      supabase.from("workflows").select("id, name").order("name"),
      supabase
        .from("campaign_agents")
        .select("id, profile_id, profiles(full_name, email)")
        .eq("campaign_id", id)
        .order("assigned_at", { ascending: true }),
      supabase.from("profiles").select("id, full_name, email").eq("role", "agente").order("full_name"),
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", id),
      supabase.from("dialer_campaign_configs").select("*").eq("campaign_id", id).maybeSingle(),
    ]);

  const dc = dialerConfig as DialerCampaignConfig | null;

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
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/admin/campanas/${campaign.id}/dashboard`}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Ver dashboard
          </Link>
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

      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-1 text-sm font-semibold text-foreground">Configuración de discado</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Define cómo el motor de discado maneja esta campaña. Los ejecutivos asignados arriba son los
          que se sincronizan como miembros de la cola.
        </p>
        <form action={upsertDialerCampaignConfig} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="campaign_id" value={campaign.id} />

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground">Modo de discado</span>
            <select
              name="dial_mode"
              defaultValue={dc?.dial_mode ?? "manual"}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {DIAL_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground">Ratio de discado</span>
            <input
              type="number"
              name="max_dial_ratio"
              step="0.1"
              min="0.1"
              defaultValue={dc?.max_dial_ratio ?? 1.0}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground">Tiempo entre llamadas (seg.)</span>
            <input
              type="number"
              name="wrapup_seconds"
              min="0"
              max="600"
              defaultValue={dc?.wrapup_seconds ?? 5}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground">Caller ID (E.164)</span>
            <input
              type="text"
              name="caller_id"
              placeholder="+16507062614"
              defaultValue={dc?.caller_id ?? ""}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground">Nombre de la cola (Asterisk)</span>
            <input
              type="text"
              name="queue_name"
              required
              placeholder="campania_ventas"
              defaultValue={dc?.queue_name ?? ""}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground">Trunk / contexto saliente</span>
            <input
              type="text"
              name="trunk_context"
              defaultValue={dc?.trunk_context ?? "twilio"}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>

          <label className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" name="is_active" value="true" defaultChecked={dc?.is_active ?? false} />
            <span className="text-sm text-foreground">Campaña activa para el motor de discado</span>
          </label>

          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Guardar configuración
            </button>
          </div>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">
          {DIAL_MODES.find((m) => m.value === (dc?.dial_mode ?? "manual"))?.description}
        </p>
      </div>
    </div>
  );
}
