"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { WorkflowFieldType, WorkflowStep, WorkflowStepBranch } from "@/lib/types";

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

// ---- Editor visual (canvas tipo n8n) ----

export async function createWorkflowStepNode(input: {
  workflowId: string;
  posX: number;
  posY: number;
  makeStart?: boolean;
}): Promise<WorkflowStep> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("workflow_steps")
    .select("step_order")
    .eq("workflow_id", input.workflowId)
    .order("step_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (existing?.step_order ?? 0) + 1;

  if (input.makeStart) {
    await supabase
      .from("workflow_steps")
      .update({ is_start: false })
      .eq("workflow_id", input.workflowId);
  }

  const { data, error } = await supabase
    .from("workflow_steps")
    .insert({
      workflow_id: input.workflowId,
      step_order: nextOrder,
      name: "Nuevo paso",
      description: null,
      is_mandatory: true,
      field_type: "single_choice",
      options: [],
      pos_x: input.posX,
      pos_y: input.posY,
      is_start: Boolean(input.makeStart),
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/flujos/${input.workflowId}`);
  return data as WorkflowStep;
}

export async function updateWorkflowStepNode(input: {
  stepId: string;
  workflowId: string;
  name: string;
  description: string | null;
  fieldType: WorkflowFieldType;
  options: string[];
  isMandatory: boolean;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("workflow_steps")
    .update({
      name: input.name,
      description: input.description,
      field_type: input.fieldType,
      options: input.options,
      is_mandatory: input.isMandatory,
      allowed_results: input.fieldType === "text" ? null : input.options,
    })
    .eq("id", input.stepId);

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/flujos/${input.workflowId}`);
}

export async function updateWorkflowStepPosition(input: {
  stepId: string;
  posX: number;
  posY: number;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("workflow_steps")
    .update({ pos_x: input.posX, pos_y: input.posY })
    .eq("id", input.stepId);
  if (error) throw new Error(error.message);
}

export async function setStartStep(input: {
  workflowId: string;
  stepId: string;
}): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("workflow_steps")
    .update({ is_start: false })
    .eq("workflow_id", input.workflowId);
  const { error } = await supabase
    .from("workflow_steps")
    .update({ is_start: true })
    .eq("id", input.stepId);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/flujos/${input.workflowId}`);
}

export async function deleteWorkflowStepNode(input: {
  stepId: string;
  workflowId: string;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("workflow_steps").delete().eq("id", input.stepId);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/flujos/${input.workflowId}`);
}

export async function upsertBranch(input: {
  workflowId: string;
  fromStepId: string;
  fromOption: string | null;
  toStepId: string | null;
}): Promise<WorkflowStepBranch> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflow_step_branches")
    .upsert(
      {
        workflow_id: input.workflowId,
        from_step_id: input.fromStepId,
        from_option: input.fromOption,
        to_step_id: input.toStepId,
      },
      { onConflict: "from_step_id,from_option" }
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/flujos/${input.workflowId}`);
  return data as WorkflowStepBranch;
}

export async function deleteBranch(input: {
  branchId: string;
  workflowId: string;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("workflow_step_branches").delete().eq("id", input.branchId);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/flujos/${input.workflowId}`);
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
