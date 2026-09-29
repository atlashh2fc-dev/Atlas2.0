import { cache } from "react";

import { requireProfile } from "@/lib/auth";
import { CAMPAIGN_CHANNELS, getEnabledChannels, type CampaignChannel } from "@/lib/campaign-channels";
import { createClient } from "@/lib/supabase/server";

export type PuestoDeAtencion = {
  canales: CampaignChannel[];
  /** Pendientes del ejecutivo por canal, para el contador de cada pestaña. */
  pendientes: Partial<Record<CampaignChannel, number>>;
};

/**
 * Los canales del puesto de atención. Para supervisión salen de las campañas;
 * para el ejecutivo se suman los de sus colas: si su cola atiende el buzón de
 * la campaña, ve Correo aunque la campaña no lo tenga marcado. Se pide una vez
 * por render: el layout, el índice y la pestaña comparten la respuesta.
 */
export const puestoDeAtencion = cache(async (): Promise<PuestoDeAtencion> => {
  const profile = await requireProfile();
  const supabase = await createClient();
  const [habilitados, presencia] = await Promise.all([
    getEnabledChannels(supabase, profile),
    profile.role === "agente" ? supabase.rpc("mi_presencia_digital") : Promise.resolve({ data: null }),
  ]);
  const fila = (presencia.data ?? {}) as Record<string, unknown>;
  const canales = new Set<CampaignChannel>(habilitados);
  if (fila.tiene_correo === true) canales.add("mail");
  if (fila.tiene_whatsapp === true) canales.add("whatsapp");
  return {
    canales: CAMPAIGN_CHANNELS.filter((canal) => canales.has(canal)),
    pendientes: {
      mail: Number(fila.pendientes_correo ?? 0),
      whatsapp: Number(fila.pendientes_whatsapp ?? 0),
    },
  };
});
