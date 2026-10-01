"use server";

import { errorDeAccion } from "@/lib/errores-de-accion";
import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function revalidateQueue(queueId: string) {
  revalidatePath("/dashboard/admin/colas");
  revalidatePath(`/dashboard/admin/colas/${queueId}`);
  revalidatePath("/dashboard/conversaciones/whatsapp");
  revalidatePath("/dashboard/operacion");
  revalidatePath(`/dashboard/operacion/colas/${queueId}`);
}

/**
 * Las escrituras van con la clave de servicio (las colas mezclan tablas que la
 * sesión no puede tocar), así que antes se comprueba con el cliente de SESIÓN
 * que la cola sea visible para quien actúa: la RLS solo muestra las de sus
 * empresas. Sin esto, un id de otra empresa se podía editar desde acá.
 */
async function exigirColaVisible(supabase: Awaited<ReturnType<typeof createClient>>, queueId: string) {
  const { data: queue, error } = await supabase.from("contact_center_queues").select("id").eq("id", queueId).maybeSingle();
  if (error) throw errorDeAccion(error);
  if (!queue) throw new Error("La cola no existe o no es de tu empresa. Actualiza la página y vuelve a elegirla.");
}

export async function saveContactCenterQueue(formData: FormData) {
  const profile = await requireProfile(["admin"]);
  const queueId = String(formData.get("queue_id") ?? "").trim();
  const routingMode = String(formData.get("routing_mode") ?? "").trim();
  const maxConcurrentRaw = String(formData.get("max_concurrent_per_agent") ?? "").trim();
  const serviceLevelMinutes = Number(String(formData.get("service_level_minutes") ?? "").trim());
  const maxCorreos = Number(String(formData.get("max_correos_por_agente") ?? "10").trim());
  const slaCorreoHoras = Number(String(formData.get("sla_correo_horas") ?? "4").trim().replace(",", "."));

  if (!UUID.test(queueId)) throw new Error("Cola inválida.");
  if (!(routingMode === "least_loaded" || routingMode === "manual")) {
    throw new Error("Selecciona una estrategia de enrutamiento válida.");
  }
  const maxConcurrent = maxConcurrentRaw === "" ? null : Number(maxConcurrentRaw);
  if (maxConcurrent !== null && (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 500)) {
    throw new Error("La concurrencia debe estar entre 1 y 500, o quedar vacía.");
  }
  if (!Number.isInteger(serviceLevelMinutes) || serviceLevelMinutes < 1 || serviceLevelMinutes > 1440) {
    throw new Error("El nivel de servicio debe estar entre 1 y 1.440 minutos.");
  }
  if (!Number.isInteger(maxCorreos) || maxCorreos < 1 || maxCorreos > 500) {
    throw new Error("El tope de correos por ejecutivo debe estar entre 1 y 500.");
  }
  if (!Number.isFinite(slaCorreoHoras) || slaCorreoHoras < 0.25 || slaCorreoHoras > 168) {
    throw new Error("La primera respuesta al correo debe estar entre 15 minutos (0,25 h) y 168 horas.");
  }

  await exigirColaVisible(await createClient(), queueId);
  const admin = createAdminClient();
  const { error } = await admin
    .from("contact_center_queues")
    .update({
      routing_mode: routingMode,
      max_concurrent_per_agent: maxConcurrent,
      service_level_seconds: serviceLevelMinutes * 60,
      max_correos_por_agente: maxCorreos,
      sla_correo_segundos: Math.round(slaCorreoHoras * 3600),
      updated_by: profile.id,
    })
    .eq("id", queueId);
  if (error) throw errorDeAccion(error);
  revalidateQueue(queueId);
}

/**
 * Quién atiende la cola. Administración define el roster completo; supervisión
 * mueve a los ejecutivos de sus equipos (los que su RLS le deja ver) sin tocar
 * a los de otros equipos, como en cualquier contact center: el supervisor pasa
 * gente de una cola a otra según la carga del día.
 */
