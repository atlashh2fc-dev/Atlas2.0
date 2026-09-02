import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui";
import { ATTENTION_TABS, getEnabledChannels } from "@/lib/campaign-channels";

/**
 * `/dashboard/conversaciones` ya no es una pantalla: es el índice del puesto de
 * atención y manda al primer canal que la campaña tenga habilitado. Antes
 * llevaba siempre a WhatsApp, incluso en campañas donde no existe.
 */
export default async function AttentionIndexPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const enabled = await getEnabledChannels(supabase, profile);
  const first = ATTENTION_TABS.find((tab) => enabled.includes(tab.channel));

  if (first) redirect(first.href);

  // El layout ya explica por qué no hay canales; acá no hace falta repetirlo.
  return <EmptyState title="Sin canales de atención" description="No hay nada que atender todavía." />;
}
