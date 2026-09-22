import assert from "node:assert/strict";
import { test } from "node:test";

import {
  channelSegmentHref,
  channelSlug,
  parseChannelSegment,
} from "../src/lib/channel-segment.ts";

const range = { from: "2026-08-23T04:00:00.000Z", to: "2026-09-23T02:59:59.999Z" };

function paramsOf(href: string) {
  return Object.fromEntries(new URL(href, "https://atlas.test").searchParams);
}

test("la celda del reporte y el filtro de Registros son el mismo segmento", () => {
  for (const name of ["Mail", "WhatsApp", "Llamada / base"]) {
    const channel = channelSlug(name);
    assert.ok(channel, name);
    const segment = { channel, stage: "contactados" as const, ...range };
    assert.deepEqual(parseChannelSegment(paramsOf(channelSegmentHref(segment))), segment);
  }
});

test("la fila Total abre todos los canales", () => {
  const segment = { channel: null, stage: "ventas" as const, ...range };
  assert.deepEqual(parseChannelSegment(paramsOf(channelSegmentHref(segment))), segment);
});

test("un enlace incompleto o inventado no filtra nada", () => {
  assert.equal(parseChannelSegment({ canal: "mail", etapa: "contactados" }), null);
  assert.equal(parseChannelSegment({ canal: "fax", etapa: "base", desde: range.from, hasta: range.to }), null);
  assert.equal(parseChannelSegment({ canal: "mail", etapa: "todo", desde: range.from, hasta: range.to }), null);
  assert.equal(parseChannelSegment({ canal: "mail", etapa: "base", desde: "ayer", hasta: range.to }), null);
});
