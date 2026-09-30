import { NextResponse, after } from "next/server";

import { getCurrentProfile } from "@/lib/auth";
import { ErrorDeIA, descargarImagen, editarFoto, instruccionDeVista, modeloDeImagen } from "@/lib/ia/look.server";
import { VISTAS_LOOK, normalizarMapa, type VistaLook } from "@/lib/look";
import { TOPE_IMAGENES_DIARIO } from "@/lib/look-ia";
import { BUCKET_LOOKS, UUID, firmar, leerLook, registrarUso, usoDeHoy } from "@/lib/looks.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 100;
export const dynamic = "force-dynamic";

/**
 * Simula una propuesta desde un ángulo. Responde con la imagen apenas el
 * editor la entrega; guardarla en el bucket y anotarla en la propuesta pasa
 * después de responder, para que el barbero no espere la descarga.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Inicia sesión otra vez." }, { status: 401 });
  const { id } = await params;
  const cuerpo = (await request.json().catch(() => ({}))) as { propuesta?: string; vista?: string };
  const vista = cuerpo.vista as VistaLook;
  if (!cuerpo.propuesta || !UUID.test(cuerpo.propuesta) || !(VISTAS_LOOK as readonly string[]).includes(vista)) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const supabase = await createClient();
  const look = await leerLook(supabase, id);
  if (!look?.foto_path) return NextResponse.json({ error: "No encontramos la foto de ese look." }, { status: 404 });
  const { data: propuesta } = await supabase
    .from("look_propuestas")
    .select("id, look_id, descripcion_visual, mapa, barba")
    .eq("id", cuerpo.propuesta)
    .eq("look_id", look.id)
    .maybeSingle();
  if (!propuesta) return NextResponse.json({ error: "No encontramos esa propuesta." }, { status: 404 });

  const admin = createAdminClient();
  if ((await usoDeHoy(admin, look.organization_id, "imagen")) >= TOPE_IMAGENES_DIARIO) {
    return NextResponse.json({ error: "Se alcanzó el tope de simulaciones de hoy. Mañana se renueva." }, { status: 429 });
  }

  try {
    // Referencias: la foto original (identidad) y, de haber, el retrato de estudio (encuadre y luz) y el perfil.
    const rutas = [look.foto_path, look.retrato_path, look.foto_perfil_path && (vista === "perfil" || vista === "nuca") ? look.foto_perfil_path : null];
    const enlaces = await firmar(supabase, rutas, 15 * 60);
    const fotos = rutas.map((ruta) => (ruta ? enlaces.get(ruta) : null)).filter((url): url is string => Boolean(url));
    if (fotos.length === 0) throw new Error("No se pudo leer la foto.");
    const imagen = await editarFoto({
      fotos,
      instruccion: instruccionDeVista(
        { descripcion_visual: propuesta.descripcion_visual as string, mapa: normalizarMapa(propuesta.mapa), barba: propuesta.barba as string | null },
        vista,
        fotos.length > 1,
      ),
    });

    after(async () => {
      try {
        const archivo = await descargarImagen(imagen.url);
        const extension = archivo.mime.includes("png") ? "png" : archivo.mime.includes("webp") ? "webp" : "jpg";
        const ruta = `${look.organization_id}/${look.cuenta_id}/${look.id}/${propuesta.id}-${vista}-${Date.now()}.${extension}`;
        // La ruta ya se validó con la sesión del usuario; la clave de servicio solo escribe el archivo generado.
        const { error } = await admin.storage.from(BUCKET_LOOKS).upload(ruta, archivo.data, { contentType: archivo.mime, upsert: false });
        if (error) throw error;
        await supabase.rpc("guardar_vista_de_propuesta", { p_propuesta: propuesta.id, p_vista: vista, p_path: ruta });
        await registrarUso(admin, { organization_id: look.organization_id, look_id: look.id, tipo: "imagen", proveedor: "fal", modelo: imagen.modelo, ok: true, detalle: { vista } });
      } catch {
        console.error("look_vista_sin_guardar");
      }
    });
    return NextResponse.json({ ok: true, vista, url: imagen.url });
  } catch (error) {
    await registrarUso(admin, {
      organization_id: look.organization_id,
      look_id: look.id,
      tipo: "imagen",
      proveedor: "fal",
      modelo: modeloDeImagen(),
      ok: false,
      detalle: { vista, codigo: error instanceof ErrorDeIA ? error.codigo : "interno" },
    });
    if (error instanceof ErrorDeIA) {
      return NextResponse.json({ error: error.message, codigo: error.codigo }, { status: error.codigo === "sin_clave" ? 503 : 422 });
    }
    console.error("look_vista_fallida");
    return NextResponse.json({ error: error instanceof Error ? error.message : "La simulación falló." }, { status: 500 });
  }
}
