/**
 * Actividad del registro como conversación.
 *
 * La línea de tiempo mezclaba en una sola columna lo que dijo el cliente, lo
 * que hizo el ejecutivo y los eventos de sistema, con títulos crudos
 * («callback»), fechas en UTC y la misma gestión dos veces (la llamada y su
 * gemela migrada). Acá se decide de qué lado va cada cosa y se limpia el texto;
 * el componente solo dibuja.
 */

export type ActivitySide = "cliente" | "equipo" | "sistema";

export type ActivitySource = "call" | "email" | "interaction" | "integration" | "whatsapp";

export type ActivityEntry = {
  key: string;
  source: ActivitySource;
  /** Quién habla: el cliente a la izquierda, el equipo a la derecha, el sistema al centro. */
  side: ActivitySide;
  date: string | null;
  title: string;
  notes: string | null;
  agenda: string | null;
  agent: string;
};

/** Códigos internos que llegaban de título cuando la gestión no tenía motivo. */
const RAW_TITLES: Record<string, string> = {
  callback: "Volver a llamar",
  interested: "Interesado",
  not_interested: "No interesado",
  sale: "Venta",
  other: "Otro resultado",
  connected: "Contactado",
  no_answer: "No contesta",
  busy: "Ocupado",
  voicemail: "Buzón de voz",
  out_of_service: "Fuera de servicio",
};

/** Eventos de correo de Atlas Lead, dichos como los diría una persona. */
const MAIL_EVENTS: Record<string, string> = {
  clicked: "hizo clic en el correo",
  opened: "abrió el correo",
  delivered: "recibió el correo",
  sent: "se le envió el correo",
  bounced: "el correo rebotó",
  replied: "respondió el correo",
  unsubscribed: "se dio de baja",
  complained: "marcó el correo como spam",
};

const ISO_DATETIME = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})\b/g;

const chileDateTime = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatChile(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return chileDateTime.format(date).replace(/\./g, "").replace(",", " ·");
}

export function humanizeTitle(title: string | null | undefined): string {
  const value = (title ?? "").trim();
  if (!value) return "Gestión";
  return RAW_TITLES[value.toLowerCase()] ?? value;
}

/** Notas sin fechas UTC ni eventos en inglés. */
export function humanizeNote(note: string | null | undefined): string | null {
  if (!note?.trim()) return null;
  return note
    .replace(/Último evento Atlas:\s*([a-z_]+)/gi, (_, event: string) => {
      const said = MAIL_EVENTS[event.toLowerCase()];
      return said ? `Último evento en Atlas Lead: ${said}` : `Último evento en Atlas Lead: ${event}`;
    })
    .replace(ISO_DATETIME, (iso) => formatChile(iso))
    .trim();
}

function isRawCode(title: string): boolean {
  return /^[a-z_]+$/.test(title.trim());
}

/**
 * Una gestión migrada llega dos veces: como llamada y como gestión, del mismo
 * ejecutivo, al mismo minuto y con la misma nota. Se deja una sola, con el
 * título legible y la agenda que tenga cualquiera de las dos.
 */
export function mergeTwinEntries(entries: ActivityEntry[]): ActivityEntry[] {
  const used = new Set<string>();
  const result: ActivityEntry[] = [];
  for (const entry of entries) {
    if (used.has(entry.key)) continue;
    if (entry.source === "call" || entry.source === "interaction") {
      const time = entry.date ? new Date(entry.date).getTime() : NaN;
      const twin = entries.find(
        (other) =>
          other.key !== entry.key &&
          !used.has(other.key) &&
          other.source !== entry.source &&
          (other.source === "call" || other.source === "interaction") &&
          other.agent === entry.agent &&
          (other.notes ?? "") === (entry.notes ?? "") &&
          Math.abs((other.date ? new Date(other.date).getTime() : NaN) - time) <= 120_000
      );
      if (twin) {
        used.add(twin.key);
        const call = entry.source === "call" ? entry : twin;
        const readable = [entry.title, twin.title].find((title) => !isRawCode(title)) ?? entry.title;
        result.push({ ...call, title: readable, agenda: entry.agenda ?? twin.agenda });
        used.add(entry.key);
        continue;
      }
    }
    used.add(entry.key);
    result.push(entry);
  }
  return result;
}

/** Listo para dibujar: sin gemelas, con texto legible y en orden de conversación (lo más nuevo abajo). */
export function prepareActivity(entries: ActivityEntry[]): ActivityEntry[] {
  return mergeTwinEntries(
    entries.map((entry) => ({
      ...entry,
      title: humanizeTitle(entry.title),
      notes: humanizeNote(entry.notes),
    }))
  ).sort((a, b) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime());
}
