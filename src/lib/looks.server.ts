import type { SupabaseClient } from "@supabase/supabase-js";

import { instanteEnChile, fechaEnChile } from "@/lib/citas";
import type { FotoParaIA } from "@/lib/ia/look.server";

/*
 * Acceso a datos del Estudio de Look, compartido por las rutas de IA, las
 * acciones y la ficha. Solo servidor.
 */

export const BUCKET_LOOKS = "looks";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LookBase = {
  id: string;
  organization_id: string;
  cuenta_id: string;
  estado: string;
  foto_path: string | null;
  foto_perfil_path: string | null;
  foto_despues_path: string | null;
  retrato_path: string | null;
  pedido: string | null;
};

export async function leerLook(supabase: SupabaseClient, id: string): Promise<LookBase | null> {
  if (!UUID.test(id)) return null;
  const { data } = await supabase
    .from("looks")
    .select("id, organization_id, cuenta_id, estado, foto_path, foto_perfil_path, foto_despues_path, retrato_path, pedido")
    .eq("id", id)
    .maybeSingle();
  return (data as LookBase | null) ?? null;
}

export async function descargarFoto(supabase: SupabaseClient, ruta: string): Promise<FotoParaIA> {
  const { data, error } = await supabase.storage.from(BUCKET_LOOKS).download(ruta);
  if (error || !data) throw new Error("No se pudo leer la foto.");
  const buffer = Buffer.from(await data.arrayBuffer());
  const mime = data.type && data.type.startsWith("image/") ? data.type : "image/jpeg";
  return { data: buffer.toString("base64"), mime };
}

/** Cuántos usos de IA de este tipo lleva la empresa hoy (día de Chile). */
export async function usoDeHoy(admin: SupabaseClient, organizationId: string, tipo: "analisis" | "imagen"): Promise<number> {
  const desde = instanteEnChile(fechaEnChile(new Date()), "00:00").toISOString();
  const { count } = await admin
    .from("uso_ia_looks")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("tipo", tipo)
    .gte("created_at", desde);
  return count ?? 0;
}

export async function registrarUso(
  admin: SupabaseClient,
  fila: { organization_id: string; look_id: string; tipo: "analisis" | "imagen"; proveedor: string; modelo: string | null; ok: boolean; detalle?: Record<string, unknown> },
) {
  await admin.from("uso_ia_looks").insert({ ...fila, detalle: fila.detalle ?? {} });
}

/** Firma varias rutas del bucket de una vez; lo que no se pueda firmar queda sin enlace. */
export async function firmar(supabase: SupabaseClient, rutas: (string | null | undefined)[], segundos = 60 * 60): Promise<Map<string, string>> {
  const validas = [...new Set(rutas.filter((ruta): ruta is string => Boolean(ruta)))];
  if (validas.length === 0) return new Map();
  const { data } = await supabase.storage.from(BUCKET_LOOKS).createSignedUrls(validas, segundos);
  const enlaces = new Map<string, string>();
  for (const fila of data ?? []) if (fila.path && fila.signedUrl) enlaces.set(fila.path, fila.signedUrl);
  return enlaces;
}
