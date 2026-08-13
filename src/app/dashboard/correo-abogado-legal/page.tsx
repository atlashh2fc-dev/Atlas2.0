import { notFound, redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Compatibilidad con enlaces antiguos: la bandeja ahora vive dentro de su campaña. */
export default async function LegacyInboundMailboxPage() {
  await requireProfile(["supervisor", "admin"]);
  const supabase = await createClient();
  const { data: mailbox } = await supabase
    .from("inbound_mailboxes")
    .select("campaign_id")
    .eq("active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (!mailbox) notFound();
  redirect(`/dashboard/campanas/${mailbox.campaign_id}/correo`);
}
