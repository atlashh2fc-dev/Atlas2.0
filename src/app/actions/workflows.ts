"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { WorkflowFieldType, WorkflowStep, WorkflowStepBranch } from "@/lib/types";
import { WORKFLOW_TEMPLATES } from "@/lib/workflow-templates";
import { validateWorkflow } from "@/lib/workflow-validation";
import { requireProfile } from "@/lib/auth";

export async function createWorkflow(formData: FormData) {
  // Solo admin: crear conecta el flujo a una campaña.
  await requireProfile(["admin"]);
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;
  const campaignId = (formData.get("campaign_id") as string) || null;

  if (!name) throw new Error("El nombre del flujo es obligatorio.");

  const supabase = await createClient();

  // Validar la campaña antes de crear el flujo evita dejar flujos huérfanos
  // por un id inválido o por una campaña eliminada en otra sesión.
  if (campaignId) {
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .maybeSingle();

    if (campaignError) throw new Error(campaignError.message);
    if (!campaign) throw new Error("La campaña seleccionada ya no existe.");
  }

  const { data, error } = await supabase
    .from("workflows")
    // Nace en borrador: se publica recién cuando pasa la validación.
    .insert({ name, description, status: "draft" })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const query = new URLSearchParams({ error: "duplicate-name" });
      if (campaignId) query.set("campaign_id", campaignId);
      redirect(`/dashboard/admin/flujos?${query.toString()}`);
    }
    throw new Error(error.message);
  }

  if (campaignId) {
    const { error: campaignError } = await supabase
      .from("campaigns")
      .update({ workflow_id: data.id, updated_at: new Date().toISOString() })
      .eq("id", campaignId);

    if (campaignError) {
      // La creación ya ocurrió; compensamos para que la acción no deje un
      // flujo sin la campaña que el administrador pidió conectar.
      await supabase.from("workflows").delete().eq("id", data.id);
      throw new Error(campaignError.message);
    }
    revalidatePath(`/dashboard/admin/campanas/${campaignId}`);
    revalidatePath("/dashboard/admin/campanas");
  }

  revalidatePath("/dashboard/admin/flujos");
  const campaignContext = campaignId ? `?campaign_id=${encodeURIComponent(campaignId)}` : "";
  redirect(`/dashboard/admin/flujos/${data.id}${campaignContext}`);
}

