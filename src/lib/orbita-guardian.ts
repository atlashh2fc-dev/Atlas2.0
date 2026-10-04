import { ultimoTurno } from "./orbita-cron.ts";

/**
 * Atlas Órbita · el Guardián de la nube.
 *
 * Corre dentro del reloj de Atlas cada 5 minutos, así que no depende de
 * ningún computador encendido. Decide, sin tocar la base (puro, con pruebas):
 *
 * - a qué agente de la nube le toca su turno y todavía no se lanzó;
 * - qué turno de la nube falló o se colgó y merece otro intento (máximo 3);
 * - qué agente de fuera de Atlas (el equipo local) no corrió a su hora, para
 *   marcarlo atrasado. A esos no los puede relanzar: solo avisa.
 */

export const MAX_INTENTOS = 3;
/** Un turno de la nube más viejo que esto ya no se lanza (al encender, no corre el de ayer). */
export const VENTANA_NUBE_MIN = 6 * 60;
/** El equipo local sale con desfase (hasta 14 min) y su Guardián lo recupera en ~30: margen antes de avisar. */
export const GRACIA_LOCAL_MIN = 45;
/** Espera entre un intento fallido y el siguiente. */
export const ESPERA_REINTENTO_MIN = 5;
/** Un turno lanzado que no arrancó (la llamada se perdió) se da por fallido después de esto. */
export const ESPERA_ARRANQUE_MIN = 5;

export type AgenteParaGuardian = {
  codigo: string;
  motor: string | null;
  activo: boolean;
  cron: string | null;
  duracion_max_min: number;
  ultimo_estado: string;
  ultimo_evento_at: string | null;
};

export type EjecucionParaGuardian = {
  id: string;
  agente_codigo: string;
  programada_para: string;
  intento: number;
  estado: "pendiente" | "corriendo" | "ok" | "error";
  iniciada_at: string | null;
  terminada_at: string | null;
  created_at: string;
};

export type Lanzamiento = { codigo: string; programada_para: string; intento: number; motivo: "turno" | "reintento" | "colgada" };

export type DecisionDelGuardian = {
  lanzar: Lanzamiento[];
  /** Ejecuciones a cerrar como error (colgadas o que nunca arrancaron), con su motivo. */
  cerrar: { id: string; motivo: string }[];
  /** Agentes de la nube que agotaron sus intentos en el turno (para avisar una vez). */
  agotados: { codigo: string; programada_para: string }[];
  /** Agentes de fuera de Atlas que no corrieron a su hora. */
  atrasados: { codigo: string; turno: string }[];
  /** Dos o más agentes del equipo local atrasados a la vez: ese equipo parece apagado. */
  equipoLocalSinSenal: boolean;
};

const MINUTO = 60_000;
const ms = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);

/** Los motores que corren un turno con IA. El Guardián es el propio reloj. */
export const MOTORES_CON_TURNO = new Set(["ceo", "lider", "inteligencia"]);

export function decidirGuardian(
  agentes: readonly AgenteParaGuardian[],
  ejecuciones: readonly EjecucionParaGuardian[],
  ahora: Date,
): DecisionDelGuardian {
  const decision: DecisionDelGuardian = { lanzar: [], cerrar: [], agotados: [], atrasados: [], equipoLocalSinSenal: false };
  const t = ahora.getTime();

  for (const agente of agentes) {
    if (!agente.activo || !agente.cron) continue;

    if (agente.motor && MOTORES_CON_TURNO.has(agente.motor)) {
      const turno = ultimoTurno(agente.cron, ahora, VENTANA_NUBE_MIN);
      if (!turno) continue;
      const turnoIso = turno.toISOString();
      const delTurno = ejecuciones
        .filter((ejecucion) => ejecucion.agente_codigo === agente.codigo && ms(ejecucion.programada_para) === turno.getTime())
        .sort((a, b) => b.intento - a.intento);
      const ultima = delTurno[0];

      if (!ultima) {
        decision.lanzar.push({ codigo: agente.codigo, programada_para: turnoIso, intento: 1, motivo: "turno" });
        continue;
      }

      let fallo: "reintento" | "colgada" | null = null;
      let desde = ms(ultima.terminada_at);
      if (ultima.estado === "corriendo" && t - ms(ultima.iniciada_at) > agente.duracion_max_min * MINUTO) {
        decision.cerrar.push({ id: ultima.id, motivo: `Colgada: más de ${agente.duracion_max_min} min corriendo` });
        fallo = "colgada";
        desde = t - ESPERA_REINTENTO_MIN * MINUTO;
      } else if (ultima.estado === "pendiente" && t - ms(ultima.created_at) > ESPERA_ARRANQUE_MIN * MINUTO) {
        decision.cerrar.push({ id: ultima.id, motivo: "No arrancó: la llamada al motor se perdió" });
        fallo = "reintento";
        desde = t - ESPERA_REINTENTO_MIN * MINUTO;
      } else if (ultima.estado === "error") {
        fallo = "reintento";
      }
      if (!fallo) continue;

      if (ultima.intento >= MAX_INTENTOS) {
        // Si el último intento falló en el motor, el motor ya avisó; si se colgó o no arrancó, avisa el Guardián.
        if (ultima.estado !== "error") decision.agotados.push({ codigo: agente.codigo, programada_para: turnoIso });
        continue;
      }
      if (Number.isFinite(desde) && t - desde < ESPERA_REINTENTO_MIN * MINUTO) continue;
      decision.lanzar.push({ codigo: agente.codigo, programada_para: turnoIso, intento: ultima.intento + 1, motivo: fallo });
      continue;
    }

    if (agente.motor) continue;

    // Agente de fuera de Atlas: solo se mira si corrió.
    const turno = ultimoTurno(agente.cron, ahora);
    if (!turno || t - turno.getTime() < GRACIA_LOCAL_MIN * MINUTO) continue;
    if (agente.ultimo_estado === "atrasado") continue;
    const ultimoEvento = ms(agente.ultimo_evento_at);
    if (Number.isFinite(ultimoEvento) && ultimoEvento >= turno.getTime()) continue;
    decision.atrasados.push({ codigo: agente.codigo, turno: turno.toISOString() });
  }

  const yaAtrasados = agentes.filter((agente) => !agente.motor && agente.activo && agente.ultimo_estado === "atrasado").length;
  decision.equipoLocalSinSenal = decision.atrasados.length > 0 && yaAtrasados + decision.atrasados.length >= 2;
  return decision;
}
