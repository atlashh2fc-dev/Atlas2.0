"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { AppRole } from "@/lib/types";

export async function createUserAccount(formData: FormData) {
  const fullName = (formData.get("full_name") as string)?.trim();
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const password = formData.get("password") as string;
  const role = formData.get("role") as AppRole;
  const teamId = (formData.get("team_id") as string) || null;

  if (!fullName || !email || !password) {
    throw new Error("Nombre, correo y contraseña son obligatorios.");
  }
  if (password.length < 6) {
    throw new Error("La contraseña debe tener al menos 6 caracteres.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
  });

  if (error) throw new Error(error.message);

  // El trigger on_auth_user_created crea el perfil con full_name/role desde
  // user_metadata. Si se especificó equipo, lo asignamos aquí.
  if (teamId && data.user) {
    const { error: teamError } = await admin
      .from("profiles")
      .update({ team_id: teamId })
      .eq("id", data.user.id);
    if (teamError) throw new Error(teamError.message);
  }

  revalidatePath("/dashboard/admin/usuarios");
}

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
  const supervisorId = (formData.get("supervisor_id") as string) || null;
  const supabase = await createClient();
  const { error } = await supabase.from("teams").insert({ name, supervisor_id: supervisorId });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/usuarios");
}

/** Asigna o cambia el supervisor a cargo de un equipo (define de quién dependen sus agentes). */
export async function updateTeamSupervisor(formData: FormData) {
  const teamId = formData.get("team_id") as string;
  const supervisorId = (formData.get("supervisor_id") as string) || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("teams")
    .update({ supervisor_id: supervisorId })
    .eq("id", teamId);

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/usuarios");
}

/**
 * Activa un ejecutivo histórico (de una migración de CRM legado): crea una cuenta real
 * con login y, a partir de ahí, su historial de calls/interactions pasa a contar como
 * gestión real del nuevo agente (sin perder la trazabilidad al registro histórico original).
 */
export async function activateHistoricalAgent(formData: FormData) {
  const historicalAgentId = formData.get("historical_agent_id") as string;
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const password = formData.get("password") as string;
  const role = (formData.get("role") as AppRole) || "agente";
  const teamId = (formData.get("team_id") as string) || null;

  if (!historicalAgentId || !email || !password) {
    throw new Error("Ejecutivo, correo y contraseña son obligatorios.");
  }
  if (password.length < 6) {
    throw new Error("La contraseña debe tener al menos 6 caracteres.");
  }

  const supabase = await createClient();
  const { data: historicalAgent, error: haError } = await supabase
    .from("historical_agents")
    .select("id, full_name, linked_profile_id")
    .eq("id", historicalAgentId)
    .single();

  if (haError || !historicalAgent) throw new Error("Ejecutivo histórico no encontrado.");
  if (historicalAgent.linked_profile_id) {
    throw new Error("Este ejecutivo histórico ya fue activado.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: historicalAgent.full_name, role },
  });

  if (error) throw new Error(error.message);
  const newProfileId = data.user!.id;

  if (teamId) {
    const { error: teamError } = await admin
      .from("profiles")
      .update({ team_id: teamId })
      .eq("id", newProfileId);
    if (teamError) throw new Error(teamError.message);
  }

  const { error: linkError } = await admin
    .from("historical_agents")
    .update({ linked_profile_id: newProfileId })
    .eq("id", historicalAgentId);
  if (linkError) throw new Error(linkError.message);

  // Reasigna su historial real (calls/interactions) al perfil recién creado, conservando
  // historical_agent_id como trazabilidad permanente del origen legado.
  const { error: callsError } = await admin
    .from("calls")
    .update({ agent_id: newProfileId })
    .eq("historical_agent_id", historicalAgentId);
  if (callsError) throw new Error(callsError.message);

  const { error: interactionsError } = await admin
    .from("interactions")
    .update({ agent_id: newProfileId })
    .eq("historical_agent_id", historicalAgentId);
  if (interactionsError) throw new Error(interactionsError.message);

  revalidatePath("/dashboard/admin/ejecutivos-historicos");
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

/**
 * Reagenda una llamada de un ejecutivo a otro: transfiere la responsabilidad
 * del lead (assigned_to + managed_by, así desaparece de "Mis agendas" del
 * ejecutivo original y aparece en las del nuevo) y, si la supervisora indicó
 * una nueva fecha/hora, también actualiza next_action_at.
 */
export async function reassignAgenda(formData: FormData) {
  const leadId = formData.get("lead_id") as string;
  const agentId = formData.get("agent_id") as string;
  const nextActionAtRaw = formData.get("next_action_at") as string;

  if (!leadId || !agentId) {
    throw new Error("Debes seleccionar el ejecutivo al que reasignar la agenda.");
  }

  const update: Record<string, unknown> = {
    managed_by: agentId,
    assigned_to: agentId,
  };
  if (nextActionAtRaw) {
    update.next_action_at = new Date(nextActionAtRaw).toISOString();
  }

  const supabase = await createClient();
  const { error } = await supabase.from("leads").update(update).eq("id", leadId);

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/team");
}