export async function createWorkflowFromTemplate(formData: FormData) {
  // Solo admin: crear conecta el flujo a una campaña.
  await requireProfile(["admin"]);
  const templateId = formData.get("template_id") as string;
  const template = WORKFLOW_TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw new Error("Plantilla no encontrada");

  const supabase = await createClient();

  // Evita duplicar el flujo si ya se creó antes desde esta misma plantilla:
  // basta con abrir el existente para seguir editándolo.
  const { data: existingWorkflow } = await supabase
    .from("workflows")
    .select("id")
    .eq("name", template.name)
    .maybeSingle();

  if (existingWorkflow) {
    redirect(`/dashboard/admin/flujos/${existingWorkflow.id}`);
  }

  const { data: workflow, error: workflowError } = await supabase
    .from("workflows")
    .insert({ name: template.name, description: template.description, status: "draft" })
    .select("id")
    .single();

  if (workflowError) {
    if (workflowError.code === "23505") {
      redirect("/dashboard/admin/flujos?error=duplicate-name");
    }
    throw new Error(workflowError.message);
  }
  const workflowId = workflow.id as string;

  const stepRows = template.steps.map((s, index) => ({
    workflow_id: workflowId,
    step_order: index + 1,
    name: s.name,
    description: s.description,
    is_mandatory: s.isMandatory,
    field_type: s.fieldType,
    options: s.options,
    allowed_results: s.fieldType === "text" ? null : s.options,
    pos_x: s.posX,
    pos_y: s.posY,
    is_start: s.isStart,
  }));

  const { data: insertedSteps, error: stepsError } = await supabase
    .from("workflow_steps")
    .insert(stepRows)
    .select("id, step_order");

  if (stepsError) {
    await supabase.from("workflows").delete().eq("id", workflowId);
    throw new Error(stepsError.message);
  }

  // step_order es 1-based y coincide con templateIndex + 1
  const idByIndex = new Map<number, string>();
  (insertedSteps ?? []).forEach((row) => {
    idByIndex.set(row.step_order - 1, row.id as string);
  });

  const branchRows = template.branches
    .map((b) => {
      const fromStepId = idByIndex.get(b.fromIndex);
      if (!fromStepId) return null;
      const toStepId = b.toIndex !== null ? idByIndex.get(b.toIndex) ?? null : null;
      return {
        workflow_id: workflowId,
        from_step_id: fromStepId,
        from_option: b.fromOption,
        to_step_id: toStepId,
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  if (branchRows.length > 0) {
    const { error: branchesError } = await supabase.from("workflow_step_branches").insert(branchRows);
    if (branchesError) throw new Error(branchesError.message);
  }

  revalidatePath("/dashboard/admin/flujos");
  redirect(`/dashboard/admin/flujos/${workflowId}`);
}

export async function toggleWorkflowActive(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
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

/**
 * Publica o vuelve a borrador un flujo. Publicar exige que la validación no
 * tenga errores: un flujo con pasos inalcanzables deja al ejecutivo sin salida
 * en medio de una llamada (ver src/lib/workflow-validation.ts).
 */
export async function setWorkflowStatus(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const workflowId = formData.get("workflow_id") as string;
  const status = formData.get("status") === "published" ? "published" : "draft";

  const supabase = await createClient();

  if (status === "published") {
    const [{ data: steps }, { data: branches }] = await Promise.all([
      supabase.from("workflow_steps").select("*").eq("workflow_id", workflowId),
      supabase.from("workflow_step_branches").select("*").eq("workflow_id", workflowId),
    ]);
    const errors = validateWorkflow(
      (steps ?? []) as WorkflowStep[],
      (branches ?? []) as WorkflowStepBranch[]
    ).filter((issue) => issue.level === "error");

    if (errors.length > 0) {
      throw new Error(
        `No se puede publicar: ${errors.length} ${errors.length === 1 ? "error" : "errores"} en el flujo. ${errors[0].message}`
      );
    }
  }

  const { error } = await supabase
    .from("workflows")
    .update({
      status,
      published_at: status === "published" ? new Date().toISOString() : null,
    })
    .eq("id", workflowId);

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/flujos");
  revalidatePath(`/dashboard/admin/flujos/${workflowId}`);
}

export async function addWorkflowStep(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
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
  await requireProfile(["admin", "supervisor"]);
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
  await requireProfile(["admin", "supervisor"]);
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
  await requireProfile(["admin", "supervisor"]);
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
}

export async function updateWorkflowStepPosition(input: {
  stepId: string;
  posX: number;
  posY: number;
}): Promise<void> {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("workflow_steps")
    .update({ pos_x: input.posX, pos_y: input.posY })
    .eq("id", input.stepId);
  if (error) throw new Error(error.message);
}

export async function setStartStep(input: {
  workflowId: string;
  // null solo lo usa el deshacer del lienzo, para volver a un flujo sin inicio.
  stepId: string | null;
}): Promise<void> {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();
  if (input.stepId === null) {
    const { error } = await supabase
      .from("workflow_steps")
      .update({ is_start: false })
      .eq("workflow_id", input.workflowId);
    if (error) throw new Error(error.message);
    return;
  }
  // Marcar como inicio un paso intermedio corta la cascada que ve el ejecutivo
  // y reclasifica cada cierre; el lienzo no debe permitirlo.
  const { data: incoming, error: incomingError } = await supabase
    .from("workflow_step_branches")
    .select("id")
    .eq("workflow_id", input.workflowId)
    .eq("to_step_id", input.stepId)
    .limit(1);
  if (incomingError) throw new Error(incomingError.message);
  if (incoming && incoming.length > 0) {
    throw new Error("Este paso recibe conexiones de otro paso; no puede ser el inicio del flujo.");
  }
  await supabase
    .from("workflow_steps")
    .update({ is_start: false })
    .eq("workflow_id", input.workflowId);
  const { error } = await supabase
    .from("workflow_steps")
    .update({ is_start: true })
    .eq("id", input.stepId);
  if (error) throw new Error(error.message);
}

// Lo que se pierde al borrar un paso: la fila, sus conexiones (caen en
// cascada) y el vínculo del diccionario legado (queda en null). El lienzo lo
// guarda para que Ctrl+Z pueda devolverlo con el mismo id.
export interface DeletedStepSnapshot {
  step: WorkflowStep;
  branches: WorkflowStepBranch[];
  legacyMapIds: string[];
}

export async function deleteWorkflowStepNode(input: {
  stepId: string;
  workflowId: string;
}): Promise<DeletedStepSnapshot> {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();

  const { data: step, error: stepError } = await supabase
    .from("workflow_steps")
    .select("*")
    .eq("id", input.stepId)
    .eq("workflow_id", input.workflowId)
    .single();
  if (stepError || !step) throw new Error(stepError?.message ?? "El paso ya no existe.");

  const { data: branches, error: branchesError } = await supabase
    .from("workflow_step_branches")
    .select("*")
    .eq("workflow_id", input.workflowId)
    .or(`from_step_id.eq.${input.stepId},to_step_id.eq.${input.stepId}`);
  if (branchesError) throw new Error(branchesError.message);

  // Si no se puede leer el diccionario legado, el borrado sigue: solo se
  // perdería ese vínculo al deshacer.
  const { data: legacy } = await supabase
    .from("legacy_tipificacion_map")
    .select("id")
    .eq("workflow_step_id", input.stepId);

  const { error } = await supabase.from("workflow_steps").delete().eq("id", input.stepId);
  if (error) throw new Error(error.message);

  return {
    step: step as WorkflowStep,
    branches: (branches ?? []) as WorkflowStepBranch[],
    legacyMapIds: (legacy ?? []).map((row) => row.id as string),
  };
}

// Devuelve una conexión tal como estaba. Si en su salida (paso + respuesta)
// hay ahora otra conexión, esa se reemplaza: deshacer significa que vuelve a
// valer la de antes.
async function putBranch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  branch: WorkflowStepBranch
): Promise<WorkflowStepBranch> {
  let clash = supabase
    .from("workflow_step_branches")
    .delete()
    .eq("workflow_id", branch.workflow_id)
    .eq("from_step_id", branch.from_step_id)
    .neq("id", branch.id);
  clash = branch.from_option === null ? clash.is("from_option", null) : clash.eq("from_option", branch.from_option);
  const { error: clashError } = await clash;
  if (clashError) throw new Error(clashError.message);

  const { data, error } = await supabase
    .from("workflow_step_branches")
    .upsert(
      {
        id: branch.id,
        workflow_id: branch.workflow_id,
        from_step_id: branch.from_step_id,
        from_option: branch.from_option,
        to_step_id: branch.to_step_id,
        created_at: branch.created_at,
      },
      { onConflict: "id" }
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as WorkflowStepBranch;
}

export async function restoreWorkflowStepNode(input: {
  workflowId: string;
  snapshot: DeletedStepSnapshot;
}): Promise<{ step: WorkflowStep; branches: WorkflowStepBranch[] }> {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();
  const { step, branches, legacyMapIds } = input.snapshot;
  if (step.workflow_id !== input.workflowId || branches.some((b) => b.workflow_id !== input.workflowId)) {
    throw new Error("El paso no pertenece a este flujo.");
  }

  // Su número de orden pudo tomarlo un paso creado después; en ese caso va al final.
  const { data: taken } = await supabase
    .from("workflow_steps")
    .select("id")
    .eq("workflow_id", input.workflowId)
    .eq("step_order", step.step_order)
    .maybeSingle();
  let stepOrder = step.step_order;
  if (taken) {
    const { data: last } = await supabase
      .from("workflow_steps")
      .select("step_order")
      .eq("workflow_id", input.workflowId)
      .order("step_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    stepOrder = (last?.step_order ?? 0) + 1;
  }

  if (step.is_start) {
    await supabase.from("workflow_steps").update({ is_start: false }).eq("workflow_id", input.workflowId);
  }

  // La fila vuelve completa (incluye columnas que el lienzo no usa, como
  // result_kind), tal como la leyó el borrado.
  const { data: restored, error } = await supabase
    .from("workflow_steps")
    .insert({ ...step, step_order: stepOrder })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  // Una conexión hacia o desde un paso que ya no está no se puede devolver.
  const { data: alive } = await supabase
    .from("workflow_steps")
    .select("id")
    .eq("workflow_id", input.workflowId);
  const aliveIds = new Set((alive ?? []).map((row) => row.id as string));
  const restoredBranches: WorkflowStepBranch[] = [];
  for (const branch of branches) {
    if (!aliveIds.has(branch.from_step_id)) continue;
    if (branch.to_step_id && !aliveIds.has(branch.to_step_id)) continue;
    restoredBranches.push(await putBranch(supabase, branch));
  }

  if (legacyMapIds.length > 0) {
    await supabase
      .from("legacy_tipificacion_map")
      .update({ workflow_step_id: step.id })
      .in("id", legacyMapIds)
      .is("workflow_step_id", null);
  }

  return { step: restored as WorkflowStep, branches: restoredBranches };
}

export async function restoreBranch(input: {
  workflowId: string;
  branch: WorkflowStepBranch;
}): Promise<WorkflowStepBranch> {
  await requireProfile(["admin", "supervisor"]);
  if (input.branch.workflow_id !== input.workflowId) {
    throw new Error("La conexión no pertenece a este flujo.");
  }
  const supabase = await createClient();
  return putBranch(supabase, input.branch);
}

export async function upsertBranch(input: {
  workflowId: string;
  fromStepId: string;
  fromOption: string | null;
  toStepId: string | null;
}): Promise<WorkflowStepBranch> {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();

  // PostgreSQL permite múltiples NULL en una restricción UNIQUE compuesta.
  // Para una salida por defecto resolvemos explícitamente la fila existente y
  // limpiamos duplicados antiguos antes de devolverla.
  if (input.fromOption === null) {
    const { data: defaults, error: findError } = await supabase
      .from("workflow_step_branches")
      .select("*")
      .eq("workflow_id", input.workflowId)
      .eq("from_step_id", input.fromStepId)
      .is("from_option", null)
      .order("created_at", { ascending: true });
    if (findError) throw new Error(findError.message);

    if (defaults && defaults.length > 0) {
      const keeper = defaults[0] as WorkflowStepBranch;
      const { data, error } = await supabase
        .from("workflow_step_branches")
        .update({ to_step_id: input.toStepId })
        .eq("id", keeper.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);

      const duplicateIds = defaults.slice(1).map((branch) => branch.id);
      if (duplicateIds.length > 0) {
        const { error: deleteError } = await supabase
          .from("workflow_step_branches")
          .delete()
          .in("id", duplicateIds);
        if (deleteError) throw new Error(deleteError.message);
      }
      return data as WorkflowStepBranch;
    }

    const { data, error } = await supabase
      .from("workflow_step_branches")
      .insert({
        workflow_id: input.workflowId,
        from_step_id: input.fromStepId,
        from_option: null,
        to_step_id: input.toStepId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as WorkflowStepBranch;
  }

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
  return data as WorkflowStepBranch;
}

export async function deleteBranch(input: {
  branchId: string;
  workflowId: string;
}): Promise<void> {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();
  const { error } = await supabase.from("workflow_step_branches").delete().eq("id", input.branchId);
  if (error) throw new Error(error.message);
}

export async function assignLeadWorkflow(formData: FormData) {
  await requireProfile(["admin"]);
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
