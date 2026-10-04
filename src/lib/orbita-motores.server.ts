import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { diaDeLaSemana, fechaDeChile, horaDeChile } from "./orbita-cron";
import { registrarEventos, type EventoAGuardar } from "./orbita-registro.server";

/**
 * Atlas Órbita · los motores de la nube.
 *
 * Cada motor es un turno completo de un agente, sin computador de por medio:
 * Atlas arma el contexto desde la memoria compartida (Supabase), le pide a
 * Claude la decisión en un formato fijo (validado con zod) y guarda lo que
 * salga: notas, tareas para otros agentes y eventos para la red.
 *
 * - CEO (0): decide, aprueba o rechaza ideas, asigna tareas, fija la prioridad
 *   de la semana y escala lo indelegable.
 * - Líder (7): mide con las piezas y métricas que llegan a Marketing, escribe
 *   el informe del día (retrospectiva los domingos) y propone al CEO.
 * - Inteligencia (8): investiga en la web a la competencia y lo viral, y deja
 *   ideas con evidencia.
 *
 * La ficha de cada agente es por empresa (`orbita_agentes.instrucciones`): el
 * mismo motor sirve a cualquier cliente.
 */

const MODELO = () => process.env.ORBITA_MODELO?.trim() || "claude-opus-5-5";
const LIMITE_TEXTO = 9000;

export type MotorConTurno = "ceo" | "lider" | "inteligencia";

export type AgenteDeLaRed = {
  codigo: string;
  nombre: string;
  persona: string | null;
  rol: string | null;
  horario: string | null;
  motor: string | null;
  activo: boolean;
  instrucciones: string | null;
  ultimo_estado: string;
  ultimo_resumen: string | null;
  ultimo_evento_at: string | null;
};

export type TurnoDelMotor = {
  admin: SupabaseClient;
  organizationId: string;
  agente: AgenteDeLaRed;
  ahora: Date;
};

export type ResultadoDelTurno = { resumen: string; uso: Record<string, number> };

export class ErrorDelMotor extends Error {}

// ---------------------------------------------------------------------------
// Contexto: lo que el agente lee antes de decidir
// ---------------------------------------------------------------------------

const recortar = (texto: string | null | undefined, max = LIMITE_TEXTO) => {
  const limpio = (texto ?? "").trim();
  return limpio.length > max ? `${limpio.slice(0, max)}\n[…recortado]` : limpio;
};

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function horaCorta(iso: string | null): string {
  if (!iso) return "—";
  const h = horaDeChile(new Date(iso));
  return `${String(h.dia).padStart(2, "0")}-${String(h.mes).padStart(2, "0")} ${String(h.hora).padStart(2, "0")}:${String(h.minuto).padStart(2, "0")}`;
}

type Nota = { id: string; tipo: string; agente_codigo: string | null; titulo: string; contenido: string; datos: Record<string, unknown>; created_at: string };
type Tarea = { id: string; de: string; para: string; titulo: string; detalle: string | null; estado: string; vence: string | null; resultado: string | null; created_at: string };

async function notas(turno: TurnoDelMotor, tipos: string[], limite: number, desdeDias?: number): Promise<Nota[]> {
  let consulta = turno.admin
    .from("orbita_notas")
    .select("id, tipo, agente_codigo, titulo, contenido, datos, created_at")
    .eq("organization_id", turno.organizationId)
    .in("tipo", tipos)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (desdeDias) consulta = consulta.gte("created_at", new Date(turno.ahora.getTime() - desdeDias * 86_400_000).toISOString());
  const { data, error } = await consulta;
  if (error) throw new ErrorDelMotor(`No se pudo leer la memoria (${tipos.join(", ")}): ${error.message}`);
  return (data ?? []) as Nota[];
}

async function equipo(turno: TurnoDelMotor): Promise<AgenteDeLaRed[]> {
  const { data, error } = await turno.admin
    .from("orbita_agentes")
    .select("codigo, nombre, persona, rol, horario, motor, activo, instrucciones, ultimo_estado, ultimo_resumen, ultimo_evento_at")
    .eq("organization_id", turno.organizationId)
    .order("codigo");
  if (error) throw new ErrorDelMotor(`No se pudo leer el equipo: ${error.message}`);
  return (data ?? []) as AgenteDeLaRed[];
}

const nombreDe = (agente: Pick<AgenteDeLaRed, "codigo" | "nombre" | "persona">) =>
  agente.persona ? `${agente.codigo} · ${agente.persona} (${agente.nombre})` : `${agente.codigo} · ${agente.nombre}`;

