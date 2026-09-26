import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCallReasonCatalogFromWorkflow, type CallReasonConfig } from "@/lib/call-typification";
import type { WorkflowStep, WorkflowStepBranch } from "@/lib/types";

/**
 * Catálogo de motivos del workflow de una campaña, el mismo árbol que ve la
 * ficha. Lo usa Discado para ofrecer y validar el motivo de conexión corta.
 */
export async function fetchCampaignReasonCatalog(
  supabase: SupabaseClient,
  campaignId: string
): Promise<CallReasonConfig[]> {
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("workflow_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignError) throw new Error(campaignError.message);
  const workflowId = campaign?.workflow_id ?? null;
  if (!workflowId) return [];

  const [{ data: steps, error: stepsError }, { data: branches, error: branchesError }] = await Promise.all([
    supabase.from("workflow_steps").select("*").eq("workflow_id", workflowId).order("step_order", { ascending: true }),
    supabase.from("workflow_step_branches").select("*").eq("workflow_id", workflowId),
  ]);
  if (stepsError) throw new Error(stepsError.message);
  if (branchesError) throw new Error(branchesError.message);
  return buildCallReasonCatalogFromWorkflow(
    (steps ?? []) as WorkflowStep[],
    (branches ?? []) as WorkflowStepBranch[]
  );
}
