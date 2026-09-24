"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type AgentCampaignBoardRow = {
  profile_id: string;
  full_name: string;
  team_name: string | null;
  extension: string | null;
  active_campaign_id: string | null;
  active_campaign_name: string | null;
  locked: boolean;
  source: "agente" | "supervisor" | "prioridad" | null;
  assigned_by: string | null;
  assigned_by_name: string | null;
  changed_at: string | null;
  campaigns: { campaign_id: string; name: string; priority: number; dial_mode: string }[];
};

// Los permisos viven en las RPC: un supervisor solo alcanza a sus equipos y una
// campaña fijada solo la mueve quien la fijó (o un admin).

export async function listAgentCampaignBoard(): Promise<AgentCampaignBoardRow[]> {
  await requireProfile(["supervisor", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("supervisor_agent_campaign_board");
  if (error) throw new Error(error.message);
  return (data ?? []) as AgentCampaignBoardRow[];
}

/** Manda al ejecutivo a una campaña y la deja fija hasta que quien la fijó la cambie. */
export async function assignAgentCampaign(profileId: string, campaignId: string): Promise<void> {
  await requireProfile(["supervisor", "admin"]);
  if (!profileId || !campaignId) throw new Error("Elige ejecutivo y campaña.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("supervisor_set_agent_campaign", {
    p_profile_id: profileId,
    p_campaign_id: campaignId,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/team", "layout");
}

/** Devuelve al ejecutivo la libertad de elegir; se queda en la campaña actual. */
export async function releaseAgentCampaign(profileId: string): Promise<void> {
  await requireProfile(["supervisor", "admin"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("supervisor_release_agent_campaign", { p_profile_id: profileId });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/team", "layout");
}

/** Orden de prioridad de las campañas del ejecutivo: la primera se disca primero. */
export async function setAgentCampaignPriorities(profileId: string, campaignIds: string[]): Promise<void> {
  await requireProfile(["supervisor", "admin"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("supervisor_set_agent_campaign_priorities", {
    p_profile_id: profileId,
    p_campaign_ids: campaignIds,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/team", "layout");
}
