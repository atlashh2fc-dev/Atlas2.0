import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/auth";
import { LISTA_MOTORES, type Motor3D } from "@/lib/mascota-modelos";
import { avanzarPendientes, listarModelos, pedirPrueba, razaValida } from "@/lib/mascota-modelos.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Modelos realistas por raza, desde la consola de plataforma. Gasta saldo de
 * fal, así que solo responde al dueño de la plataforma.
 */
async function esDuenio() {
  if (!(await getCurrentProfile())) return false;
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_platform_owner");
  return data === true;
}

const prohibido = () => NextResponse.json({ error: "Solo el dueño de la plataforma." }, { status: 403 });

/** Avanza lo que está en la cola de fal y devuelve todas las pruebas. */
export async function GET() {
  if (!(await esDuenio())) return prohibido();
  const admin = createAdminClient();
  await avanzarPendientes(admin);
  return NextResponse.json({ modelos: await listarModelos(admin) });
}

/** Pide la prueba de una raza: la foto y un modelo por cada motor. */
export async function POST(request: Request) {
  if (!(await esDuenio())) return prohibido();
  const cuerpo = (await request.json().catch(() => null)) as { especie?: string; raza?: string; motores?: string[] } | null;
  const especie = cuerpo?.especie === "Gato" ? "Gato" : cuerpo?.especie === "Perro" ? "Perro" : null;
  const raza = cuerpo?.raza ?? "";
  const motores = (cuerpo?.motores ?? LISTA_MOTORES).filter((motor): motor is Motor3D => LISTA_MOTORES.includes(motor as Motor3D));
  if (!especie || !razaValida(especie, raza) || motores.length === 0) {
    return NextResponse.json({ error: "Elige una raza del catálogo y al menos un motor." }, { status: 400 });
  }
  const admin = createAdminClient();
  try {
    await pedirPrueba(admin, especie, raza, motores);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo pedir la prueba." }, { status: 502 });
  }
  return NextResponse.json({ modelos: await listarModelos(admin) });
}

/** Elige el modelo de una raza (el anterior deja de serlo) o corrige hacia dónde mira. */
export async function PATCH(request: Request) {
  if (!(await esDuenio())) return prohibido();
  const cuerpo = (await request.json().catch(() => null)) as { id?: string; elegido?: boolean; giro?: number } | null;
  if (!cuerpo?.id) return NextResponse.json({ error: "Falta el modelo." }, { status: 400 });
  const admin = createAdminClient();
  const { data: fila } = await admin.from("mascota_modelos").select("id, especie, raza, estado").eq("id", cuerpo.id).maybeSingle();
  if (!fila) return NextResponse.json({ error: "No encontramos ese modelo." }, { status: 404 });

  if (typeof cuerpo.giro === "number") {
    if (![0, 90, 180, 270].includes(cuerpo.giro)) return NextResponse.json({ error: "Giro inválido." }, { status: 400 });
    await admin.from("mascota_modelos").update({ giro: cuerpo.giro, updated_at: new Date().toISOString() }).eq("id", fila.id);
  }
  if (cuerpo.elegido === true) {
    if (fila.estado !== "listo") return NextResponse.json({ error: "Ese modelo todavía no está listo." }, { status: 409 });
    await admin.from("mascota_modelos").update({ elegido: false }).eq("especie", fila.especie).eq("raza", fila.raza).eq("elegido", true);
    await admin.from("mascota_modelos").update({ elegido: true, updated_at: new Date().toISOString() }).eq("id", fila.id);
  } else if (cuerpo.elegido === false) {
    await admin.from("mascota_modelos").update({ elegido: false, updated_at: new Date().toISOString() }).eq("id", fila.id);
  }
  return NextResponse.json({ modelos: await listarModelos(admin) });
}
