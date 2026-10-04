import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { MAX_INTENTOS, MOTORES_CON_TURNO } from "./orbita-guardian";
import { correrTurno, type AgenteDeLaRed, type MotorConTurno } from "./orbita-motores.server";
import { registrarEventos, type EventoAGuardar } from "./orbita-registro.server";

/**
 * Un turno de un agente de Órbita en la nube, a partir de su ejecución.
 *
 * Lo usan el reloj (directo, dentro de la misma función, sin llamarse a sí
 * mismo por HTTP) y /api/orbita/ejecutar (para lanzar un turno a mano). Toma
 * la ejecución solo si sigue pendiente, así dos llamadas al mismo turno no
 * corren dos veces.
 *
 * Devuelve `trabajo`, la parte lenta (pensar y guardar), para correrla después
 * de responder con `after()`.
 */

const COLUMNAS = "codigo, nombre, persona, rol, horario, motor, activo, instrucciones, ultimo_estado, ultimo_resumen, ultimo_evento_at";

export type TurnoTomado =
  | { tomada: false; error?: string }
  | { tomada: true; agente: string; intento: number; trabajo: () => Promise<void> };

export async function tomarTurno(admin: SupabaseClient, ejecucionId: string): Promise<TurnoTomado> {
  const ahora = new Date();
  // Tomarla de forma atómica: solo una llamada la pasa de pendiente a corriendo.
  const { data: tomada, error: errorTomar } = await admin
    .from("orbita_ejecuciones")
    .update({ estado: "corriendo", iniciada_at: ahora.toISOString() })
    .eq("id", ejecucionId)
    .eq("estado", "pendiente")
    .select("id, organization_id, agente_codigo, intento")
    .maybeSingle();
  if (errorTomar) return { tomada: false, error: errorTomar.message };
  if (!tomada) return { tomada: false };

  const organizationId = tomada.organization_id as string;
  const codigo = tomada.agente_codigo as string;
  const intento = tomada.intento as number;

  const { data: agenteData, error: errorAgente } = await admin
    .from("orbita_agentes")
    .select(COLUMNAS)
    .eq("organization_id", organizationId)
    .eq("codigo", codigo)
    .maybeSingle();
  const agente = agenteData as AgenteDeLaRed | null;
  const motor = agente?.motor && MOTORES_CON_TURNO.has(agente.motor) ? (agente.motor as MotorConTurno) : null;
  if (errorAgente || !agente || !motor) {
    const motivo = errorAgente?.message ?? "El agente no existe o no tiene un motor de la nube";
    await admin.from("orbita_ejecuciones").update({ estado: "error", error: motivo, terminada_at: new Date().toISOString() }).eq("id", ejecucionId);
    return { tomada: false, error: motivo };
  }

  const { data: guardian } = await admin
    .from("orbita_agentes")
    .select("codigo")
    .eq("organization_id", organizationId)
    .eq("motor", "guardian")
    .limit(1)
    .maybeSingle();

  const trabajo = async () => {
    await registrarEventos(admin, organizationId, [
      { agente: codigo, tipo: "inicio", resumen: intento > 1 ? `Turno en la nube (intento ${intento})` : "Turno en la nube", detalle: { ejecucion: ejecucionId } },
    ]);
    try {
      const resultado = await correrTurno(motor, { admin, organizationId, agente, ahora });
      await admin
        .from("orbita_ejecuciones")
        .update({ estado: "ok", resumen: resultado.resumen, uso: resultado.uso, terminada_at: new Date().toISOString() })
        .eq("id", ejecucionId);
      await registrarEventos(admin, organizationId, [
        { agente: codigo, tipo: "fin", estado: "ok", resumen: resultado.resumen, relacionado_con: resultado.destino, detalle: { ejecucion: ejecucionId, uso: resultado.uso } },
      ]);
    } catch (error) {
      const motivo = error instanceof Error ? error.message : "Error desconocido";
      console.error(`[orbita-nube] ${codigo} falló (intento ${intento}): ${motivo}`);
      await admin.from("orbita_ejecuciones").update({ estado: "error", error: motivo, terminada_at: new Date().toISOString() }).eq("id", ejecucionId);
      const eventos: EventoAGuardar[] = [{ agente: codigo, tipo: "error", resumen: motivo, detalle: { ejecucion: ejecucionId, intento } }];
      // El último intento avisa al CEO (y, si no hay CEO, queda en la bitácora del Guardián).
      if (intento >= MAX_INTENTOS && guardian?.codigo) {
        eventos.push({
          agente: guardian.codigo as string,
          tipo: "alerta",
          estado: "error",
          relacionado_con: codigo,
          resumen: `${agente.persona ?? agente.nombre} no pudo completar su turno tras ${MAX_INTENTOS} intentos: ${motivo}`,
        });
      }
      await registrarEventos(admin, organizationId, eventos);
    }
  };

  return { tomada: true, agente: codigo, intento, trabajo };
}
