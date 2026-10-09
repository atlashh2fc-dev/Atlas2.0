import "server-only";

import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupervisedTeamIds } from "@/lib/supervisor-scope";
import { getWorkspacePermissions } from "@/lib/workspace-permissions";

/** El enlace firmado vence rápido: sirve para esta escucha o esta descarga, no para compartir. */
export const SIGNED_URL_TTL_SECONDS = 5 * 60;

export type RecordingAccessRow = {
  id: string;
  lead_id: string;
  agent_id: string;
  team_id: string | null;
  storage_bucket: string;
  storage_path: string;
  status: string;
  started_at: string | null;
};

type Profile = NonNullable<Awaited<ReturnType<typeof getCurrentProfile>>>;
type Supabase = Awaited<ReturnType<typeof createClient>>;

export function recordingJsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "private, no-store" } }
  );
}

/**
 * Misma regla para escuchar y descargar: sesión activa con permiso de Calidad,
 * la grabación visible por RLS, lista, y si es supervisor, de uno de sus equipos.
 * Devuelve la fila o la respuesta de error lista para enviar.
 */
export async function authorizeRecordingAccess(
  id: string,
  verb: "escuchar" | "descargar"
): Promise<
  | { ok: true; profile: Profile; supabase: Supabase; recording: RecordingAccessRow }
  | { ok: false; response: NextResponse }
> {
  const fail = (message: string, status: number) => ({ ok: false as const, response: recordingJsonError(message, status) });

  const profile = await getCurrentProfile();
  if (!profile) return fail(`Debes iniciar sesión para ${verb} esta grabación.`, 401);
  if (!profile.active) return fail(`Tu sesión no está habilitada para ${verb} grabaciones.`, 403);
  if (!getWorkspacePermissions(profile.role).canReviewQuality) {
    return fail(`No tienes permiso para ${verb} grabaciones.`, 403);
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return fail("Grabación inválida.", 400);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("call_recordings")
    .select("id, lead_id, agent_id, team_id, storage_bucket, storage_path, status, started_at")
    .eq("id", id)
    .maybeSingle();

  if (error) return fail("No se pudo consultar la grabación.", 500);
  if (!data) return fail("La grabación no existe o no está dentro de tu alcance.", 404);

  const recording = data as RecordingAccessRow;
  if (recording.status !== "ready") {
    return fail("La grabación todavía no está disponible.", 409);
  }

  if (profile.role === "supervisor") {
    const teamIds = await getSupervisedTeamIds(supabase);
    if (recording.team_id === null || !teamIds.includes(recording.team_id)) {
      return fail("La grabación no pertenece a uno de tus equipos.", 403);
    }
  }

  return { ok: true, profile, supabase, recording };
}

/**
 * Registra el acceso con la service role (append-only). Si no se puede
 * auditar, quien llama no entrega el audio (fail closed).
 */
export async function auditRecordingAccess(
  request: Request,
  profile: Profile,
  recording: RecordingAccessRow,
  action: "signed_url_created" | "downloaded",
  metadata: Record<string, unknown> = {}
) {
  const admin = createAdminClient();
  const { error } = await admin.from("call_recording_access_logs").insert({
    recording_id: recording.id,
    actor_id: profile.id,
    actor_role: profile.role,
    action,
    request_id: crypto.randomUUID(),
    user_agent: request.headers.get("user-agent"),
    metadata: { expires_in_seconds: SIGNED_URL_TTL_SECONDS, ...metadata },
  });
  return !error;
}
