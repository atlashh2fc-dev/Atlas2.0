import { redirect } from "next/navigation";
import { Inbox } from "lucide-react";

import { EmptyState } from "@/components/ui";
import { ATTENTION_TABS } from "@/lib/campaign-channels";
import { puestoDeAtencion } from "@/lib/presencia.server";

/**
 * `/dashboard/conversaciones` ya no es una pantalla: es el índice del puesto de
 * atención y manda al primer canal que la campaña tenga habilitado. Antes
 * llevaba siempre a WhatsApp, incluso en campañas donde no existe.
 */
export default async function AttentionIndexPage() {
  const { canales, pendientes } = await puestoDeAtencion();
  // Primero el canal donde hay trabajo esperando; si no hay, el primero.
  const conTrabajo = ATTENTION_TABS.find((tab) => canales.includes(tab.channel) && (pendientes[tab.channel] ?? 0) > 0);
  const first = conTrabajo ?? ATTENTION_TABS.find((tab) => canales.includes(tab.channel));

  if (first) redirect(first.href);

  // El layout ya explica por qué no hay canales; acá no hace falta repetirlo.
  return <EmptyState icon={Inbox} title="Sin canales de atención" description="No hay nada que atender todavía." />;
}
