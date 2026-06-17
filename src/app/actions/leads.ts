"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function registerInteraction(formData: FormData) {
  const leadId = formData.get("lead_id") as string;
  const result = formData.get("result") as string;
  const notes = (formData.get("notes") as string) || null;
  const newStatus = formData.get("new_status") as string | null;
  const workflowStepId = (formData.get("workflow_step_id") as string) || null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");

  const { error: insertError } = await supabase.from("interactions").insert({
    lead_id: leadId,
    agent_id: user.id,
    result,
    notes,
    workflow_step_id: workflowStepId,
  });

  if (insertError) throw new Error(insertError.message);

  if (newStatus) {
    const { error: updateError } = await supabase
      .from("leads")
      .update({ status: newStatus })
      .eq("id", leadId);
    if (updateError) throw new Error(updateError.message);
  }

  revalidatePath(`/dashboard/leads/${leadId}`);
  revalidatePath("/dashboard/leads");
}
