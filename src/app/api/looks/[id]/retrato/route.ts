import { NextResponse, after } from "next/server";

import { getCurrentProfile } from "@/lib/auth";
import { ErrorDeIA, descargarImagen, editarFoto, modeloDeImagen } from "@/lib/ia/look.server";
import { TOPE_IMAGENES_DIARIO, instruccionDeRetrato } from "@/lib/look-ia";
import { BUCKET_LOOKS, firmar, leerLook, registrarUso, usoDeHoy } from "@/lib/looks.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 100;
export const dynamic = "force-dynamic";

/**
 * El "antes" de un look: la foto del cliente rehecha como retrato de estudio,
 * con su pelo tal cual. Se pide una vez, apenas se guarda la foto, y queda
 * guardado antes de responder: el frente de cada simulación lo edita.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentProfile())) return NextResponse.json({ error: "Inicia sesión otra vez." }, { status: 401 });
  const { id } = await params;
  const supabase = await createClient();
  const look = await leerLook(supabase, id);
  if (!look?.foto_path) return NextResponse.json({ error: "No encontramos la foto de ese look." }, { status: 404 });
  if (look.retrato_path) {
    const enlaces = await firmar(supabase, [look.retrato_path]);
    return NextResponse.json({ ok: true, url: enlaces.get(look.retrato_path) ?? null });
  }

  const admin = createAdminClient();
  if ((await usoDeHoy(admin, look.organization_id, "imagen")) >= TOPE_IMAGENES_DIARIO) {
    return NextResponse.json({ error: "Se alcanzó el tope de imágenes de hoy." }, { status: 429 });
  }
  try {
    const rutas = [look.foto_path, look.foto_perfil_path];
    const enlaces = await firmar(supabase, rutas, 15 * 60);
    const fotos = rutas.map((ruta) => (ruta ? enlaces.get(ruta) : null)).filter((url): url is string => Boolean(url));
    const imagen = await editarFoto({ fotos, instruccion: instruccionDeRetrato(fotos.length > 1) });
    // Se guarda antes de responder: las simulaciones del frente editan este retrato para heredar su encuadre,
    // y no pueden partir sin él.
    try {
      const archivo = await descargarImagen(imagen.url);
      const ruta = `${look.organization_id}/${look.cuenta_id}/${look.id}/retrato-${Date.now()}.jpg`;
      const { error } = await admin.storage.from(BUCKET_LOOKS).upload(ruta, archivo.data, { contentType: archivo.mime, upsert: false });
      if (error) throw error;
      await supabase.from("looks").update({ retrato_path: ruta }).eq("id", look.id);
    } catch {
      console.error("look_retrato_sin_guardar");
    }
    after(() => registrarUso(admin, { organization_id: look.organization_id, look_id: look.id, tipo: "imagen", proveedor: "fal", modelo: imagen.modelo, ok: true, detalle: { vista: "retrato" } }));
    return NextResponse.json({ ok: true, url: imagen.url });
  } catch (error) {
    await registrarUso(admin, { organization_id: look.organization_id, look_id: look.id, tipo: "imagen", proveedor: "fal", modelo: modeloDeImagen(), ok: false, detalle: { vista: "retrato", codigo: error instanceof ErrorDeIA ? error.codigo : "interno" } });
    const status = error instanceof ErrorDeIA && error.codigo === "sin_clave" ? 503 : 422;
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo preparar el retrato." }, { status });
  }
}