async function contextoComun(turno: TurnoDelMotor): Promise<{ texto: string; equipo: AgenteDeLaRed[]; tareas: Tarea[] }> {
  const [miembros, estrategia, reglas, prioridad, eventosR, tareasR] = await Promise.all([
    equipo(turno),
    notas(turno, ["estrategia"], 1),
    notas(turno, ["reglas"], 1),
    notas(turno, ["prioridad"], 1),
    turno.admin
      .from("orbita_eventos")
      .select("agente_codigo, tipo, estado, resumen, relacionado_con, ocurrido_at")
      .eq("organization_id", turno.organizationId)
      .neq("tipo", "pulso")
      .gte("ocurrido_at", new Date(turno.ahora.getTime() - 86_400_000).toISOString())
      .order("ocurrido_at", { ascending: false })
      .limit(80),
    turno.admin
      .from("orbita_tareas")
      .select("id, de, para, titulo, detalle, estado, vence, resultado, created_at")
      .eq("organization_id", turno.organizationId)
      .or(`estado.eq.pendiente,updated_at.gte.${new Date(turno.ahora.getTime() - 7 * 86_400_000).toISOString()}`)
      .order("created_at", { ascending: false })
      .limit(60),
  ]);
  if (eventosR.error) throw new ErrorDelMotor(`No se pudo leer la bitácora: ${eventosR.error.message}`);
  if (tareasR.error) throw new ErrorDelMotor(`No se pudo leer las tareas: ${tareasR.error.message}`);
  const tareas = (tareasR.data ?? []) as Tarea[];

  const h = horaDeChile(turno.ahora);
  const lineas: string[] = [];
  lineas.push(`## Hoy\n${DIAS[h.semana]} ${fechaDeChile(turno.ahora)}, ${String(h.hora).padStart(2, "0")}:${String(h.minuto).padStart(2, "0")} (hora de Chile).`);
  lineas.push(`## Prioridad de la semana\n${recortar(prioridad[0]?.contenido) || "Sin prioridad escrita todavía."}`);
  lineas.push(`## Estrategia vigente\n${recortar(estrategia[0]?.contenido) || "Sin estrategia cargada."}`);
  if (reglas[0]) lineas.push(`## Reglas y riesgos\n${recortar(reglas[0].contenido, 4000)}`);
  lineas.push(
    `## El equipo\n${miembros
      .map(
        (m) =>
          `- ${nombreDe(m)} · ${m.motor ? "nube de Atlas" : "equipo local"}${m.activo ? "" : " · PAUSADO"} · ${m.horario ?? "sin horario"} · estado ${m.ultimo_estado} (${horaCorta(m.ultimo_evento_at)})${m.ultimo_resumen ? ` · «${recortar(m.ultimo_resumen, 200)}»` : ""}${m.rol ? `\n  Rol: ${m.rol}` : ""}`,
      )
      .join("\n")}`,
  );
  const eventos = eventosR.data ?? [];
  lineas.push(
    `## Bitácora de las últimas 24 h (más nuevo primero)\n${
      eventos.length === 0
        ? "Sin eventos."
        : eventos
            .map((e) => `- ${horaCorta(e.ocurrido_at as string)} · ${e.agente_codigo} · ${e.tipo}${e.estado ? ` (${e.estado})` : ""}${e.relacionado_con ? ` → ${e.relacionado_con}` : ""}${e.resumen ? ` · ${recortar(e.resumen as string, 240)}` : ""}`)
            .join("\n")
    }`,
  );
  lineas.push(
    `## Tareas entre agentes (pendientes y cerradas en 7 días)\n${
      tareas.length === 0
        ? "Sin tareas."
        : tareas
            .map((t) => `- [${t.estado}] ${t.de} → ${t.para} · ${t.titulo}${t.vence ? ` · vence ${t.vence}` : ""}${t.detalle ? `\n  ${recortar(t.detalle, 400)}` : ""}${t.resultado ? `\n  Resultado: ${recortar(t.resultado, 300)}` : ""}`)
            .join("\n")
    }`,
  );
  return { texto: lineas.join("\n\n"), equipo: miembros, tareas };
}

// ---------------------------------------------------------------------------
// Llamada a Claude con salida validada
// ---------------------------------------------------------------------------

