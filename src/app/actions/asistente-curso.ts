"use server";

import { requireProfile } from "@/lib/auth";
import { leerCursoAprende, preguntarAlCurso, type RespuestaAsistente, type Turno } from "@/lib/asistente-curso";
import { createClient } from "@/lib/supabase/server";

export type ResultadoAsistente =
  | ({ ok: true } & RespuestaAsistente)
  | { ok: false; message: string };

/**
 * Pregunta del ejecutivo al asistente de su campaña. Solo campañas con curso
 * en Aprende (campaigns.curso_aprende), y solo quien trabaja en ella
 * (o supervisión y administración de la empresa).
 */
export async function preguntarAsistenteCurso(campaignId: string, historial: Turno[], pregunta: string): Promise<ResultadoAsistente> {
  const profile = await requireProfile(["agente", "supervisor", "admin"]);
  const texto = pregunta.trim();
  if (!texto) return { ok: false, message: "Escribe tu pregunta." };
  if (texto.length > 600) return { ok: false, message: "La pregunta es muy larga. Resúmela en unas líneas." };

  const supabase = await createClient();
  const [{ data: campana }, { data: miembro }] = await Promise.all([
    supabase.from("campaigns").select("curso_aprende, is_active").eq("id", campaignId).maybeSingle(),
    supabase.from("campaign_agents").select("id").eq("campaign_id", campaignId).eq("profile_id", profile.id).maybeSingle(),
  ]);
  const slug = campana?.is_active ? campana.curso_aprende : null;
  if (!slug) return { ok: false, message: "Esta campaña no tiene un curso asociado." };
  if (profile.role === "agente" && !miembro) return { ok: false, message: "No perteneces a esta campaña." };

  const turnos = (Array.isArray(historial) ? historial : [])
    .filter((turno): turno is Turno => (turno?.rol === "ejecutivo" || turno?.rol === "asistente") && typeof turno.texto === "string")
    .slice(-6);

  try {
    const curso = await leerCursoAprende(slug);
    const respuesta = await preguntarAlCurso(curso, turnos, texto);
    return { ok: true, ...respuesta };
  } catch (error) {
    console.error("[asistente-curso]", error instanceof Error ? error.message : error);
    return { ok: false, message: "El asistente no respondió. Inténtalo de nuevo en unos segundos." };
  }
}
