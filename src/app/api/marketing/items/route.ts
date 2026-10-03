import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { envioDeMarketingSchema, validarPiezas } from "@/lib/marketing-ingreso";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Entrada del calendario de Marketing.
 *
 * Los alimentadores (Claude desde el proyecto de marketing, Atlas Lead, Meta)
 * envían las piezas de la semana y sus métricas. Cada pieza se identifica por
 * (empresa, source, external_id): reenviar la semana actualiza, no duplica.
 *
 * Misma puerta que la entrada desde altiusignite.com: firma HMAC-SHA256 sobre
 * `<timestamp>.<cuerpo crudo>` con una marca de tiempo de menos de 5 minutos.
 * La clave está atada a una empresa (MARKETING_INGEST_ORG, por slug): quien la
 * tenga escribe en el calendario de esa empresa y de ninguna otra, diga lo que
 * diga el cuerpo. Sin clave configurada la ruta responde 503.
 */
export const runtime = "nodejs";
export const maxDuration = 20;

const VENTANA_SEGUNDOS = 300;
const MAX_BYTES = 512 * 1024;

function firmaValida(secreto: string, timestamp: string, cuerpo: string, recibida: string): boolean {
  const esperada = createHmac("sha256", secreto).update(`${timestamp}.${cuerpo}`).digest("hex");
  const a = Buffer.from(esperada);
  const b = Buffer.from(recibida.trim().toLowerCase().replace(/^sha256=/, ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const secreto = process.env.MARKETING_INGEST_SECRET?.trim();
  if (!secreto) {
    return NextResponse.json({ error: "Integración no configurada" }, { status: 503 });
  }

  const timestamp = request.headers.get("x-atlas-timestamp") ?? "";
  const firma = request.headers.get("x-atlas-signature") ?? "";
  const cuerpo = await request.text();

  if (cuerpo.length > MAX_BYTES) {
    return NextResponse.json({ error: "Envío demasiado grande" }, { status: 413 });
  }
  const segundos = Number(timestamp);
  if (!Number.isFinite(segundos) || Math.abs(Date.now() / 1000 - segundos) > VENTANA_SEGUNDOS) {
    return NextResponse.json({ error: "Marca de tiempo fuera de ventana" }, { status: 401 });
  }
  if (!firma || !firmaValida(secreto, timestamp, cuerpo, firma)) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let datos: unknown;
  try {
    datos = JSON.parse(cuerpo);
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido: no es JSON" }, { status: 400 });
  }

  const envio = envioDeMarketingSchema.safeParse(datos);
  if (!envio.success) {
    return NextResponse.json({ error: envio.error.issues[0]?.message ?? "Cuerpo inválido" }, { status: 400 });
  }

  const slug = process.env.MARKETING_INGEST_ORG?.trim() || "altius";
  const admin = createAdminClient();
  const { data: organizationId, error: errorEmpresa } = await admin.rpc("organization_id_by_slug", { p_slug: slug });
  if (errorEmpresa || typeof organizationId !== "string") {
    console.error("[marketing-ingest] empresa no encontrada", slug, errorEmpresa?.message);
    return NextResponse.json({ error: "Empresa de la integración no encontrada" }, { status: 503 });
  }

  const { filas, errores } = validarPiezas(envio.data.items, organizationId);
  // Todo o nada: un lote a medias deja la semana desordenada y el alimentador
  // no sabría qué reenviar.
  if (errores.length > 0) {
    return NextResponse.json({ error: "Hay piezas inválidas; no se guardó ninguna", piezas: errores }, { status: 422 });
  }

  const { data, error } = await admin
    .from("marketing_items")
    .upsert(filas, { onConflict: "organization_id,source,external_id" })
    .select("id, source, external_id");

  if (error) {
    console.error("[marketing-ingest] fallo al guardar", error.message);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, guardadas: data?.length ?? 0, piezas: data ?? [] }, { status: 200 });
}
