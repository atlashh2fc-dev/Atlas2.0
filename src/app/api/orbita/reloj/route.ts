import { NextResponse } from "next/server";

import { cronAutorizado } from "@/lib/cron-autorizado";
import { decidirGuardian, type AgenteParaGuardian, type EjecucionParaGuardian } from "@/lib/orbita-guardian";
import { horaExacta } from "@/lib/orbita";
import { registrarEventos, type EventoAGuardar } from "@/lib/orbita-registro.server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * El reloj de Órbita: corre cada 5 minutos en Vercel Cron y es el Guardián
 * de la nube. Por cada empresa con agentes en la nube:
 *
 * 1. lanza los turnos que tocan (cada uno en su propia llamada a
 *    /api/orbita/ejecutar, para que un agente lento no frene a los demás);
 * 2. recupera los turnos que fallaron o se colgaron (hasta 3 intentos);
 * 3. marca atrasados a los agentes de fuera de Atlas que no corrieron a su
 *    hora y avisa si ese equipo parece apagado;
 * 4. deja un latido cada 15 minutos.
 *
 * No depende de ningún computador encendido.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const COLUMNAS_AGENTE = "codigo, nombre, persona, motor, activo, cron, duracion_max_min, ultimo_estado, ultimo_evento_at";
const COLUMNAS_EJECUCION = "id, agente_codigo, programada_para, intento, estado, iniciada_at, terminada_at, created_at";

type Agente = AgenteParaGuardian & { nombre: string; persona: string | null };

