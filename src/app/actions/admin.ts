"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { AppRole } from "@/lib/types";

export async function updateUserRole(formData: FormData) {
  const userId = formData.get("user_id") as string;
  const role = formData.get("role") as AppRole;
  const teamId = (formData.get("team_id") as string) || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ role, team_id: teamId })
    .eq("id", userId);

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/usuarios");
}

export async function toggleUserActive(formData: FormData) {
  const userId = formData.get("user_id") as string;
  const active = formData.get("active") === "true";

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ active: !active })
    .eq("id", userId);

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/usuarios");
}

export async function createTeam(formData: FormData) {
  const name = formData.get("name") as string;
  const supabase = await createClient();
  const { error } = await supabase.from("teams").insert({ name });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/usuarios");
}

export async function assignLead(formData: FormData) {
  const leadId = formData.get("lead_id") as string;
  const agentId = formData.get("agent_id") as string;

  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ assigned_to: agentId || null })
    .eq("id", leadId);

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/team");
}
