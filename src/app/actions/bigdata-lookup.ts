"use server";

import { requireProfile } from "@/lib/auth";
import { fichaBigdata, type FichaBigdataResultado } from "@/lib/bigdata-ficha-remota";
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
      bigdata: FichaBigdataResultado;
    };

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
