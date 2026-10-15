import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type ChannelSegment,
  channelSegmentHref,
  channelSegmentLabel,
  channelSlug,
  parseChannelSegment,
} from "../src/lib/channel-segment.ts";

const range = { from: "2026-08-23T04:00:00.000Z", to: "2026-09-23T02:59:59.999Z" };
const campaignId = "111cb0ed-6e72-4c68-a83f-236d3c86b60b";

function paramsOf(href: string) {
  return Object.fromEntries(new URL(href, "https://atlas.test").searchParams);
}

test("la celda del reporte y el filtro de Registros son el mismo segmento", () => {
  for (const name of ["Llamada saliente", "Llamada entrante", "WhatsApp", "Correo"]) {
    const channel = channelSlug(name);
    assert.ok(channel, name);
    for (const stage of ["base", "gestionados", "contactados", "interesados", "ventas"] as const) {
      const segment: ChannelSegment = { campaignId, channel, stage, ...range };
      assert.deepEqual(parseChannelSegment(paramsOf(channelSegmentHref(segment))), segment);
    }
  }
});

test("la fila Total abre todos los canales", () => {
  const segment = { campaignId, channel: null, stage: "ventas" as const, ...range };
  assert.deepEqual(parseChannelSegment(paramsOf(channelSegmentHref(segment))), segment);
});

test("el segmento no usa el filtro de campaña de Registros, que dejaría fuera a las hijas", () => {
  const params = paramsOf(channelSegmentHref({ campaignId, channel: "whatsapp", stage: "base", ...range }));
  assert.equal(params.campaign, undefined);
  assert.equal(params.grupo, campaignId);
});

test("un enlace incompleto o inventado no filtra nada", () => {
  const full = { grupo: campaignId, desde: range.from, hasta: range.to };
  assert.equal(parseChannelSegment({ canal: "correo", etapa: "contactados" }), null);
  assert.equal(parseChannelSegment({ ...full, canal: "fax", etapa: "base" }), null);
  assert.equal(parseChannelSegment({ ...full, canal: "correo", etapa: "todo" }), null);
  assert.equal(parseChannelSegment({ ...full, canal: "correo", etapa: "base", desde: "ayer" }), null);
  // Enlaces de antes de la campaña madre: sin campaña no hay qué desglosar.
  assert.equal(parseChannelSegment({ canal: "mail", etapa: "base", desde: range.from, hasta: range.to }), null);
  assert.equal(parseChannelSegment({ ...full, grupo: "no-es-un-id", canal: "correo", etapa: "base" }), null);
});

test("la etiqueta nombra la campaña, el canal, la etapa y el período", () => {
  const label = channelSegmentLabel(
    { campaignId, channel: "whatsapp", stage: "contactados", ...range },
    "Secretaria Virtual",
  );
  assert.equal(label, "Secretaria Virtual · WhatsApp · Contactados · 23-08-2026 a 22-09-2026");
  assert.match(
    channelSegmentLabel({ campaignId, channel: null, stage: "base", ...range }),
    /^Todos los canales · Base · toda la base del canal$/,
  );
});