export async function saveContactCenterQueueMembers(formData: FormData) {
  const profile = await requireProfile(["admin", "supervisor"]);
  const queueId = String(formData.get("queue_id") ?? "").trim();
  const selectedIds = [...new Set(
    formData.getAll("profile_ids").map(String).filter((value) => UUID.test(value)),
  )];
  if (!UUID.test(queueId)) throw new Error("Cola inválida.");

  const supabase = await createClient();
  // La cola tiene que estar al alcance de quien edita (su RLS decide cuáles ve).
  await exigirColaVisible(supabase, queueId);
  const admin = createAdminClient();

  // Supervisión solo mueve a quienes ve: los ejecutivos de sus equipos.
  let editables: Set<string> | null = null;
  if (profile.role === "supervisor") {
    const { data: visibles } = await supabase.from("profiles").select("id").eq("role", "agente").eq("active", true);
    editables = new Set((visibles ?? []).map((fila) => fila.id));
    if (selectedIds.some((id) => !editables!.has(id))) throw new Error("Solo puedes mover a ejecutivos de tus equipos.");
  }

  // Leídos con la sesión: un ejecutivo de otra empresa no aparece y no entra a la cola.
  const { data: agents } = selectedIds.length > 0
    ? await supabase.from("profiles").select("id").in("id", selectedIds).eq("role", "agente").eq("active", true)
    : { data: [] as { id: string }[] };
  if ((agents ?? []).length !== selectedIds.length) {
    throw new Error("Uno de los ejecutivos no está activo o no es de tu empresa. Actualiza la página y vuelve a elegir.");
  }

  let disable = admin.from("contact_center_queue_members").update({ is_active: false }).eq("queue_id", queueId);
  if (editables) disable = disable.in("profile_id", [...editables]);
  const { error: disableError } = await disable;
  if (disableError) throw errorDeAccion(disableError);

  if (selectedIds.length > 0) {
    const { error: upsertError } = await admin.from("contact_center_queue_members").upsert(
      selectedIds.map((profileId) => ({ queue_id: queueId, profile_id: profileId, is_active: true })),
      { onConflict: "queue_id,profile_id" },
    );
    if (upsertError) throw errorDeAccion(upsertError);
  }

  // Quien entra a una cola con correo recibe lo que esperaba sin esperar al próximo ciclo.
  await admin.rpc("repartir_correos_pendientes");
  revalidateQueue(queueId);
}

/**
 * Conecta el buzón de una campaña a la cola: desde ese momento los correos de
 * sus clientes se reparten entre los miembros. Una campaña tiene una sola cola
 * de correo; si ya la atendía otra, se avisa en vez de moverla en silencio.
 */
export async function conectarCorreoDeCampana(formData: FormData) {
  await requireProfile(["admin"]);
  const queueId = String(formData.get("queue_id") ?? "").trim();
  const campaignId = String(formData.get("campaign_id") ?? "").trim();
  if (!UUID.test(queueId) || !UUID.test(campaignId)) throw new Error("Elige una campaña.");

  const supabase = await createClient();
  await exigirColaVisible(supabase, queueId);
  // Leída con la sesión: una campaña de otra empresa no aparece.
  const { data: campaign, error: campaignError } = await supabase.from("campaigns").select("id").eq("id", campaignId).maybeSingle();
  if (campaignError) throw errorDeAccion(campaignError);
  if (!campaign) throw new Error("Esa campaña no es de tu empresa. Actualiza la página y elige otra.");

  const admin = createAdminClient();
  const { data: existente } = await admin
    .from("contact_center_queue_sources")
    .select("id, queue_id, is_active, contact_center_queues(name)")
    .eq("channel_type", "email")
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (existente && existente.queue_id !== queueId) {
    const otra = existente.contact_center_queues as { name: string } | { name: string }[] | null;
    const nombre = Array.isArray(otra) ? otra[0]?.name : otra?.name;
    throw new Error(`El correo de esa campaña ya lo atiende la cola ${nombre ?? "otra"}. Desconéctalo allá primero.`);
  }
  const { error } = existente
    ? await admin.from("contact_center_queue_sources").update({ is_active: true }).eq("id", existente.id)
    : await admin.from("contact_center_queue_sources").insert({ queue_id: queueId, channel_type: "email", campaign_id: campaignId, is_active: true });
  if (error) throw errorDeAccion(error);

  await admin.rpc("repartir_correos_pendientes");
  revalidateQueue(queueId);
}

export async function desconectarFuenteDeCola(formData: FormData) {
  await requireProfile(["admin"]);
  const queueId = String(formData.get("queue_id") ?? "").trim();
  const sourceId = String(formData.get("source_id") ?? "").trim();
  if (!UUID.test(queueId) || !UUID.test(sourceId)) throw new Error("Fuente inválida.");
  await exigirColaVisible(await createClient(), queueId);
  const admin = createAdminClient();
  // Solo correo: WhatsApp y voz tienen su propia configuración (línea y discador).
  const { error } = await admin
    .from("contact_center_queue_sources")
    .update({ is_active: false })
    .eq("id", sourceId)
    .eq("queue_id", queueId)
    .eq("channel_type", "email");
  if (error) throw errorDeAccion(error);
  revalidateQueue(queueId);
}