const MARCO_COMUN = `Eres un agente de marketing con IA de Atlas Órbita, un equipo de agentes que trabaja solo para una empresa. Corres dentro de Atlas, en la nube, una vez por turno: lees la memoria compartida que te entregan, decides y respondes en el formato pedido. Lo que respondas se guarda tal cual en la memoria y en la red del equipo, a la vista de la empresa.

Reglas para todos:
- Escribe en español de Chile, claro y concreto. Frases cortas.
- No inventes datos ni métricas. Si algo no está en lo que te entregan, dilo ("sin dato") y di cómo conseguirlo.
- Respeta la estrategia, las reglas y lo prohibido de la empresa (por ejemplo, precios que no se publican).
- Para encargar trabajo a otro agente usa su código ("0", "1", "9"…), tal como aparece en "El equipo".
- Las tareas tienen que poder cumplirse con lo que ese agente hace según su rol.
- Si tu ficha menciona archivos, carpetas o comandos (por ejemplo "escribe en reportes/…" o "python3 …"), son de cuando el equipo corría en un computador: ignóralos. Tu memoria es la que te entregan acá y lo que respondes se guarda solo.`;

async function pedir<T extends z.ZodType>(
  sistema: string,
  ficha: string | null,
  contexto: string,
  esquema: T,
  effort: "low" | "medium" | "high",
): Promise<{ salida: z.infer<T>; uso: Record<string, number> }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new ErrorDelMotor("Falta ANTHROPIC_API_KEY: los agentes de la nube no pueden pensar");
  const client = new Anthropic({ apiKey, timeout: 240_000, maxRetries: 2 });
  const respuesta = await client.beta.messages.parse({
    model: MODELO(),
    max_tokens: 16000,
    // Si el modelo declina por una política, la API reintenta con el respaldo que corresponda.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: betaZodOutputFormat(esquema) },
    system: [
      { type: "text", text: `${MARCO_COMUN}\n\n${sistema}` },
      { type: "text", text: `## Tu ficha (la definió la empresa)\n${ficha?.trim() || "Sin ficha: sigue tu rol y la estrategia."}`, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: contexto }],
  });
  if (respuesta.stop_reason === "refusal") throw new ErrorDelMotor("El modelo declinó el turno");
  if (respuesta.stop_reason === "max_tokens") throw new ErrorDelMotor("La respuesta quedó cortada (max_tokens)");
  if (!respuesta.parsed_output) throw new ErrorDelMotor("La respuesta no vino en el formato pedido");
  return {
    salida: respuesta.parsed_output as z.infer<T>,
    uso: { input_tokens: respuesta.usage.input_tokens, output_tokens: respuesta.usage.output_tokens },
  };
}

const sumarUso = (a: Record<string, number>, b: Record<string, number>) => {
  const total = { ...a };
  for (const [clave, valor] of Object.entries(b)) total[clave] = (total[clave] ?? 0) + valor;
  return total;
};

// ---------------------------------------------------------------------------
// Guardar
// ---------------------------------------------------------------------------

async function guardarNotas(turno: TurnoDelMotor, filas: Omit<Nota, "id" | "created_at" | "agente_codigo">[]) {
  if (filas.length === 0) return;
  const { error } = await turno.admin
    .from("orbita_notas")
    .insert(filas.map((fila) => ({ ...fila, organization_id: turno.organizationId, agente_codigo: turno.agente.codigo })));
  if (error) throw new ErrorDelMotor(`No se pudo guardar en la memoria: ${error.message}`);
}

async function guardarTareas(turno: TurnoDelMotor, filas: { para: string; titulo: string; detalle: string | null; vence: string | null; origen: string | null }[]) {
  if (filas.length === 0) return;
  const { error } = await turno.admin
    .from("orbita_tareas")
    .insert(filas.map((fila) => ({ ...fila, organization_id: turno.organizationId, de: turno.agente.codigo })));
  if (error) throw new ErrorDelMotor(`No se pudieron guardar las tareas: ${error.message}`);
}

async function eventos(turno: TurnoDelMotor, lista: EventoAGuardar[]) {
  if (lista.length === 0) return;
  const { error } = await registrarEventos(turno.admin, turno.organizationId, lista);
  if (error) throw new ErrorDelMotor(error);
}

/** Solo códigos del equipo y nunca a sí mismo. */
const destinoValido = (equipoActual: AgenteDeLaRed[], yo: string) => {
  const codigos = new Set(equipoActual.map((m) => m.codigo));
  return (codigo: string | null | undefined): string | null => {
    const limpio = (codigo ?? "").trim().toUpperCase();
    return limpio && limpio !== yo && codigos.has(limpio) ? limpio : null;
  };
};

const fechaValida = (texto: string | null | undefined) => (texto && /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null);

// ---------------------------------------------------------------------------
// CEO de marketing (0)
// ---------------------------------------------------------------------------

