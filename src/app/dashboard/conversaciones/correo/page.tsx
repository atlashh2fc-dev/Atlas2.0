import Link from "next/link";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, SectionCard } from "@/components/ui";

/**
 * Pestaña de correo del puesto de atención.
 *
 * La bandeja vive dentro de su campaña (`/dashboard/campanas/[id]/correo`) y su
 * RLS la limita a quien puede operarla. Acá solo se resuelve a cuál entrar, en
 * vez de duplicar la bandeja: con un solo buzón se entra directo, y con varios
 * se elige.
 */
export default async function MailAttentionPage() {
  await requireProfile(["supervisor", "admin"]);
  const supabase = await createClient();

  const { data: mailboxes } = await supabase
    .from("inbound_mailboxes")
    .select("id, address, label, campaign_id, last_synced_at, campaigns(name)")
    .eq("active", true)
    .order("label");

  const rows = (mailboxes ?? []) as {
    id: string;
    address: string;
    label: string | null;
    campaign_id: string;
    campaigns: { name: string } | { name: string }[] | null;
  }[];

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Sin buzones activos"
        description="Ninguna de tus campañas con correo habilitado tiene un buzón configurado."
      />
    );
  }

  if (rows.length === 1) redirect(`/dashboard/campanas/${rows[0].campaign_id}/correo`);

  return (
    <SectionCard title="Buzones" description="Elige la campaña cuyo correo quieres revisar.">
      <ul className="divide-y divide-border">
        {rows.map((mailbox) => {
          const embedded = Array.isArray(mailbox.campaigns) ? mailbox.campaigns[0] : mailbox.campaigns;
          return (
            <li key={mailbox.id}>
              <Link
                href={`/dashboard/campanas/${mailbox.campaign_id}/correo`}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-surface-muted"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">
                    {mailbox.label ?? mailbox.address}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{mailbox.address}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{embedded?.name ?? "Sin campaña"}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
