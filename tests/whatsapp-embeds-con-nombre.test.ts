import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// `whatsapp_conversation_memory_sources` une mensajes y conversaciones por
// segunda vez. Desde entonces un embed sin nombre entre esas dos tablas
// responde PGRST201, y como las pantallas leen `data` sin mirar `error`, la
// ficha del registro y Prospección se quedaron sin WhatsApp para todos sin
// avisar (encontrado el 15-10-2026). El embed tiene que nombrar la relación.

const ROOT = fileURLToPath(new URL("../src/", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test("los embeds entre mensajes y conversaciones de WhatsApp nombran la relación", () => {
  const offenders: string[] = [];
  for (const file of files(ROOT)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\b(whatsapp_conversations|whatsapp_messages)(!inner)?\(/g)) {
      const line = source.slice(0, match.index).split("\n").length;
      offenders.push(`${file.replace(ROOT, "src/")}:${line} → ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, [], "usar whatsapp_..._conversation_id_fkey en el embed");
});

test("la ficha deja rastro si no puede leer los WhatsApp", () => {
  const ficha = readFileSync(new URL("../src/app/dashboard/leads/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(ficha, /whatsapp_conversations!whatsapp_messages_conversation_id_fkey!inner\(lead_id\)/);
  assert.match(ficha, /no se pudieron leer los WhatsApp del registro/);
});
