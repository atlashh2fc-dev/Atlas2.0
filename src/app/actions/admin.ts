"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { AppRole } from "@/lib/types";
import { requireProfile } from "@/lib/auth";
import { parseDateTimeInput } from "@/lib/report-range";

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
  const supervisorTeamIds = [...new Set(formData.getAll("supervisor_team_ids").map(String).filter(Boolean))];

  if (!userId) throw new Error("No se identificó el usuario a actualizar.");
  if (!(["agente", "supervisor", "admin"] as const).includes(role)) {
    throw new Error("El rol seleccionado no es válido.");
  }

  // La transacción cambia el rol y el alcance muchos-a-muchos como una sola
  // operación. Así, agregar a Andrea no desplaza a Elizabeth y un error no deja
  // el perfil guardado a medias.
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_role_and_team_scope", {
    p_user_id: userId,
    p_role: role,
    p_team_id: role === "supervisor" ? null : teamId,
    p_supervised_team_ids: role === "supervisor" ? supervisorTeamIds : [],
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/usuarios");
}

/**
 * Permite que un administrador defina una contraseña nueva para otra cuenta.
 * La service role permanece en el servidor; la contraseña se entrega
 * directamente a Supabase Auth y nunca se persiste en `profiles`.
 */
export async function updateUserPassword(formData: FormData) {
  await requireProfile(["admin"]);

  const userId = String(formData.get("user_id") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("password_confirmation") ?? "");

  if (!userId) throw new Error("No se identificó el usuario a actualizar.");
  if (password.length < 8) {
    throw new Error("La contraseña debe tener al menos 8 caracteres.");
  }
  if (password !== confirmation) {
    throw new Error("Las contraseñas no coinciden.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.updateUserById(userId, { password });

  if (error) throw new Error(error.message);
  if (data.user.id !== userId) {
    throw new Error("Supabase no confirmó el cambio de contraseña.");
  }
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

/** Activa o desactiva varias cuentas de una vez desde la tabla de usuarios. */
export async function bulkSetUserActive(
  userIds: string[],
  active: boolean
): Promise<{ ok: number; error: string | null }> {
  await requireProfile(["admin"]);
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return { ok: 0, error: "No hay usuarios seleccionados." };

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ active }).in("id", ids);
  if (error) return { ok: 0, error: error.message };

  revalidatePath("/dashboard/admin/usuarios");
  return { ok: ids.length, error: null };
}

export async function createTeam(formData: FormData) {
  await requireProfile(["admin"]);
  const name = String(formData.get("name") ?? "").trim();
  const supervisorIds = [...new Set(formData.getAll("supervisor_ids").map(String).filter(Boolean))];
  if (!name) throw new Error("El nombre del equipo es obligatorio.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_team_with_supervisors", {
    p_name: name,
    p_supervisor_ids: supervisorIds,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/usuarios");
  revalidatePath("/dashboard/admin/usuarios/equipos");
}

/** Reemplaza el conjunto de supervisores sin desplazar a otro por accidente. */
export async function updateTeamSupervisors(formData: FormData) {
  await requireProfile(["admin"]);
  const teamId = String(formData.get("team_id") ?? "");
  const supervisorIds = [...new Set(formData.getAll("supervisor_ids").map(String).filter(Boolean))];
  if (!teamId) throw new Error("No se identificó el equipo.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("replace_team_supervisors", {
    p_team_id: teamId,
    p_supervisor_ids: supervisorIds,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/usuarios");
  revalidatePath("/dashboard/admin/usuarios/equipos");
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

  revalidatePath("/dashboard/admin/integraciones/historial");
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
  const nextActionAt = nextActionAtRaw ? parseDateTimeInput(nextActionAtRaw) : null;
  if (nextActionAtRaw && !nextActionAt) throw new Error("La fecha de agenda no es válida.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_lead", {
    p_lead_id: leadId,
    p_agent_id: agentId,
    p_reason: "Reasignación de agenda desde Mi equipo",
    p_source: "team.agenda_reassignment_form",
    p_set_managed_by: true,
    p_next_action_at: nextActionAt?.toISOString() ?? null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/leads");
  revalidatePath(`/dashboard/leads/${leadId}`);
}

export type CallbackBulkResult = { ok: number; error: string | null };

/**
 * Reagenda compromisos en lote: "el ejecutivo no vino, muevo sus 30 agendas".
 * Opcionalmente los traspasa a otro ejecutivo. La validación de equipo y la
 * auditoría viven en la función `reschedule_callbacks`.
 */
export async function rescheduleCallbacks(
  leadIds: string[],
  nextActionAt: string,
  agentId?: string | null
): Promise<CallbackBulkResult> {
  await requireProfile(["supervisor", "admin"]);
  const ids = [...new Set(leadIds)];
  if (ids.length === 0) return { ok: 0, error: "No hay compromisos seleccionados." };

  const when = parseDateTimeInput(nextActionAt);
  if (!when) return { ok: 0, error: "La fecha no es válida." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reschedule_callbacks", {
    p_lead_ids: ids,
    p_next_action_at: when.toISOString(),
    p_agent_id: agentId || null,
  });
  if (error) return { ok: 0, error: error.message };

  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/agenda");
  return { ok: typeof data === "number" ? data : ids.length, error: null };
}

/**
 * Deriva compromisos al pool del discador: dejan de ser de una persona y los
 * atiende el primer ejecutivo disponible. Con `keepSchedule` se conserva la hora
 * comprometida; sin él, el registro vuelve a la cola normal de la campaña.
 */
export async function releaseCallbacksToPool(
  leadIds: string[],
  keepSchedule = false
): Promise<CallbackBulkResult> {
  await requireProfile(["supervisor", "admin"]);
  const ids = [...new Set(leadIds)];
  if (ids.length === 0) return { ok: 0, error: "No hay compromisos seleccionados." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("release_callbacks_to_pool", {
    p_lead_ids: ids,
    p_keep_schedule: keepSchedule,
  });
  if (error) return { ok: 0, error: error.message };

  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/agenda");
  return { ok: typeof data === "number" ? data : ids.length, error: null };
}
