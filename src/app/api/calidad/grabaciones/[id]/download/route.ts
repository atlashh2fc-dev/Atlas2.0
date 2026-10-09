import { NextResponse } from "next/server";
import {
  auditRecordingAccess,
  authorizeRecordingAccess,
  recordingJsonError,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/recording-access.server";

/** grabacion-2026-10-09-1532-1a2b3c4d.wav, con la hora de Chile. */
function downloadName(storagePath: string, startedAt: string | null, id: string) {
  const extension = storagePath.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? "wav";
  let stamp = "";
  if (startedAt) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Santiago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(startedAt))
        .map((part) => [part.type, part.value])
    );
    stamp = `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}-`;
  }
  return `grabacion-${stamp}${id.slice(0, 8)}.${extension}`;
}

/**
 * Descarga puntual de una grabación: mismas reglas que escucharla, queda
 * auditada como «downloaded» y redirige a un enlace firmado que el navegador
 * guarda como archivo (Content-Disposition: attachment).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await authorizeRecordingAccess(id, "descargar");
  if (!access.ok) return access.response;
  const { profile, supabase, recording } = access;

  try {
    const filename = downloadName(recording.storage_path, recording.started_at, recording.id);
    const { data: signed, error: signError } = await supabase.storage
      .from(recording.storage_bucket)
      .createSignedUrl(recording.storage_path, SIGNED_URL_TTL_SECONDS, { download: filename });
    if (signError || !signed?.signedUrl) return recordingJsonError("No se pudo preparar la descarga.", 503);

    if (!(await auditRecordingAccess(request, profile, recording, "downloaded", { filename }))) {
      return recordingJsonError("No se pudo registrar la descarga. Intenta nuevamente.", 503);
    }

    const response = NextResponse.redirect(signed.signedUrl, 302);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return recordingJsonError("No se pudo validar el acceso a la grabación.", 500);
  }
}
