import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { cambiosTrasEventos, type EstadoAgente } from "@/lib/orbita";
import { envioDeOrbitaSchema, validarEnvioOrbita } from "@/lib/orbita-ingreso";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Entrada de Órbita: los agentes de marketing con IA se declaran y cuentan lo
 * que hacen.
 *
 *   { "agentes": [ { codigo, nombre, rol, horario, color, conexiones, ... } ],
 *     "eventos": [ { agente, tipo, estado?, resumen?, detalle?, relacionado_con?, ocurrido_at? } ] }
 *
 * Los agentes se identifican por (empresa, código): reenviarlos actualiza, no
 * duplica. Cada evento queda en la bitácora y mueve el estado del agente según
 * `efectosDelEvento` (src/lib/orbita.ts).
 *
 * Misma puerta que la entrada del calendario de Marketing: firma HMAC-SHA256
 * sobre `<timestamp>.<cuerpo crudo>` con MARKETING_INGEST_SECRET y una marca de
 * tiempo de menos de 5 minutos. La clave está atada a una empresa
 * (MARKETING_INGEST_ORG, por slug): el cuerpo no puede elegir otra. Sin clave
 * configurada la ruta responde 503.
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

  const envio = envioDeOrbitaSchema.safeParse(datos);
  if (!envio.success) {
    return NextResponse.json({ error: envio.error.issues[0]?.message ?? "Cuerpo inválido" }, { status: 400 });
  }

  const slug = process.env.MARKETING_INGEST_ORG?.trim() || "altius";
  const admin = createAdminClient();
  const { data: organizationId, error: errorEmpresa } = await admin.rpc("organization_id_by_slug", { p_slug: slug });
  if (errorEmpresa || typeof organizationId !== "string") {
    console.error("[orbita-ingest] empresa no encontrada", slug, errorEmpresa?.message);
    return NextResponse.json({ error: "Empresa de la integración no encontrada" }, { status: 503 });
  }

  const { data: actuales, error: errorActuales } = await admin
    .from("orbita_agentes")
    .select("codigo, ultimo_evento_at")
    .eq("organization_id", organizationId);
  if (errorActuales) {
    console.error("[orbita-ingest] no se pudo leer los agentes", errorActuales.message);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }

  const { agentes, estados, eventos, errores } = validarEnvioOrbita(
    envio.data,
    organizationId,
    (actuales ?? []).map((fila) => fila.codigo as string),
  );
  // Todo o nada: un lote a medias deja la red desordenada y el agente no
  // sabría qué reenviar.
  if (errores.length > 0) {
    return NextResponse.json({ error: "Hay agentes o eventos inválidos; no se guardó nada", detalle: errores }, { status: 422 });
  }

  if (agentes.length > 0) {
    const { error } = await admin.from("orbita_agentes").upsert(agentes, { onConflict: "organization_id,codigo" });
    if (error) {
      console.error("[orbita-ingest] fallo al guardar agentes", error.message);
      return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
    }
  }

  if (eventos.length > 0) {
    const { error } = await admin.from("orbita_eventos").insert(eventos);
    if (error) {
      console.error("[orbita-ingest] fallo al guardar eventos", error.message);
      return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
    }
  }

  // Lo que los eventos dicen de cada agente, sobre el estado fijado a mano.
  const conocidos = new Map<string, string | null>((actuales ?? []).map((fila) => [fila.codigo as string, (fila.ultimo_evento_at as string | null) ?? null]));
  for (const agente of agentes) if (!conocidos.has(agente.codigo)) conocidos.set(agente.codigo, null);
  const cambios = cambiosTrasEventos(
    [...conocidos].map(([codigo, ultimo_evento_at]) => ({ codigo, ultimo_evento_at })),
    eventos.map((evento) => ({
      agente: evento.agente_codigo,
      tipo: evento.tipo,
      estado: evento.estado,
      resumen: evento.resumen,
      relacionado_con: evento.relacionado_con,
      ocurrido_at: evento.ocurrido_at,
    })),
  );
  for (const [codigo, estado] of estados) {
    const cambio = cambios.get(codigo) ?? {};
    if (!cambio.ultimo_estado) cambios.set(codigo, { ...cambio, ultimo_estado: estado as EstadoAgente });
  }

  const resultados = await Promise.all(
    [...cambios].map(([codigo, cambio]) =>
      admin.from("orbita_agentes").update(cambio).eq("organization_id", organizationId).eq("codigo", codigo),
    ),
  );
  const fallidos = resultados.filter((resultado) => resultado.error);
  if (fallidos.length > 0) {
    console.error("[orbita-ingest] fallo al actualizar estados", fallidos[0].error?.message);
    return NextResponse.json({ error: "Los eventos quedaron guardados, pero no se pudo actualizar el estado de los agentes" }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, agentes: agentes.length, eventos: eventos.length, estados_actualizados: cambios.size },
    { status: 200 },
  );
}
