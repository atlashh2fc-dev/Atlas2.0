"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type ManualRecordInput = {
  fullName: string;
  rut?: string;
  phone?: string;
  email?: string;
  teamId?: string;
  campaignId?: string;
  assignedTo?: string;
  notes?: string;
};

type ManualRecordResult = {
  ok: boolean;
  message?: string;
  leadId?: string;
};

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

export async function createManualLeadRecord(input: ManualRecordInput): Promise<ManualRecordResult> {
  try {
    const profile = await requireProfile(["supervisor", "admin"]);
    const fullName = blankToNull(input.fullName);
    const rut = blankToNull(input.rut);
    const phone = blankToNull(input.phone);

    if (!fullName) return { ok: false, message: "Indica el nombre o razón social." };
    if (!rut && !phone) return { ok: false, message: "Indica al menos RUT o teléfono." };

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_manual_lead_record", {
      p_full_name: fullName,
      p_rut: rut,
      p_phone: phone,
      p_email: blankToNull(input.email),
      p_team_id: profile.role === "admin" ? blankToNull(input.teamId) : null,
      p_campaign_id: blankToNull(input.campaignId),
      p_assigned_to: blankToNull(input.assignedTo),
      p_notes: blankToNull(input.notes),
    });

    if (error) return { ok: false, message: error.message };

    const leadId =
      data && typeof data === "object" && "lead_id" in data && typeof data.lead_id === "string"
        ? data.lead_id
        : undefined;

    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard/team");
    if (leadId) revalidatePath(`/dashboard/leads/${leadId}`);

    return { ok: true, leadId };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "No se pudo crear el registro.",
    };
  }
}
