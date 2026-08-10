import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type OrchestratorConfig = {
  campaign_id: string;
  tick_seconds: number;
  assignment_ttl_seconds: number;
  max_dispatch_per_tick: number;
};

export async function getActiveConfigs(): Promise<OrchestratorConfig[]> {
  const { data, error } = await supabase.rpc("get_active_lead_orchestrator_configs");
  if (error) throw error;
  return (data ?? []) as OrchestratorConfig[];
}

export async function dispatchCampaign(campaignId: string, batchSize: number) {
  const { data, error } = await supabase.rpc("claim_next_lead_assignments", {
    p_campaign_id: campaignId,
    p_batch_size: batchSize,
  });
  if (error) throw error;
  return data ?? [];
}

