"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { AppRole } from "@/lib/types";
import { requireProfile } from "@/lib/auth";

export async function createUserAccount(formData: FormData) {
  await requireProfile(["admin"]);
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
  const { data: existingProfile, error: existingProfileError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingProfileError) throw new Error(existingProfileError.message);
  if (existingProfile) {
    throw new Error("Ya existe una cuenta con este correo.");
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { role },
  });

  // GoTrue puede devolver un 500 después de haber confirmado la inserción. En
  // ese caso el trigger ya dejó el perfil creado, por lo que recuperamos su ID
  // y completamos la configuración en vez de mostrar una página de error.
  let userId = data.user?.id;
  if (error) {
    if (error.status !== 500) throw new Error(error.message);

    const { data: recoveredProfile, error: recoveryError } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (recoveryError || !recoveredProfile) {
      throw new Error(recoveryError?.message ?? error.message);
    }

    userId = recoveredProfile.id;
  }

  if (!userId) throw new Error("No fue posible recuperar la cuenta creada.");

  // El trigger crea el perfil, pero lo normalizamos explícitamente para que el
  // rol y el equipo seleccionados queden consistentes incluso tras recuperarnos
  // de una respuesta fallida de Auth.
  const { error: profileError } = await admin
    .from("profiles")
    .update({ full_name: fullName, email, role, team_id: teamId })
    .eq("id", userId);
  if (profileError) throw new Error(profileError.message);

  revalidatePath("/dashboard/admin/usuarios");
}

export async function updateUserRole(formData: FormData) {
  await requireProfile(["admin"]);
  const userId = formData.get("user_id") as string;
  const role = formData.get("role") as AppRole;
  const teamId = (formData.get("team_id") as string) || null;

  if (!userId) throw new Error("No se identificó el usuario a actualizar.");
  if (!(["agente", "supervisor", "admin"] as const).includes(role)) {
    throw new Error("El rol seleccionado no es válido.");
  }

  // La modificación de roles es una operación administrativa. Usar el cliente
  // de servicio evita que una política RLS desactualizada se convierta en un
  // update de cero filas sin error. select().single() obliga además a verificar
  // que el valor efectivamente quedó persistido.
  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .update({ role, team_id: teamId })
    .eq("id", userId)
    .select("id, role")
    .single();

  if (profileError) throw new Error(profileError.message);
  if (profile.role !== role) throw new Error("El rol no pudo guardarse.");

  // El perfil es la fuente de permisos de la app, pero Auth también conserva
  // el rol de alta. Mantenerlos alineados evita cuentas con roles contradictorios.
  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { role },
  });

  if (authError) throw new Error(authError.message);
  revalidatePath("/dashboard/admin/usuarios");
}

export async function toggleUserActive(formData: FormData) {
  await requireProfile(["admin"]);
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
  await requireProfile(["admin"]);
  const name = formData.get("name") as string;
  const supervisorId = (formData.get("supervisor_id") as string) || null;
  const supabase = await createClient();
  const { error } = await supabase.from("teams").insert({ name, supervisor_id: supervisorId });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/usuarios");
}

/** Asigna o cambia el supervisor a cargo de un equipo (define de quién dependen sus agentes). */
export async function updateTeamSupervisor(formData: FormData) {
  await requireProfile(["admin"]);
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
  await requireProfile(["admin"]);
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
    user_metadata: { full_name: historicalAgent.full_name },
    app_metadata: { role },
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
  await requireProfile(["supervisor", "admin"]);
  const leadId = formData.get("lead_id") as string;
  const agentId = ((formData.get("agent_id") as string) || "").trim() || null;

  if (!leadId) throw new Error("Registro no válido.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_lead", {
    p_lead_id: leadId,
    p_agent_id: agentId,
    p_reason: agentId ? "Asignación manual desde Mi equipo" : "Desasignación manual desde Mi equipo",
    p_source: "team.assignment_form",
    p_set_managed_by: false,
    p_next_action_at: null,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/leads");
  revalidatePath(`/dashboard/leads/${leadId}`);
}

/**
 * Reagenda una llamada de un ejecutivo a otro: transfiere la responsabilidad
 * del lead (assigned_to + managed_by, así desaparece de "Mis agendas" del
 * ejecutivo original y aparece en las del nuevo) y, si la supervisora indicó
 * una nueva fecha/hora, también actualiza next_action_at.
 */
export async function reassignAgenda(formData: FormData) {
  await requireProfile(["supervisor", "admin"]);
  const leadId = formData.get("lead_id") as string;
  const agentId = formData.get("agent_id") as string;
  const nextActionAtRaw = formData.get("next_action_at") as string;

  if (!leadId || !agentId) {
    throw new Error("Debes seleccionar el ejecutivo al que reasignar la agenda.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_lead", {
    p_lead_id: leadId,
    p_agent_id: agentId,
    p_reason: "Reasignación de agenda desde Mi equipo",
    p_source: "team.agenda_reassignment_form",
    p_set_managed_by: true,
    p_next_action_at: nextActionAtRaw ? new Date(nextActionAtRaw).toISOString() : null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/leads");
  revalidatePath(`/dashboard/leads/${leadId}`);
}
