"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { parseAndInsertLeads, type BulkUploadResult } from "@/lib/leads-bulk-core";

export type { BulkUploadResult };

/**
 * Fallback sin JS / sin XHR: usado solo si el formulario se envía como
 * Server Action directa. La carga normal desde la UI usa la API route
 * /api/leads/bulk-upload (vía XMLHttpRequest) para tener progreso real y no
 * heredar el límite de tamaño de body de las Server Actions.
 */
export async function uploadLeadsFile(formData: FormData): Promise<BulkUploadResult> {
  const file = formData.get("file") as File | null;
  const teamId = (formData.get("team_id") as string) || null;
  const campaignId = (formData.get("campaign_id") as string) || null;
  const workflowId = (formData.get("workflow_id") as string) || null;

  if (!file || file.size === 0) {
    throw new Error("Selecciona un archivo CSV o Excel.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");

  const result = await parseAndInsertLeads({
    file,
    teamId,
    campaignId,
    workflowId,
    userId: user.id,
    supabase,
  });

  revalidatePath("/dashboard/leads");
  if (campaignId) revalidatePath(`/dashboard/admin/campanas/${campaignId}`);
  return result;
}