const EsquemaCeo = z.object({
  urgente: z.string().nullable().describe("Lo urgente en una línea, o null si no hay"),
  resumen: z.string().describe("Resumen del día en 6 líneas como máximo: urgente, 3 decisiones, tareas, escalamientos y estado frente a las metas"),
  decisiones: z
    .array(
      z.object({
        titulo: z.string(),
        porque: z.string().describe("El dato que la justifica"),
        para: z.string().nullable().describe("Código del agente al que afecta, o null"),
        como_se_mide: z.string(),
      }),
    )
    .describe("Las decisiones del día (máximo 5)"),
  tareas: z
    .array(
      z.object({
        para: z.string().describe("Código del agente que la cumple"),
        titulo: z.string(),
        detalle: z.string().describe("Qué hacer exactamente; para Reels: gancho, guion de 3 líneas, producto, fecha y hora objetivo"),
        vence: z.string().nullable().describe("AAAA-MM-DD o null"),
      }),
    )
    .describe("Tareas nuevas (no repitas las que ya están pendientes)"),
  ideas: z
    .array(z.object({ id: z.string(), decision: z.enum(["aprobada", "rechazada"]), motivo: z.string() }))
    .describe("Decisión sobre ideas nuevas del tablero, por su id (aprueba hasta 3 por semana)"),
  prioridad_semana: z.string().nullable().describe("Nueva prioridad de la semana (máximo 3 líneas). Los lunes es obligatoria; otros días solo si hay que cambiarla; si no, null"),
  escalamientos: z
    .array(z.object({ que: z.string(), recomendacion: z.string(), plazo: z.string() }))
    .describe("Solo lo que una IA no puede decidir: dinero, precios u ofertas nuevas, legal, seguridad de cuentas, identidad de marca, o algo a nombre personal del dueño"),
});

const SISTEMA_CEO = `Tu cargo: CEO de Marketing (agente 0). Eres el dueño del objetivo de marketing de la empresa. Decides en lugar del dueño: apruebas o rechazas, asignas trabajo, fijas prioridades y respondes por los resultados. No publicas ni produces: decides, asignas y verificas que se cumpla.

Cada día:
1. Revisa la bitácora, el último informe del Líder de resultados, la última inteligencia y las tareas.
2. Decide con datos, no con opiniones: ideas nuevas del tablero (aprueba hasta 3 por semana y rechaza el resto con motivo), alertas del Líder (responde con una acción concreta y un dueño) y agentes que fallan seguido (simplificar o pausar).
3. Asigna tareas concretas al agente que corresponde. No dupliques tareas pendientes.
4. Los lunes, además: aprueba o rechaza cada propuesta de la retrospectiva del domingo y escribe la prioridad de la semana.

Se escala al dueño SOLO lo indelegable (dinero, precios u ofertas nuevas, legal, seguridad de cuentas, identidad de marca, algo a nombre personal del dueño), con tu recomendación y plazo. Lo demás lo decides tú.`;

