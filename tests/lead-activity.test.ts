import assert from "node:assert/strict";
import { test } from "node:test";

import {
  humanizeNote,
  humanizeTitle,
  mergeTwinEntries,
  prepareActivity,
  type ActivityEntry,
} from "../src/lib/lead-activity.ts";

function entry(partial: Partial<ActivityEntry> & Pick<ActivityEntry, "key" | "source">): ActivityEntry {
  return {
    side: "equipo",
    date: "2026-05-20T12:21:00.000Z",
    title: "Gestión",
    notes: null,
    agenda: null,
    agent: "Cristian Rodriguez",
    ...partial,
  };
}

test("los códigos internos no llegan a la pantalla", () => {
  assert.equal(humanizeTitle("callback"), "Volver a llamar");
  assert.equal(humanizeTitle("no_answer"), "No contesta");
  assert.equal(humanizeTitle("VOLVER A LLAMAR"), "VOLVER A LLAMAR");
  assert.equal(humanizeTitle(null), "Gestión");
});

test("las notas muestran la hora de Chile y el evento en español", () => {
  assert.equal(
    humanizeNote("Último evento Atlas: clicked (2026-04-21T14:07:32.748Z)."),
    "Último evento en Atlas Lead: hizo clic en el correo (21 abr 2026 · 10:07).",
  );
  assert.equal(humanizeNote("   "), null);
  assert.equal(humanizeNote("Cliente pide llamar el lunes"), "Cliente pide llamar el lunes");
});

test("la gestión migrada no aparece dos veces", () => {
  const notes = "Último evento Atlas: clicked (2026-04-21T14:07:32.748Z).";
  const merged = mergeTwinEntries([
    entry({ key: "call-1", source: "call", title: "callback", notes, agenda: "2026-05-22T12:21:00.000Z" }),
    entry({ key: "interaction-1", source: "interaction", title: "Volver a llamar", notes, date: "2026-05-20T12:21:40.000Z" }),
    entry({ key: "interaction-2", source: "interaction", title: "No conecta", agent: "Marcela", date: "2026-04-16T12:00:00.000Z" }),
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].key, "call-1");
  assert.equal(merged[0].title, "Volver a llamar");
  assert.equal(merged[0].agenda, "2026-05-22T12:21:00.000Z");
});

test("dos gestiones distintas del mismo ejecutivo no se fusionan", () => {
  const merged = mergeTwinEntries([
    entry({ key: "call-1", source: "call", notes: "a" }),
    entry({ key: "interaction-1", source: "interaction", notes: "b" }),
    entry({ key: "call-2", source: "call", date: "2026-05-20T12:30:00.000Z" }),
    entry({ key: "interaction-3", source: "interaction", date: "2026-05-20T12:40:00.000Z" }),
  ]);
  assert.equal(merged.length, 4);
});

test("la conversación se lee de arriba hacia abajo, lo más nuevo al final", () => {
  const ordered = prepareActivity([
    entry({ key: "b", source: "whatsapp", side: "cliente", date: "2026-10-07T17:16:53Z" }),
    entry({ key: "a", source: "whatsapp", side: "cliente", date: "2026-10-07T17:16:10Z" }),
  ]);
  assert.deepEqual(ordered.map((item) => item.key), ["a", "b"]);
});
