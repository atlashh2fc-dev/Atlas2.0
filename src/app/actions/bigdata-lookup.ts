"use server";

import { requireProfile } from "@/lib/auth";
import { FICHA_RUT_CONTRACT, parseBigdataFicha, type BigdataFicha } from "@/lib/bigdata-ficha";
import { integrationV2Destinations, integrationV2Signature } from "@/lib/integration-v2";
import { compactRut, formatRut, isValidRut } from "@/lib/rut";
import { createClient } from "@/lib/supabase/server";

export type RutEnAtlas = { leadId: string; campaignId: string | null; campaignName: string | null };

export type RutLookupResult =
  | { ok: false; message: string }
  | {
      ok: true;
      rut: string;
      /** Registros que ya tienen este RUT, dentro de lo que el usuario ve. */
      enAtlas: RutEnAtlas[];
      bigdata:
        | { estado: "encontrado"; ficha: BigdataFicha }
        | { estado: "no_encontrado" }
        | { estado: "no_disponible"; motivo: string };
    };

/**
 * Ficha de Bigdata por el puente firmado que ya usa el outbox
 * (INTEGRATION_OUTBOX_DESTINATIONS_JSON.bigdata), igual que la consulta de
 * correos a Atlas Lead: mismo secreto, mismos headers, sin llaves nuevas.
 */
async function fichaBigdata(rut: string): Promise<Extract<RutLookupResult, { ok: true }>["bigdata"]> {
  const destino = integrationV2Destinations(process.env.INTEGRATION_OUTBOX_DESTINATIONS_JSON).get("bigdata");
  if (!destino) return { estado: "no_disponible", motivo: "El puente con Bigdata no está configurado." };

  const url = new URL("/api/commercial-intelligence/atlas-bridge/ficha-rut", destino.url);
  const rawBody = JSON.stringify({ contract: FICHA_RUT_CONTRACT, rut: compactRut(rut) });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-atlas-source": "atlas2",
        "x-atlas-timestamp": timestamp,
        "x-atlas-signature": integrationV2Signature(destino.secret, timestamp, Buffer.from(rawBody)),
      },
      body: rawBody,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    if (response.status === 404) {
      const body = (await response.json().catch(() => null)) as { found?: unknown } | null;
      // Un 404 sin cuerpo del contrato es la ruta que todavía no existe.
      if (body?.found === false) return { estado: "no_encontrado" };
      return { estado: "no_disponible", motivo: "Bigdata todavía no responde consultas por RUT." };
    }
    if (!response.ok) return { estado: "no_disponible", motivo: `Bigdata respondió ${response.status}.` };
    const body: unknown = await response.json().catch(() => null);
    const ficha = parseBigdataFicha(body);
    return ficha ? { estado: "encontrado", ficha } : { estado: "no_encontrado" };
  } catch {
    return { estado: "no_disponible", motivo: "Bigdata no respondió a tiempo." };
  }
}

/** Mismo RUT escrito como lo guardan las distintas cargas. */
function rutVariants(rut: string) {
  const compact = compactRut(rut);
  const body = compact.slice(0, -1);
  const dv = compact.slice(-1);
  return [...new Set([formatRut(rut), compact, `${body}-${dv}`, `${body}-${dv.toLowerCase()}`, formatRut(rut).replace(/K$/, "k")])];
}

export async function buscarRutEnBigdata(rutInput: string): Promise<RutLookupResult> {
  await requireProfile(["supervisor", "admin"]);
  if (!isValidRut(rutInput)) return { ok: false, message: "RUT inválido: revisa el dígito verificador." };
  const rut = formatRut(rutInput);

  const supabase = await createClient();
  const [bigdata, { data: leads }] = await Promise.all([
    fichaBigdata(rut),
    supabase
      .from("leads")
      .select("id, campaign_id, campaigns(name)")
      .in("rut", rutVariants(rut))
      .order("updated_at", { ascending: false })
      .limit(10),
  ]);

  const enAtlas = ((leads ?? []) as { id: string; campaign_id: string | null; campaigns: { name: string } | { name: string }[] | null }[]).map(
    (lead) => {
      const campaign = Array.isArray(lead.campaigns) ? lead.campaigns[0] : lead.campaigns;
      return { leadId: lead.id, campaignId: lead.campaign_id, campaignName: campaign?.name ?? null };
    }
  );

  return { ok: true, rut, enAtlas, bigdata };
}
