import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createCampaign, toggleCampaignActive } from "@/app/actions/campaigns";
import Link from "next/link";

export default async function CampaignsPage() {
  await requireProfile(["admin"]);
  const supabase = await createClient();

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("*, workflows(name)")
    .order("created_at", { ascending: true });

  const { data: leadCounts } = await supabase
    .from("leads")
    .select("campaign_id")
    .not("campaign_id", "is", null);

  const countByCampaign = new Map<string, number>();
  (leadCounts ?? []).forEach((row) => {
    const id = row.campaign_id as string;
    countByCampaign.set(id, (countByCampaign.get(id) ?? 0) + 1);
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Campañas</h1>
        <p className="text-sm text-muted-foreground">
          Cada campaña es su propio ecosistema: ejecutivos asignados, base de datos de leads y un
          flujo productivo propio.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Nombre</th>
              <th className="px-5 py-3 font-medium">Flujo productivo</th>
              <th className="px-5 py-3 font-medium">Leads</th>
              <th className="px-5 py-3 font-medium">Estado</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(campaigns ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">
                  Todavía no hay campañas creadas.
                </td>
              </tr>
            )}
            {(campaigns ?? []).map((c) => (
              <tr key={c.id}>
                <td className="px-5 py-3 font-medium text-foreground">
                  <Link href={`/dashboard/admin/campanas/${c.id}`} className="hover:text-primary">
                    {c.name}
                  </Link>
                  {c.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{c.description}</p>
                  )}
                </td>
                <td className="px-5 py-3 text-muted-foreground">
                  {(c.workflows as { name: string } | null)?.name ?? "Sin flujo asignado"}
                </td>
                <td className="px-5 py-3 text-muted-foreground">{countByCampaign.get(c.id) ?? 0}</td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                      c.is_active ? "bg-success-bg text-success" : "bg-danger-bg text-danger"
                    }`}
                  >
                    {c.is_active ? "Activa" : "Inactiva"}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <form action={toggleCampaignActive}>
                    <input type="hidden" name="campaign_id" value={c.id} />
                    <input type="hidden" name="active" value={String(c.is_active)} />
                    <button
                      type="submit"
                      className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-muted"
                    >
                      {c.is_active ? "Desactivar" : "Activar"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Crear campaña</h2>
        <form action={createCampaign} className="flex max-w-xl flex-col gap-3 sm:flex-row">
          <input
            type="text"
            name="name"
            required
            placeholder="Nombre de la campaña"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
          <input
            type="text"
            name="description"
            placeholder="Descripción (opcional)"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Crear y configurar
          </button>
        </form>
      </div>
    </div>
  );
}
