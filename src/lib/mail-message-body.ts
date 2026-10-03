export type MailMessageBodySegment =
  | { kind: "text"; value: string }
  | { kind: "image"; url: string };

const IMAGE_ONLY_MARKER = /\[IMAGE_ONLY:([^\]]+)\]/g;

function isSafeRemoteImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function parseMailMessageBody(body: string): MailMessageBodySegment[] {
  const segments: MailMessageBodySegment[] = [];
  let cursor = 0;

  for (const match of body.matchAll(IMAGE_ONLY_MARKER)) {
    const index = match.index ?? 0;
    const marker = match[0];
    const candidateUrl = match[1].trim();

    if (index > cursor) {
      segments.push({ kind: "text", value: body.slice(cursor, index) });
    }

    segments.push(
      isSafeRemoteImageUrl(candidateUrl)
        ? { kind: "image", url: candidateUrl }
        : { kind: "text", value: marker },
    );
    cursor = index + marker.length;
  }

  if (cursor < body.length) {
    segments.push({ kind: "text", value: body.slice(cursor) });
  }

  return segments.filter((segment) => segment.kind === "image" || segment.value.trim().length > 0);
}

const ATLAS_LEAD_MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Atlas Lead identifica sus envíos con un UUID. Los correos cargados por otra
 * vía (demos, importaciones) traen ids propios como `fec-out-…` que Atlas Lead
 * no conoce: pedirle el original devuelve 400, así que se muestra el texto.
 */
export function hasAtlasLeadOriginal(externalMessageId: string | null | undefined): externalMessageId is string {
  return Boolean(externalMessageId && ATLAS_LEAD_MESSAGE_ID.test(externalMessageId));
}
