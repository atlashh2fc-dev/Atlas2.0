"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createWorkflow(formData: FormData) {
  const name = formData.get("name") as string;
  const description = (formData.get("description") as string) || null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflows")
    .insert({ name, description })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/flujos");
  redirect(`/dashboard/admin/flujos/${data.id}`);
}

export async function toggleWorkflowActive(formData: FormData) {
  const workflowId = formData.get("workflow_id") as string;
  const active = formData.get("active") === "true";

  const supabase = await createClient();
  const { error } = await supabase
    .from("workflows")
    .update({ is_active: !active })
    .eq("id", workflowId);

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/flujos");
}

export async function addWorkflowStep(formData: FormData) {
  const workflowId = formData.get("workflow_id") as string;
  const name = formData.get("name") as string;
  const description = (formData.get("description") as string) || null;
  const isMandatory = formData.get("is_mandatory") === "on";
  const allowedResultsRaw = (formData.get("allowed_results") as string) || "";
  const allowedResults = allowedResultsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("workflow_steps")
    .select("step_order")
    .eq("workflow_id", workflowId)
    .order("step_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (existing?.step_order ?? 0) + 1;

  const { error } = await supabase.from("workflow_steps").insert({
    workflow_id: workflowId,
    step_order: nextOrder,
    name,
    description,
    is_mandatory: isMandatory,
    allowed_results: allowedResults.length > 0 ? allowedResults : null,
  });

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/flujos/${workflowId}`);
}

export async function deleteWorkflowStep(formData: FormData) {
  const stepId = formData.get("step_id") as string;
  const workflowId = formData.get("workflow_id") as string;

  const supabase = await createClient();
  const { error } = await supabase.from("workflow_steps").delete().eq("id", stepId);

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/flujos/${workflowId}`);
}

export async function assignLeadWorkflow(formData: FormData) {
  const leadId = formData.get("lead_id") as string;
  const workflowId = (formData.get("workflow_id") as string) || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ workflow_id: workflowId })
    .eq("id", leadId);

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/leads/${leadId}`);
}