async function turnoCeo(turno: TurnoDelMotor): Promise<ResultadoDelTurno> {
  const comun = await contextoComun(turno);
  const [reportes, inteligencia, ideas, decisiones, escalamientos] = await Promise.all([
    notas(turno, ["reporte", "retrospectiva"], 2),
    notas(turno, ["inteligencia"], 1),
    notas(turno, ["idea"], 40, 60),
    notas(turno, ["decision"], 15, 7),
    notas(turno, ["escalamiento"], 10, 7),
  ]);
  const ideasNuevas = ideas.filter((idea) => (idea.datos?.estado ?? "nueva") === "nueva");
  const esLunes = diaDeLaSemana(turno.ahora) === 1;

  const contexto = [
    comun.texto,
    `## Últimos informes del Líder de resultados\n${reportes.map((r) => `### ${r.titulo} (${horaCorta(r.created_at)})\n${recortar(r.contenido, 5000)}`).join("\n\n") || "Sin informes todavía."}`,
    `## Última inteligencia (competencia y viral)\n${inteligencia[0] ? `### ${inteligencia[0].titulo}\n${recortar(inteligencia[0].contenido, 5000)}` : "Sin inteligencia todavía."}`,
    `## Ideas nuevas del tablero (decide por id)\n${ideasNuevas.map((i) => `- id ${i.id} · ${i.titulo}${i.datos?.puntaje ? ` · puntaje ${i.datos.puntaje}` : ""}\n  ${recortar(JSON.stringify(i.datos), 600)}`).join("\n") || "Sin ideas nuevas."}`,
    `## Ideas aprobadas en los últimos 7 días\n${ideas.filter((i) => i.datos?.estado === "aprobada" && Date.parse(String(i.datos?.decidida_at ?? i.created_at)) > turno.ahora.getTime() - 7 * 86_400_000).map((i) => `- ${i.titulo}`).join("\n") || "Ninguna."}`,
    `## Tus decisiones de los últimos 7 días\n${decisiones.map((d) => `- ${horaCorta(d.created_at)} · ${d.titulo}`).join("\n") || "Ninguna."}`,
    `## Escalamientos de los últimos 7 días\n${escalamientos.map((e) => `- ${horaCorta(e.created_at)} · ${e.titulo}`).join("\n") || "Ninguno."}`,
    esLunes ? "Hoy es lunes: además de lo diario, aprueba o rechaza las propuestas de la retrospectiva y escribe la prioridad de la semana." : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const { salida, uso } = await pedir(SISTEMA_CEO, turno.agente.instrucciones, contexto, EsquemaCeo, "high");
  const destino = destinoValido(comun.equipo, turno.agente.codigo);
  const hoy = fechaDeChile(turno.ahora);

  const tareas = salida.tareas
    .map((t) => ({ para: destino(t.para), titulo: t.titulo.trim(), detalle: t.detalle?.trim() || null, vence: fechaValida(t.vence), origen: `Decisión del CEO ${hoy}` }))
    .filter((t): t is typeof t & { para: string } => Boolean(t.para && t.titulo));

  await guardarNotas(turno, [
    ...salida.decisiones.map((d) => ({
      tipo: "decision",
      titulo: d.titulo,
      contenido: `Por qué: ${d.porque}\nCómo se mide: ${d.como_se_mide}`,
      datos: { para: destino(d.para), fecha: hoy },
    })),
    ...(salida.prioridad_semana?.trim() ? [{ tipo: "prioridad", titulo: `Prioridad de la semana (${hoy})`, contenido: salida.prioridad_semana.trim(), datos: {} }] : []),
    ...salida.escalamientos.map((e) => ({
      tipo: "escalamiento",
      titulo: e.que,
      contenido: `Recomendación: ${e.recomendacion}\nPlazo: ${e.plazo}`,
      datos: { estado: "abierto" },
    })),
  ]);
  await guardarTareas(turno, tareas);

  // Las ideas decididas cambian de estado en el tablero.
  const porId = new Map(ideasNuevas.map((idea) => [idea.id, idea]));
  for (const decision of salida.ideas) {
    const idea = porId.get(decision.id);
    if (!idea) continue;
    const { error } = await turno.admin
      .from("orbita_notas")
      .update({ datos: { ...idea.datos, estado: decision.decision, motivo: decision.motivo, decidida_at: turno.ahora.toISOString() } })
      .eq("id", idea.id)
      .eq("organization_id", turno.organizationId);
    if (error) throw new ErrorDelMotor(`No se pudo decidir la idea ${idea.titulo}: ${error.message}`);
  }

  await eventos(turno, [
    ...salida.decisiones
      .filter((d) => destino(d.para))
      .map((d) => ({ agente: turno.agente.codigo, tipo: "decision" as const, resumen: d.titulo, relacionado_con: destino(d.para) })),
    ...tareas.map((t) => ({ agente: turno.agente.codigo, tipo: "tarea" as const, resumen: t.titulo, relacionado_con: t.para })),
    ...salida.escalamientos.map((e) => ({ agente: turno.agente.codigo, tipo: "alerta" as const, resumen: `Para el dueño: ${e.que}`, detalle: { escalamiento: true } })),
  ]);

  const aprobadas = salida.ideas.filter((i) => i.decision === "aprobada" && porId.has(i.id)).length;
  const resumen = [
    salida.urgente ? `URGENTE: ${salida.urgente}` : null,
    `${salida.decisiones.length} decisiones, ${tareas.length} tareas, ${aprobadas} ideas aprobadas, ${salida.escalamientos.length} escalamientos`,
  ]
    .filter(Boolean)
    .join(" · ");
  return { resumen: recortar(`${resumen}\n${salida.resumen}`, 1000), uso };
}

// ---------------------------------------------------------------------------
// Líder de resultados (7)
// ---------------------------------------------------------------------------

const EsquemaLider = z.object({
  urgente: z.string().nullable().describe("Lo urgente en una línea (restricción de Meta, anuncio que gasta sin resultados), o null"),
  resumen: z.string().describe("Resumen en 8 líneas como máximo"),
  informe: z.string().describe("Informe en Markdown: lo que pasó, la mejor y la peor pieza, alertas; los domingos, la retrospectiva completa"),
  propuestas: z
    .array(z.object({ titulo: z.string(), detalle: z.string() }))
    .describe("Propuestas para que el CEO apruebe o rechace (Reels, experimentos, ajustes). Nunca precios."),
  sin_datos: z.array(z.string()).describe("Datos que faltaron y cómo conseguirlos"),
});

const SISTEMA_LIDER = `Tu cargo: Líder de resultados (agente 7). Mides, haces la retrospectiva y propones mejoras al CEO (agente 0). No publicas nada.

Cada noche: con las piezas y métricas que te entregan (las que llegan al calendario de Marketing de Atlas) y la bitácora del equipo, escribe el informe del día: lo que pasó, la mejor y la peor pieza, y alertas (Reel con retención a 3 s bajo 20 %, post de grupo con 0 interacciones a las 48 h, anuncio con costo por conversación sobre 2 veces el mejor, grupo que borró un post, agentes que fallan).

Los domingos escribe la retrospectiva semanal: tablero de la semana frente a la anterior, ranking de piezas (top 3 y bottom 3 con el porqué), diagnóstico, empezar/dejar/seguir, hasta 3 experimentos (hipótesis, cambio, métrica, umbral) y propuestas para el CEO (Reels de la semana con gancho y guion de 3 líneas, presupuesto, ajustes). Nunca propongas precios.

Si una métrica no está, escribe "sin dato" y di cómo conseguirla. No inventes.`;

async function turnoLider(turno: TurnoDelMotor): Promise<ResultadoDelTurno> {
  const comun = await contextoComun(turno);
  const esDomingo = diaDeLaSemana(turno.ahora) === 0;
  const desde = new Date(turno.ahora.getTime() - (esDomingo ? 14 : 7) * 86_400_000).toISOString();
  const [piezasR, reportes, inteligencia, ideas] = await Promise.all([
    turno.admin
      .from("marketing_items")
      .select("title, channel, format, status, agent, product, target, scheduled_at, published_at, metrics, external_url")
      .eq("organization_id", turno.organizationId)
      .or(`scheduled_at.gte.${desde},published_at.gte.${desde},updated_at.gte.${desde}`)
      .order("scheduled_at", { ascending: false, nullsFirst: false })
      .limit(250),
    notas(turno, ["reporte", "retrospectiva"], 3),
    notas(turno, ["inteligencia"], 1),
    notas(turno, ["idea"], 30, 30),
  ]);
  if (piezasR.error) throw new ErrorDelMotor(`No se pudo leer el calendario de Marketing: ${piezasR.error.message}`);
  const piezas = piezasR.data ?? [];

  const porEstado = new Map<string, number>();
  for (const p of piezas) porEstado.set(`${p.channel}/${p.status}`, (porEstado.get(`${p.channel}/${p.status}`) ?? 0) + 1);
  const conMetricas = piezas.filter((p) => p.metrics && Object.keys(p.metrics as object).length > 0);

  const contexto = [
    comun.texto,
    `## Calendario de Marketing (${esDomingo ? "14" : "7"} días): conteo por canal y estado\n${[...porEstado].map(([k, v]) => `- ${k}: ${v}`).join("\n") || "Sin piezas."}`,
    `## Piezas con métricas (${conMetricas.length})\n${conMetricas.map((p) => `- ${horaCorta((p.published_at ?? p.scheduled_at) as string | null)} · ${p.channel}/${p.format} · ${recortar(p.title as string, 120)} · agente ${p.agent ?? "—"} · ${JSON.stringify(p.metrics)}`).join("\n") || "Ninguna pieza trae métricas todavía."}`,
    `## Piezas sin métricas (muestra)\n${piezas.filter((p) => !conMetricas.includes(p)).slice(0, 60).map((p) => `- ${horaCorta((p.published_at ?? p.scheduled_at) as string | null)} · ${p.channel}/${p.format} · ${p.status} · ${recortar(p.title as string, 100)} · agente ${p.agent ?? "—"}`).join("\n") || "—"}`,
    `## Tus últimos informes\n${reportes.map((r) => `### ${r.titulo}\n${recortar(r.contenido, 3500)}`).join("\n\n") || "Ninguno todavía."}`,
    `## Última inteligencia\n${inteligencia[0] ? recortar(inteligencia[0].contenido, 3500) : "Ninguna."}`,
    `## Tablero de ideas (30 días)\n${ideas.map((i) => `- [${i.datos?.estado ?? "nueva"}] ${i.titulo}${i.datos?.puntaje ? ` · puntaje ${i.datos.puntaje}` : ""}`).join("\n") || "Vacío."}`,
    esDomingo ? "Hoy es domingo: escribe la retrospectiva semanal completa." : "Hoy toca el informe diario (10 líneas como máximo en el informe).",
  ].join("\n\n");

  const { salida, uso } = await pedir(SISTEMA_LIDER, turno.agente.instrucciones, contexto, EsquemaLider, "medium");
  const hoy = fechaDeChile(turno.ahora);
  const ceo = comun.equipo.some((m) => m.codigo === "0") ? "0" : null;

  await guardarNotas(turno, [
    {
      tipo: esDomingo ? "retrospectiva" : "reporte",
      titulo: esDomingo ? `Retrospectiva semanal (${hoy})` : `Informe diario (${hoy})`,
      contenido: [salida.urgente ? `**Urgente:** ${salida.urgente}` : null, salida.informe, salida.sin_datos.length ? `### Sin dato\n${salida.sin_datos.map((s) => `- ${s}`).join("\n")}` : null]
        .filter(Boolean)
        .join("\n\n"),
      datos: { resumen: salida.resumen, urgente: salida.urgente },
    },
  ]);
  if (ceo) {
    await guardarTareas(
      turno,
      salida.propuestas.map((p) => ({ para: ceo, titulo: `Aprobar o rechazar: ${p.titulo}`, detalle: p.detalle, vence: null, origen: `Propuesta del Líder ${hoy}` })),
    );
  }
  await eventos(turno, [
    ...(salida.urgente && ceo ? [{ agente: turno.agente.codigo, tipo: "alerta" as const, resumen: salida.urgente, relacionado_con: ceo }] : []),
  ]);

  return { resumen: recortar(`${salida.urgente ? `URGENTE: ${salida.urgente} · ` : ""}${salida.propuestas.length} propuestas al CEO\n${salida.resumen}`, 1000), uso };
}

// ---------------------------------------------------------------------------
// Inteligencia competitiva y viral (8)
// ---------------------------------------------------------------------------

const EsquemaInteligencia = z.object({
  resumen: z.string().describe("5 líneas como máximo: lo más viral y por qué, el movimiento clave de la competencia y la mejor idea con su gancho"),
  informe: z.string().describe("Informe en Markdown: top 3 de lo viral (enlace, métrica visible, por qué funcionó), movimientos de la competencia y huecos"),
  ideas: z
    .array(
      z.object({
        titulo: z.string(),
        gancho: z.string().describe("Texto exacto de los primeros 2 segundos"),
        formato: z.string(),
        guion: z.string().describe("Guion de 3 líneas"),
        producto: z.string(),
        canal: z.string(),
        por_que: z.string().describe("Por qué podría viralizar, con evidencia"),
        evidencia: z.array(z.string()).describe("Enlaces que la respaldan"),
        puntaje: z.number().int().min(1).max(5),
      }),
    )
    .describe("3 ideas adaptadas a la empresa (no copiadas), sin repetir las del tablero"),
});

const SISTEMA_INTELIGENCIA = `Tu cargo: Inteligencia competitiva y viral (agente 8). Antes de que empiece la jornada investigas a la competencia y lo que se está volviendo viral en el nicho, y dejas ideas con evidencia para el CEO y el Líder.

Se adapta, no se copia: nunca reutilices textos, videos, música con derechos, marcas ni caras de otros; toma la estructura (gancho, ritmo, formato) y crea algo propio. Solo observas: no sigues, comentas ni escribes a nadie. No inventes métricas: si no se ven, escribe "no visible". Nunca propongas precios que la empresa no publica.`;

async function turnoInteligencia(turno: TurnoDelMotor): Promise<ResultadoDelTurno> {
  const comun = await contextoComun(turno);
  const [competidores, ideas, previas] = await Promise.all([notas(turno, ["competidores"], 1), notas(turno, ["idea"], 80, 60), notas(turno, ["inteligencia"], 2)]);
  const esSabado = diaDeLaSemana(turno.ahora) === 6;

  const contexto = [
    comun.texto,
    `## Competidores y referentes\n${recortar(competidores[0]?.contenido) || "Sin lista: identifica 4 o 5 competidores directos de la empresa en su mercado."}`,
    `## Ideas ya en el tablero (no las repitas)\n${ideas.map((i) => `- ${i.titulo}`).join("\n") || "Vacío."}`,
    `## Tus últimos informes\n${previas.map((p) => `### ${p.titulo}\n${recortar(p.contenido, 2500)}`).join("\n\n") || "Ninguno."}`,
    esSabado ? "Hoy es sábado: revisión profunda de cada competidor (frecuencia, formatos, engagement aproximado, ofertas, mensajes, lo que hacen mejor, el hueco que podemos tomar) y cierra con un Top 5 de ideas de la semana." : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // Paso 1: investigar en la web (texto libre con fuentes).
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new ErrorDelMotor("Falta ANTHROPIC_API_KEY: los agentes de la nube no pueden pensar");
  const client = new Anthropic({ apiKey, timeout: 240_000, maxRetries: 2 });
  const mensajes: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `${contexto}\n\nInvestiga ahora en la web (publicaciones de los últimos 7 días): la competencia de la lista y lo viral del nicho de la empresa en su país. Anota lo que encuentres con enlace y métrica visible. Termina con tus notas de investigación; el formato final te lo pido después.`,
    },
  ];
  let uso: Record<string, number> = {};
  let investigacion = "";
  for (let vuelta = 0; vuelta < 4; vuelta += 1) {
    const respuesta = await client.beta.messages.create({
      model: MODELO(),
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: [
        { type: "text", text: `${MARCO_COMUN}\n\n${SISTEMA_INTELIGENCIA}` },
        { type: "text", text: `## Tu ficha (la definió la empresa)\n${turno.agente.instrucciones?.trim() || "Sin ficha: sigue tu rol y la estrategia."}`, cache_control: { type: "ephemeral" } },
      ],
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
      messages: mensajes,
    });
    uso = sumarUso(uso, { input_tokens: respuesta.usage.input_tokens, output_tokens: respuesta.usage.output_tokens });
    if (respuesta.stop_reason === "refusal") throw new ErrorDelMotor("El modelo declinó la investigación");
    mensajes.push({ role: "assistant", content: respuesta.content });
    if (respuesta.stop_reason === "pause_turn") continue;
    investigacion = respuesta.content
      .flatMap((bloque) => (bloque.type === "text" ? [bloque.text] : []))
      .join("\n")
      .trim();
    break;
  }
  if (!investigacion) throw new ErrorDelMotor("La investigación no dejó notas");

  // Paso 2: ordenar lo investigado en el formato fijo.
  const { salida, uso: usoFormato } = await pedir(
    SISTEMA_INTELIGENCIA,
    turno.agente.instrucciones,
    `${contexto}\n\n## Tus notas de investigación de hoy\n${recortar(investigacion, 30000)}\n\nCon esas notas, entrega el informe y 3 ideas adaptadas a la empresa.`,
    EsquemaInteligencia,
    "low",
  );
  uso = sumarUso(uso, usoFormato);

  const hoy = fechaDeChile(turno.ahora);
  const yaEstan = new Set(ideas.map((i) => i.titulo.trim().toLowerCase()));
  const nuevas = salida.ideas.filter((idea) => !yaEstan.has(idea.titulo.trim().toLowerCase()));
  await guardarNotas(turno, [
    { tipo: "inteligencia", titulo: `${esSabado ? "Revisión profunda" : "Inteligencia"} (${hoy})`, contenido: salida.informe, datos: { resumen: salida.resumen } },
    ...nuevas.map((idea) => ({
      tipo: "idea",
      titulo: idea.titulo,
      contenido: `Gancho: ${idea.gancho}\nFormato: ${idea.formato}\nGuion:\n${idea.guion}\nProducto: ${idea.producto}\nCanal: ${idea.canal}\nPor qué: ${idea.por_que}`,
      datos: { estado: "nueva", gancho: idea.gancho, formato: idea.formato, guion: idea.guion, producto: idea.producto, canal: idea.canal, por_que: idea.por_que, evidencia: idea.evidencia, puntaje: idea.puntaje, fecha: hoy },
    })),
  ]);

  return { resumen: recortar(`${nuevas.length} ideas nuevas\n${salida.resumen}`, 1000), uso };
}

// ---------------------------------------------------------------------------

const DESTINO_DEL_FIN: Record<MotorConTurno, string> = { ceo: "", lider: "0", inteligencia: "0" };

export async function correrTurno(motor: MotorConTurno, turno: TurnoDelMotor): Promise<ResultadoDelTurno & { destino: string | null }> {
  const resultado = motor === "ceo" ? await turnoCeo(turno) : motor === "lider" ? await turnoLider(turno) : await turnoInteligencia(turno);
  return { ...resultado, destino: DESTINO_DEL_FIN[motor] || null };
}
