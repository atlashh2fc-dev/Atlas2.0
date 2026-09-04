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
