import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupervisedTeamIds } from "@/lib/supervisor-scope";

const SIGNED_URL_TTL_SECONDS = 5 * 60;

type RecordingAccessRow = {
  id: string;
  lead_id: string;
  agent_id: string;
  team_id: string | null;
  storage_bucket: string;
  storage_path: string;
  status: string;
};

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "private, no-store" } }
  );
}

async function supervisorCanPlay(
  supabase: Awaited<ReturnType<typeof createClient>>,
  recording: Pick<RecordingAccessRow, "team_id">
) {
  const teamIds = await getSupervisedTeamIds(supabase);
  return recording.team_id !== null && teamIds.includes(recording.team_id);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await getCurrentProfile();
  if (!profile) return jsonError("Debes iniciar sesión para escuchar esta grabación.", 401);
  if (!profile.active) return jsonError("Tu sesión no está habilitada para escuchar grabaciones.", 403);
  if (profile.role !== "admin" && profile.role !== "supervisor") {
    return jsonError("No tienes permiso para escuchar grabaciones.", 403);
  }

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return jsonError("Grabación inválida.", 400);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("call_recordings")
    .select("id, lead_id, agent_id, team_id, storage_bucket, storage_path, status")
    .eq("id", id)
    .maybeSingle();

  if (error) return jsonError("No se pudo consultar la grabación.", 500);
  if (!data) return jsonError("La grabación no existe o no está dentro de tu alcance.", 404);

  const recording = data as RecordingAccessRow;
  if (recording.status !== "ready") {
    return jsonError("La grabación todavía no está disponible para reproducción.", 409);
  }

  try {
    if (profile.role === "supervisor" && !(await supervisorCanPlay(supabase, recording))) {
      return jsonError("La grabación no pertenece a uno de tus equipos.", 403);
    }

    // createSignedUrl usa el JWT de la sesión y, por lo tanto, también exige
    // que la política SELECT de storage.objects autorice este objeto.
    const { data: signed, error: signError } = await supabase.storage
      .from(recording.storage_bucket)
      .createSignedUrl(recording.storage_path, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) return jsonError("No se pudo preparar el audio.", 503);

    // El catálogo y la firma siempre usan la sesión+RLS. La service role se
    // limita a esta escritura append-only, después de completar la autorización.
    // Si no podemos auditar, no entregamos el enlace (fail closed).
    const admin = createAdminClient();
    const { error: auditError } = await admin.from("call_recording_access_logs").insert({
      recording_id: recording.id,
      actor_id: profile.id,
      actor_role: profile.role,
      action: "signed_url_created",
      request_id: crypto.randomUUID(),
      user_agent: request.headers.get("user-agent"),
      metadata: { expires_in_seconds: SIGNED_URL_TTL_SECONDS },
    });
    if (auditError) return jsonError("No se pudo registrar el acceso al audio. Intenta nuevamente.", 503);

    return NextResponse.json(
      { url: signed.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return jsonError("No se pudo validar el acceso a la grabación.", 500);
  }
}