export async function GET(request: Request) {
  if (!cronAutorizado(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const admin = createAdminClient();
  const ahora = new Date();

  const { data: conMotor, error: errorEmpresas } = await admin.from("orbita_agentes").select("organization_id").not("motor", "is", null);
  if (errorEmpresas) return NextResponse.json({ error: errorEmpresas.message }, { status: 500 });
  const empresas = [...new Set((conMotor ?? []).map((fila) => fila.organization_id as string))];

  const salida: Record<string, unknown>[] = [];
  for (const organizationId of empresas) {
    try {
      salida.push({ empresa: organizationId, ...(await vuelta(admin, organizationId, ahora, request)) });
    } catch (error) {
      const motivo = error instanceof Error ? error.message : "Error desconocido";
      console.error(`[orbita-reloj] ${organizationId}: ${motivo}`);
      salida.push({ empresa: organizationId, error: motivo });
    }
  }
  return NextResponse.json({ ok: true, empresas: salida });
}

async function vuelta(admin: ReturnType<typeof createAdminClient>, organizationId: string, ahora: Date, request: Request) {
  const [agentesR, ejecucionesR] = await Promise.all([
    admin.from("orbita_agentes").select(COLUMNAS_AGENTE).eq("organization_id", organizationId),
    admin
      .from("orbita_ejecuciones")
      .select(COLUMNAS_EJECUCION)
      .eq("organization_id", organizationId)
      .gte("programada_para", new Date(ahora.getTime() - 26 * 3_600_000).toISOString()),
  ]);
  if (agentesR.error) throw new Error(`No se pudo leer los agentes: ${agentesR.error.message}`);
  if (ejecucionesR.error) throw new Error(`No se pudo leer las ejecuciones: ${ejecucionesR.error.message}`);
  const agentes = (agentesR.data ?? []) as Agente[];
  const porCodigo = new Map(agentes.map((agente) => [agente.codigo, agente]));
  const nombre = (codigo: string) => porCodigo.get(codigo)?.persona ?? porCodigo.get(codigo)?.nombre ?? codigo;
  const guardian = agentes.find((agente) => agente.motor === "guardian" && agente.activo)?.codigo ?? null;

  const decision = decidirGuardian(agentes, (ejecucionesR.data ?? []) as EjecucionParaGuardian[], ahora);
  const eventos: EventoAGuardar[] = [];

  // Sin clave de IA no se lanza nada (fallaría 3 veces por turno): se avisa una vez cada 12 h.
  if (decision.lanzar.length > 0 && !process.env.ANTHROPIC_API_KEY?.trim()) {
    decision.lanzar = [];
    if (guardian) {
      const { count } = await admin
        .from("orbita_eventos")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("agente_codigo", guardian)
        .eq("detalle->>sin_clave_ia", "true")
        .gte("ocurrido_at", new Date(ahora.getTime() - 12 * 3_600_000).toISOString());
      if (!count) {
        eventos.push({
          agente: guardian,
          tipo: "alerta",
          resumen: "Los agentes de la nube no pueden trabajar: falta configurar la clave de IA (ANTHROPIC_API_KEY) en Atlas.",
          detalle: { sin_clave_ia: true },
        });
      }
    }
  }

  for (const cierre of decision.cerrar) {
    await admin
      .from("orbita_ejecuciones")
      .update({ estado: "error", error: cierre.motivo, terminada_at: ahora.toISOString() })
      .eq("id", cierre.id)
      .in("estado", ["pendiente", "corriendo"]);
  }

  const lanzados: string[] = [];
  for (const lanzamiento of decision.lanzar) {
    const { data: creada, error } = await admin
      .from("orbita_ejecuciones")
      .insert({ organization_id: organizationId, agente_codigo: lanzamiento.codigo, programada_para: lanzamiento.programada_para, intento: lanzamiento.intento })
      .select("id")
      .maybeSingle();
    // Otro reloj ya lo creó (choca con el único por turno): no se lanza dos veces.
    if (error || !creada) continue;
    const respuesta = await fetch(new URL("/api/orbita/ejecutar", request.url), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.CRON_SECRET?.trim() ?? ""}` },
      body: JSON.stringify({ ejecucion_id: creada.id }),
    }).catch((falla: unknown) => falla as Error);
    if (respuesta instanceof Error || !respuesta.ok) {
      // Queda pendiente: el Guardián la da por perdida a los 5 min y reintenta.
      console.error(`[orbita-reloj] no se pudo lanzar a ${lanzamiento.codigo}`, respuesta instanceof Error ? respuesta.message : respuesta.status);
      continue;
    }
    lanzados.push(lanzamiento.codigo);
    if (guardian && lanzamiento.motivo !== "turno") {
      eventos.push({
        agente: guardian,
        tipo: "recuperacion",
        relacionado_con: lanzamiento.codigo,
        resumen: `Relanzó a ${nombre(lanzamiento.codigo)} (intento ${lanzamiento.intento}): ${lanzamiento.motivo === "colgada" ? "se había colgado" : "el turno anterior falló"}`,
      });
    }
  }

  if (guardian) {
    for (const agotado of decision.agotados) {
      eventos.push({
        agente: guardian,
        tipo: "alerta",
        estado: "error",
        relacionado_con: agotado.codigo,
        resumen: `${nombre(agotado.codigo)} no pudo completar su turno tras 3 intentos`,
      });
    }
    for (const atrasado of decision.atrasados) {
      eventos.push({
        agente: guardian,
        tipo: "alerta",
        estado: "atrasado",
        relacionado_con: atrasado.codigo,
        resumen: `${nombre(atrasado.codigo)} no corrió a su hora (${horaExacta(atrasado.turno)})`,
      });
    }
    if (decision.equipoLocalSinSenal) {
      const { count } = await admin
        .from("orbita_eventos")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("agente_codigo", guardian)
        .eq("tipo", "alerta")
        .eq("detalle->>equipo_local", "true")
        .gte("ocurrido_at", new Date(ahora.getTime() - 6 * 3_600_000).toISOString());
      if (!count) {
        eventos.push({
          agente: guardian,
          tipo: "alerta",
          resumen: "Los agentes del equipo local no están corriendo. Revisa que el computador que los ejecuta esté encendido y con la app de Claude abierta.",
          detalle: { equipo_local: true },
        });
      }
    }
    // Latido cada 15 minutos (el reloj corre cada 5).
    if (ahora.getUTCMinutes() % 15 < 5) {
      const activos = agentes.filter((agente) => agente.activo);
      const sanos = activos.filter((agente) => agente.ultimo_estado === "ok" || agente.ultimo_estado === "corriendo" || agente.ultimo_estado === "inactivo").length;
      eventos.push({ agente: guardian, tipo: "pulso", estado: "ok", resumen: `Ronda de vigilancia: ${sanos} de ${activos.length} al día` });
    }
  }

  if (eventos.length > 0) {
    const { error } = await registrarEventos(admin, organizationId, eventos);
    if (error) throw new Error(error);
  }
  return { lanzados, cerrados: decision.cerrar.length, atrasados: decision.atrasados.map((a) => a.codigo), eventos: eventos.length };
}
