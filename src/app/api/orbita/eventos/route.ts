import { NextResponse } from "next/server";

import { envioDeOrbitaSchema, validarEnvioOrbita } from "@/lib/orbita-ingreso";
import { empresaDeLaIntegracion, leerEnvioFirmado, registrarEventos } from "@/lib/orbita-registro.server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Entrada de Órbita: los agentes de marketing con IA se declaran y cuentan lo
 * que hacen.
 *
 *   { "agentes": [ { codigo, nombre, rol, horario, color, conexiones, ... } ],
 *     "eventos": [ { agente, tipo, estado?, resumen?, detalle?, relacionado_con?, ocurrido_at? } ],
 *     "metricas": [ { dia, metrica, valor, agente?, evidencia?: [{ texto, url?, estado? }], fuente? } ] }
 *
 * Los agentes se identifican por (empresa, código): reenviarlos actualiza, no
 * duplica. Cada evento queda en la bitácora y mueve el estado del agente según
 * `efectosDelEvento` (src/lib/orbita.ts). Cada métrica es la cifra de un día
 * con su evidencia: reenviarla la reemplaza (tablero de objetivos).
 *
 * Misma puerta que la entrada del calendario de Marketing: firma HMAC-SHA256
 * sobre `<timestamp>.<cuerpo crudo>` con MARKETING_INGEST_SECRET y una marca de
 * tiempo de menos de 5 minutos. La clave está atada a una empresa
 * (MARKETING_INGEST_ORG, por slug): el cuerpo no puede elegir otra. Sin clave
 * configurada la ruta responde 503.
 */
export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_BYTES = 512 * 1024;

export async function POST(request: Request) {
  const firmado = await leerEnvioFirmado(request, MAX_BYTES);
  if (!firmado.ok) return NextResponse.json({ error: firmado.error }, { status: firmado.status });
  const cuerpo = firmado.cuerpo;

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

  const admin = createAdminClient();
  const organizationId = await empresaDeLaIntegracion(admin);
  if (!organizationId) return NextResponse.json({ error: "Empresa de la integración no encontrada" }, { status: 503 });

  const { data: actuales, error: errorActuales } = await admin
    .from("orbita_agentes")
    .select("codigo, ultimo_evento_at")
    .eq("organization_id", organizationId);
  if (errorActuales) {
    console.error("[orbita-ingest] no se pudo leer los agentes", errorActuales.message);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }

  const { agentes, estados, eventos, metricas, errores } = validarEnvioOrbita(
    envio.data,
    organizationId,
    (actuales ?? []).map((fila) => fila.codigo as string),
  );
  // Todo o nada: un lote a medias deja la red desordenada y el agente no
  // sabría qué reenviar.
  if (errores.length > 0) {
    return NextResponse.json({ error: "Hay agentes, eventos o métricas inválidos; no se guardó nada", detalle: errores }, { status: 422 });
  }

  if (agentes.length > 0) {
    const { error } = await admin.from("orbita_agentes").upsert(agentes, { onConflict: "organization_id,codigo" });
    if (error) {
      console.error("[orbita-ingest] fallo al guardar agentes", error.message);
      return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
    }
  }

  const registro = await registrarEventos(
    admin,
    organizationId,
    eventos.map((evento) => ({
      agente: evento.agente_codigo,
      tipo: evento.tipo,
      estado: evento.estado,
      resumen: evento.resumen,
      detalle: evento.detalle,
      relacionado_con: evento.relacionado_con,
      ocurrido_at: evento.ocurrido_at,
    })),
    estados,
  );
  if (registro.error) {
    console.error("[orbita-ingest]", registro.error);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }

  if (metricas.length > 0) {
    const { error } = await admin.from("orbita_metricas").upsert(metricas, { onConflict: "organization_id,dia,metrica" });
    if (error) {
      console.error("[orbita-ingest] fallo al guardar métricas", error.message);
      return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
    }
  }

  return NextResponse.json(
    { ok: true, agentes: agentes.length, eventos: eventos.length, metricas: metricas.length, estados_actualizados: registro.estadosActualizados },
    { status: 200 },
  );
}
