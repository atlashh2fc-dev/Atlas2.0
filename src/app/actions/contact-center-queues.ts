"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function revalidateQueue(queueId: string) {
  revalidatePath("/dashboard/admin/colas");
  revalidatePath(`/dashboard/admin/colas/${queueId}`);
  revalidatePath("/dashboard/conversaciones");
}

export async function saveContactCenterQueue(formData: FormData) {
  const profile = await requireProfile(["admin"]);
  const queueId = String(formData.get("queue_id") ?? "").trim();
  const routingMode = String(formData.get("routing_mode") ?? "").trim();
  const maxConcurrentRaw = String(formData.get("max_concurrent_per_agent") ?? "").trim();
  const serviceLevelMinutes = Number(String(formData.get("service_level_minutes") ?? "").trim());

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

  const admin = createAdminClient();
  const { error } = await admin
    .from("contact_center_queues")
    .update({
      routing_mode: routingMode,
      max_concurrent_per_agent: maxConcurrent,
      service_level_seconds: serviceLevelMinutes * 60,
      updated_by: profile.id,
    })
    .eq("id", queueId);
  if (error) throw new Error(error.message);
  revalidateQueue(queueId);
}

export async function saveContactCenterQueueMembers(formData: FormData) {
  await requireProfile(["admin"]);
  const queueId = String(formData.get("queue_id") ?? "").trim();
  const selectedIds = [...new Set(
    formData.getAll("profile_ids").map(String).filter((value) => UUID.test(value)),
  )];
  if (!UUID.test(queueId)) throw new Error("Cola inválida.");

  const admin = createAdminClient();
  const [{ data: queue }, { data: agents }] = await Promise.all([
    admin.from("contact_center_queues").select("id").eq("id", queueId).maybeSingle(),
    selectedIds.length > 0
      ? admin.from("profiles").select("id").in("id", selectedIds).eq("role", "agente").eq("active", true)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);
  if (!queue) throw new Error("La cola no existe.");
  if ((agents ?? []).length !== selectedIds.length) throw new Error("Uno de los agentes no está activo.");

  const { error: disableError } = await admin
    .from("contact_center_queue_members")
    .update({ is_active: false })
    .eq("queue_id", queueId);
  if (disableError) throw new Error(disableError.message);

  if (selectedIds.length > 0) {
    const { error: upsertError } = await admin.from("contact_center_queue_members").upsert(
      selectedIds.map((profileId) => ({ queue_id: queueId, profile_id: profileId, is_active: true })),
      { onConflict: "queue_id,profile_id" },
    );
    if (upsertError) throw new Error(upsertError.message);
  }

  revalidateQueue(queueId);
}
