import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/auth";
import { avanzarPendientes, elegirLosListos, pedirParaClinica, razaValida, razasDeLaClinica } from "@/lib/mascota-modelos.server";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Modelos realistas de las razas de una clínica, desde su Configuración. El
 * modelo es de la raza y sirve a todas las clínicas, pero pedirlo gasta saldo
 * de fal: solo responde a quien administra una clínica veterinaria, solo por
 * razas que esa clínica atiende y una sola vez por raza.
 */
async function administraUnaVeterinaria() {
  const perfil = await getCurrentProfile();
  if (!perfil?.active || perfil.role !== "admin") return false;
  return (await contextoDeMiEmpresa()).edicion === "vet";
}

const prohibido = () => NextResponse.json({ error: "Solo quien administra la veterinaria." }, { status: 403 });

/** Avanza lo que está en la cola, deja puestos los modelos listos y devuelve las razas de la clínica. */
export async function GET() {
  if (!(await administraUnaVeterinaria())) return prohibido();
  const admin = createAdminClient();
  await avanzarPendientes(admin);
  await elegirLosListos(admin);
  return NextResponse.json({ razas: await razasDeLaClinica(await createClient(), admin) });
}

/** Pide el modelo realista de una raza que la clínica atiende. */
export async function POST(request: Request) {
  if (!(await administraUnaVeterinaria())) return prohibido();
  const cuerpo = (await request.json().catch(() => null)) as { especie?: string; raza?: string } | null;
  const especie = cuerpo?.especie === "Gato" ? "Gato" : cuerpo?.especie === "Perro" ? "Perro" : null;
  const raza = cuerpo?.raza ?? "";
  const admin = createAdminClient();
  const clinica = await createClient();
  const atendidas = await razasDeLaClinica(clinica, admin);
  if (!especie || !razaValida(especie, raza) || !atendidas.some((item) => item.especie === especie && item.raza === raza)) {
    return NextResponse.json({ error: "Esa raza no está entre las mascotas de la clínica." }, { status: 400 });
  }
  try {
    await pedirParaClinica(admin, especie, raza);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo pedir el modelo." }, { status: 502 });
  }
  return NextResponse.json({ razas: await razasDeLaClinica(clinica, admin) });
}
