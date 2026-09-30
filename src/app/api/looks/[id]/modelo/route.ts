import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getCurrentProfile } from "@/lib/auth";
import { ErrorDeIA, consultarModelo3D, modeloDe3D, pedirModelo3D, type SolicitudModelo3D } from "@/lib/ia/look.server";
import { VISTAS_LOOK } from "@/lib/look";
import { TOPE_MODELOS_DIARIO } from "@/lib/look-ia";
import { BUCKET_LOOKS, UUID, firmar, leerLook, registrarUso, usoDeHoy, type LookBase } from "@/lib/looks.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/*
 * El 3D de un look. Sin propuesta: el cliente tal como llegó, desde su foto de
 * frente (y de perfil si hay). Con propuesta: el cliente con ese corte, desde
 * las vistas simuladas. Se pide a una cola y se consulta hasta que esté.
 */

type Objetivo = {
  tabla: "looks" | "look_propuestas";
  id: string;
  estado: string | null;
  path: string | null;
  solicitud: SolicitudModelo3D | null;
  rutas: string[];
  descripcion: string;
};

async function leerObjetivo(supabase: SupabaseClient, look: LookBase, propuestaId: string | null): Promise<Objetivo | null> {
  if (!propuestaId) {
    const { data } = await supabase.from("looks").select("modelo_estado, modelo_path, modelo_solicitud").eq("id", look.id).maybeSingle();
    if (!data) return null;
    return {
      tabla: "looks",
      id: look.id,
      estado: data.modelo_estado as string | null,
      path: data.modelo_path as string | null,
      solicitud: data.modelo_solicitud as SolicitudModelo3D | null,
      rutas: [look.foto_path, look.foto_perfil_path].filter((ruta): ruta is string => Boolean(ruta)),
      descripcion: "keep the current hair and beard exactly as in the photos",
    };
  }
  if (!UUID.test(propuestaId)) return null;
  const { data } = await supabase
    .from("look_propuestas")
    .select("id, descripcion_visual, vistas, modelo_estado, modelo_path, modelo_solicitud")
    .eq("id", propuestaId)
    .eq("look_id", look.id)
    .maybeSingle();
  if (!data) return null;
  const vistas = (data.vistas ?? {}) as Record<string, string>;
  return {
    tabla: "look_propuestas",
    id: data.id as string,
    estado: data.modelo_estado as string | null,
    path: data.modelo_path as string | null,
    solicitud: data.modelo_solicitud as SolicitudModelo3D | null,
    rutas: VISTAS_LOOK.map((vista) => vistas[vista]).filter((ruta): ruta is string => Boolean(ruta)),
    descripcion: data.descripcion_visual as string,
  };
}

async function contexto(id: string, propuestaId: string | null) {
  const supabase = await createClient();
  const look = await leerLook(supabase, id);
  if (!look) return null;
  const objetivo = await leerObjetivo(supabase, look, propuestaId);
  return objetivo ? { supabase, look, objetivo } : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentProfile())) return NextResponse.json({ error: "Inicia sesión otra vez." }, { status: 401 });
  const { id } = await params;
  const cuerpo = (await request.json().catch(() => ({}))) as { propuesta?: string };
  const leido = await contexto(id, cuerpo.propuesta ?? null);
  if (!leido) return NextResponse.json({ error: "No encontramos ese look." }, { status: 404 });
  const { supabase, look, objetivo } = leido;
  if (objetivo.estado === "generando" || objetivo.estado === "listo") return NextResponse.json({ estado: objetivo.estado });
  if (objetivo.rutas.length === 0) return NextResponse.json({ error: objetivo.tabla === "looks" ? "Falta la foto del cliente." : "Primero simula el corte en fotos." }, { status: 409 });

  const admin = createAdminClient();
  if ((await usoDeHoy(admin, look.organization_id, "modelo3d")) >= TOPE_MODELOS_DIARIO) {
    return NextResponse.json({ error: "Se alcanzó el tope de modelos 3D de hoy. Mañana se renueva." }, { status: 429 });
  }
  try {
    // El servicio descarga las imágenes desde enlaces firmados que vencen en dos horas.
    const enlaces = await firmar(supabase, objetivo.rutas, 2 * 60 * 60);
    const solicitud = await pedirModelo3D(
      objetivo.rutas.map((ruta) => enlaces.get(ruta)).filter((url): url is string => Boolean(url)),
      objetivo.descripcion,
    );
    const { error } = await supabase
      .from(objetivo.tabla)
      .update({ modelo_estado: "generando", modelo_solicitud: solicitud, modelo_path: null, modelo_at: new Date().toISOString() })
      .eq("id", objetivo.id);
    if (error) throw new Error("No se pudo anotar el pedido del 3D.");
    await registrarUso(admin, { organization_id: look.organization_id, look_id: look.id, tipo: "modelo3d", proveedor: "fal", modelo: solicitud.modelo, ok: true, detalle: { request_id: solicitud.request_id, de: objetivo.tabla } });
    return NextResponse.json({ estado: "generando" });
  } catch (error) {
    await registrarUso(admin, { organization_id: look.organization_id, look_id: look.id, tipo: "modelo3d", proveedor: "fal", modelo: modeloDe3D(), ok: false, detalle: { codigo: error instanceof ErrorDeIA ? error.codigo : "interno" } });
    const status = error instanceof ErrorDeIA && error.codigo === "sin_clave" ? 503 : 422;
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo pedir el 3D." }, { status });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentProfile())) return NextResponse.json({ error: "Inicia sesión otra vez." }, { status: 401 });
  const { id } = await params;
  const leido = await contexto(id, new URL(request.url).searchParams.get("propuesta"));
  if (!leido) return NextResponse.json({ error: "No encontramos ese look." }, { status: 404 });
  const { supabase, look, objetivo } = leido;

  if (objetivo.estado === "listo" && objetivo.path) {
    const enlaces = await firmar(supabase, [objetivo.path]);
    return NextResponse.json({ estado: "listo", url: enlaces.get(objetivo.path) ?? null });
  }
  if (objetivo.estado !== "generando" || !objetivo.solicitud) return NextResponse.json({ estado: objetivo.estado ?? null });

  try {
    const resultado = await consultarModelo3D(objetivo.solicitud);
    if (resultado.estado === "generando") return NextResponse.json({ estado: "generando", posicion: resultado.posicion });
    if (resultado.estado === "fallido") {
      await supabase.from(objetivo.tabla).update({ modelo_estado: "fallido" }).eq("id", objetivo.id);
      return NextResponse.json({ estado: "fallido", error: resultado.motivo });
    }
    const ruta = `${look.organization_id}/${look.cuenta_id}/${look.id}/${objetivo.tabla === "looks" ? "cliente" : objetivo.id}-3d-${Date.now()}.glb`;
    const { error: subida } = await createAdminClient().storage.from(BUCKET_LOOKS).upload(ruta, resultado.glb, { contentType: "model/gltf-binary", upsert: false });
    if (subida) throw new Error("No se pudo guardar el 3D.");
    await supabase.from(objetivo.tabla).update({ modelo_estado: "listo", modelo_path: ruta }).eq("id", objetivo.id);
    const enlaces = await firmar(supabase, [ruta]);
    return NextResponse.json({ estado: "listo", url: enlaces.get(ruta) ?? null });
  } catch {
    console.error("look_modelo_fallido");
    return NextResponse.json({ estado: "generando" });
  }
}
