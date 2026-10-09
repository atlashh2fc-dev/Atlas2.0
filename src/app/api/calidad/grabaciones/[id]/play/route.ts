import { NextResponse } from "next/server";
import {
  auditRecordingAccess,
  authorizeRecordingAccess,
  recordingJsonError,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/recording-access.server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await authorizeRecordingAccess(id, "escuchar");
  if (!access.ok) return access.response;
  const { profile, supabase, recording } = access;

  try {
    // createSignedUrl usa el JWT de la sesión y, por lo tanto, también exige
    // que la política SELECT de storage.objects autorice este objeto.
    const { data: signed, error: signError } = await supabase.storage
      .from(recording.storage_bucket)
      .createSignedUrl(recording.storage_path, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) return recordingJsonError("No se pudo preparar el audio.", 503);

    // El catálogo y la firma siempre usan la sesión+RLS. La service role se
    // limita a esta escritura append-only, después de completar la autorización.
    // Si no podemos auditar, no entregamos el enlace (fail closed).
    if (!(await auditRecordingAccess(request, profile, recording, "signed_url_created"))) {
      return recordingJsonError("No se pudo registrar el acceso al audio. Intenta nuevamente.", 503);
    }

    return NextResponse.json(
      { url: signed.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return recordingJsonError("No se pudo validar el acceso a la grabación.", 500);
  }
}
