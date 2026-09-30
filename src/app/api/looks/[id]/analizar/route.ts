import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/auth";
import { ErrorDeIA, analizarFotos, modeloDeAnalisis } from "@/lib/ia/look.server";
import { TOPE_ANALISIS_DIARIO, normalizarRespuesta } from "@/lib/look-ia";
import { descargarFoto, leerLook, registrarUso, usoDeHoy } from "@/lib/looks.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Analiza la foto de un look con IA: facciones, pelo, barba y 3 a 4
 * propuestas con su mapa de corte. El acceso lo decide la base: el look se
 * lee con la sesión de quien pide; la clave de servicio solo anota el uso.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Inicia sesión otra vez." }, { status: 401 });
  const { id } = await params;
  const supabase = await createClient();
  const look = await leerLook(supabase, id);
  if (!look) return NextResponse.json({ error: "No encontramos ese look." }, { status: 404 });
  if (!look.foto_path) return NextResponse.json({ error: "Falta la foto de frente." }, { status: 409 });

  const admin = createAdminClient();
  if ((await usoDeHoy(admin, look.organization_id, "analisis")) >= TOPE_ANALISIS_DIARIO) {
    return NextResponse.json({ error: "Se alcanzó el tope de análisis de hoy. Mañana se renueva; mientras, sigue sin IA." }, { status: 429 });
  }

  try {
    const [frontal, perfil] = await Promise.all([
      descargarFoto(supabase, look.foto_path),
      look.foto_perfil_path ? descargarFoto(supabase, look.foto_perfil_path) : Promise.resolve(null),
    ]);
    const { respuesta, modelo, uso } = await analizarFotos({ frontal, perfil, pedido: look.pedido });
    const { analisis, propuestas } = normalizarRespuesta(respuesta);

    const { error: borrado } = await supabase.from("look_propuestas").delete().eq("look_id", look.id).eq("origen", "ia");
    if (borrado) throw new Error("No se pudieron reemplazar las propuestas.");
    if (propuestas.length > 0) {
      const { error } = await supabase
        .from("look_propuestas")
        .insert(propuestas.map((propuesta) => ({ ...propuesta, look_id: look.id, organization_id: look.organization_id })));
      if (error) throw new Error("No se pudieron guardar las propuestas.");
    }
    const { error: guardado } = await supabase
      .from("looks")
      .update({ analisis, estado: look.estado === "capturado" ? "analizado" : look.estado })
      .eq("id", look.id);
    if (guardado) throw new Error("No se pudo guardar el análisis.");

    await registrarUso(admin, { organization_id: look.organization_id, look_id: look.id, tipo: "analisis", proveedor: "anthropic", modelo, ok: true, detalle: uso });
    return NextResponse.json({ ok: true, fotoUtil: analisis.foto_util, problema: analisis.problema_foto, propuestas: propuestas.length });
  } catch (error) {
    await registrarUso(admin, {
      organization_id: look.organization_id,
      look_id: look.id,
      tipo: "analisis",
      proveedor: "anthropic",
      modelo: modeloDeAnalisis(),
      ok: false,
      detalle: { codigo: error instanceof ErrorDeIA ? error.codigo : "interno" },
    });
    if (error instanceof ErrorDeIA) {
      return NextResponse.json({ error: error.message, codigo: error.codigo }, { status: error.codigo === "sin_clave" ? 503 : 422 });
    }
    // Sin la foto ni detalles del proveedor en los registros.
    console.error("look_analisis_fallido");
    return NextResponse.json({ error: error instanceof Error ? error.message : "El análisis falló. Prueba otra vez." }, { status: 500 });
  }
}
