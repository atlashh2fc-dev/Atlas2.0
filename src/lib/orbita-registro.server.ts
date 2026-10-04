import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { cambiosTrasEventos, type EstadoAgente, type TipoEvento } from "./orbita";

/**
 * Lo que comparten las puertas de Órbita (la entrada de eventos, el puente de
 * tareas y los motores de la nube): guardar eventos moviendo el estado de cada
 * agente, y verificar la firma de quien envía desde fuera de Atlas.
 */

export type EventoAGuardar = {
  agente: string;
  tipo: TipoEvento;
  estado?: EstadoAgente | null;
  resumen?: string | null;
  detalle?: Record<string, unknown>;
  relacionado_con?: string | null;
  /** ISO 8601; por defecto, ahora. */
  ocurrido_at?: string;
};

/**
 * Guarda los eventos en la bitácora y actualiza el estado de los agentes
 * según `cambiosTrasEventos`. `estadosFijos` es el estado puesto a mano (un
 * agente declarado con estado), que solo manda si los eventos no dicen otro.
 */
export async function registrarEventos(
  admin: SupabaseClient,
  organizationId: string,
  eventos: readonly EventoAGuardar[],
  estadosFijos: ReadonlyMap<string, EstadoAgente> = new Map(),
): Promise<{ error: string | null; estadosActualizados: number }> {
  const ahora = new Date().toISOString();
  const filas = eventos.map((evento) => ({
    organization_id: organizationId,
    agente_codigo: evento.agente,
    tipo: evento.tipo,
    estado: evento.estado ?? null,
    resumen: evento.resumen ?? null,
    detalle: evento.detalle ?? {},
    relacionado_con: evento.relacionado_con ?? null,
    ocurrido_at: evento.ocurrido_at ?? ahora,
  }));

  if (filas.length > 0) {
    const { error } = await admin.from("orbita_eventos").insert(filas);
    if (error) return { error: `No se pudieron guardar los eventos: ${error.message}`, estadosActualizados: 0 };
  }

  const { data: actuales, error: errorActuales } = await admin
    .from("orbita_agentes")
    .select("codigo, ultimo_evento_at")
    .eq("organization_id", organizationId);
  if (errorActuales) return { error: `No se pudo leer los agentes: ${errorActuales.message}`, estadosActualizados: 0 };

  const cambios = cambiosTrasEventos(
    (actuales ?? []).map((fila) => ({ codigo: fila.codigo as string, ultimo_evento_at: (fila.ultimo_evento_at as string | null) ?? null })),
    filas.map((fila) => ({
      agente: fila.agente_codigo,
      tipo: fila.tipo,
      estado: fila.estado,
      resumen: fila.resumen,
      relacionado_con: fila.relacionado_con,
      ocurrido_at: fila.ocurrido_at,
    })),
  );
  for (const [codigo, estado] of estadosFijos) {
    const cambio = cambios.get(codigo) ?? {};
    if (!cambio.ultimo_estado) cambios.set(codigo, { ...cambio, ultimo_estado: estado });
  }

  const resultados = await Promise.all(
    [...cambios].map(([codigo, cambio]) => admin.from("orbita_agentes").update(cambio).eq("organization_id", organizationId).eq("codigo", codigo)),
  );
  const fallido = resultados.find((resultado) => resultado.error);
  if (fallido?.error) return { error: `Los eventos quedaron guardados, pero no se pudo actualizar el estado: ${fallido.error.message}`, estadosActualizados: 0 };
  return { error: null, estadosActualizados: cambios.size };
}

// ---------------------------------------------------------------------------
// Firma de lo que llega desde fuera de Atlas
// ---------------------------------------------------------------------------

const VENTANA_SEGUNDOS = 300;

function firmaValida(secreto: string, timestamp: string, cuerpo: string, recibida: string): boolean {
  const esperada = createHmac("sha256", secreto).update(`${timestamp}.${cuerpo}`).digest("hex");
  const a = Buffer.from(esperada);
  const b = Buffer.from(recibida.trim().toLowerCase().replace(/^sha256=/, ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export type EnvioFirmado = { ok: true; cuerpo: string } | { ok: false; status: number; error: string };

/**
 * Firma HMAC-SHA256 sobre `<timestamp>.<cuerpo crudo>` con
 * MARKETING_INGEST_SECRET y una marca de tiempo de menos de 5 minutos. Sin
 * clave configurada, 503.
 */
export async function leerEnvioFirmado(request: Request, maxBytes: number): Promise<EnvioFirmado> {
  const secreto = process.env.MARKETING_INGEST_SECRET?.trim();
  if (!secreto) return { ok: false, status: 503, error: "Integración no configurada" };

  const timestamp = request.headers.get("x-atlas-timestamp") ?? "";
  const firma = request.headers.get("x-atlas-signature") ?? "";
  const cuerpo = await request.text();

  if (cuerpo.length > maxBytes) return { ok: false, status: 413, error: "Envío demasiado grande" };
  const segundos = Number(timestamp);
  if (!Number.isFinite(segundos) || Math.abs(Date.now() / 1000 - segundos) > VENTANA_SEGUNDOS) {
    return { ok: false, status: 401, error: "Marca de tiempo fuera de ventana" };
  }
  if (!firma || !firmaValida(secreto, timestamp, cuerpo, firma)) return { ok: false, status: 401, error: "Firma inválida" };
  return { ok: true, cuerpo };
}

/** La empresa atada a la clave (MARKETING_INGEST_ORG, por slug): el cuerpo no puede elegir otra. */
export async function empresaDeLaIntegracion(admin: SupabaseClient): Promise<string | null> {
  const slug = process.env.MARKETING_INGEST_ORG?.trim() || "altius";
  const { data, error } = await admin.rpc("organization_id_by_slug", { p_slug: slug });
  if (error || typeof data !== "string") {
    console.error("[orbita] empresa de la integración no encontrada", slug, error?.message);
    return null;
  }
  return data;
}
