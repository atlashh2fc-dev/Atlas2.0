"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import {
  CATALOGO_CORTES,
  DENSIDADES,
  ENTRADAS,
  ESTILOS_BARBA,
  FORMAS_ROSTRO,
  TIPOS_PELO,
  aplicarBarba,
  normalizarMapa,
  recomendarPorReglas,
  type AnalisisLook,
  type EstiloBarba,
  type PerfilCliente,
} from "@/lib/look";
import { BUCKET_LOOKS, UUID, leerLook } from "@/lib/looks.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/*
 * Estudio de Look. Todo corre con la sesión de quien atiende: la seguridad por
 * fila decide qué empresa y qué ficha. La clave de servicio solo se usa para
 * borrar fotos del bucket cuando el cliente revoca su consentimiento.
 */

type Resultado<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const RUTA_FOTO = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/i;

function limpio(valor: unknown, largo = 400): string | null {
  const texto = String(valor ?? "").trim().slice(0, largo);
  return texto === "" ? null : texto;
}

function ficha(cuentaId: string) {
  revalidatePath(`/dashboard/pacientes/${cuentaId}`);
}

export async function registrarConsentimiento(cuentaId: string): Promise<Resultado> {
  const profile = await requireProfile(["admin", "supervisor"]);
  if (!UUID.test(cuentaId)) return { ok: false, error: "Ficha inválida." };
  const supabase = await createClient();
  const { data: cuenta } = await supabase.from("sales_companies").select("organization_id").eq("id", cuentaId).maybeSingle();
  if (!cuenta) return { ok: false, error: "No encontramos esa ficha." };
  const { error } = await supabase
    .from("consentimientos_de_imagen")
    .insert({ organization_id: cuenta.organization_id, cuenta_id: cuentaId, registrado_por: profile.id });
  // Ya había uno vigente: da lo mismo, queda autorizado.
  if (error && error.code !== "23505") return { ok: false, error: "No se pudo registrar la autorización." };
  ficha(cuentaId);
  return { ok: true };
}

/**
 * Revocar borra en el momento todas las fotos del cliente (las originales y
 * las simuladas) y deja la historia sin imágenes. Los mapas de corte quedan:
 * no son fotos.
 */
export async function revocarConsentimiento(cuentaId: string): Promise<Resultado<{ borradas: number }>> {
  await requireProfile(["admin", "supervisor"]);
  if (!UUID.test(cuentaId)) return { ok: false, error: "Ficha inválida." };
  const supabase = await createClient();
  const { data: looks } = await supabase
    .from("looks")
    .select("id, foto_path, foto_perfil_path, foto_despues_path, modelo_path, look_propuestas(vistas, modelo_path)")
    .eq("cuenta_id", cuentaId);
  const { error } = await supabase
    .from("consentimientos_de_imagen")
    .update({ revocado_at: new Date().toISOString() })
    .eq("cuenta_id", cuentaId)
    .is("revocado_at", null);
  if (error) return { ok: false, error: "No se pudo revocar." };

  const rutas: string[] = [];
  for (const look of (looks ?? []) as { id: string; foto_path: string | null; foto_perfil_path: string | null; foto_despues_path: string | null; modelo_path: string | null; look_propuestas: { vistas: Record<string, string>; modelo_path: string | null }[] }[]) {
    for (const ruta of [look.foto_path, look.foto_perfil_path, look.foto_despues_path, look.modelo_path]) if (ruta) rutas.push(ruta);
    for (const propuesta of look.look_propuestas ?? []) {
      rutas.push(...Object.values(propuesta.vistas ?? {}));
      if (propuesta.modelo_path) rutas.push(propuesta.modelo_path);
    }
  }
  if (rutas.length > 0) {
    const admin = createAdminClient();
    await admin.storage.from(BUCKET_LOOKS).remove(rutas);
    const ids = (looks ?? []).map((look) => look.id as string);
    await supabase
      .from("looks")
      .update({ foto_path: null, foto_perfil_path: null, foto_despues_path: null, modelo_path: null, modelo_estado: null, compartir_token: null, fotos_borradas_at: new Date().toISOString() })
      .in("id", ids);
    await supabase.from("look_propuestas").update({ vistas: {}, modelo_path: null, modelo_estado: null }).in("look_id", ids);
  }
  ficha(cuentaId);
  return { ok: true, borradas: rutas.length };
}

export async function crearLook(entrada: { cuentaId: string; fotoPath: string; perfilPath?: string | null; pedido?: string | null; barbero?: string | null }): Promise<Resultado<{ id: string }>> {
  const profile = await requireProfile(["admin", "supervisor"]);
  const { cuentaId, fotoPath, perfilPath } = entrada;
  if (!UUID.test(cuentaId)) return { ok: false, error: "Ficha inválida." };
  // Las rutas las armó el navegador: tienen que caer en la carpeta de esta ficha.
  for (const ruta of [fotoPath, perfilPath].filter(Boolean) as string[]) {
    if (!RUTA_FOTO.test(ruta) || ruta.split("/")[1] !== cuentaId) return { ok: false, error: "Ruta de foto inválida." };
  }
  const supabase = await createClient();
  const { data: cuenta } = await supabase.from("sales_companies").select("organization_id").eq("id", cuentaId).maybeSingle();
  if (!cuenta) return { ok: false, error: "No encontramos esa ficha." };
  if (fotoPath.split("/")[0] !== cuenta.organization_id) return { ok: false, error: "Ruta de foto inválida." };
  const lookId = fotoPath.split("/")[2];
  const { error } = await supabase.from("looks").insert({
    id: lookId,
    organization_id: cuenta.organization_id,
    cuenta_id: cuentaId,
    foto_path: fotoPath,
    foto_perfil_path: perfilPath ?? null,
    pedido: limpio(entrada.pedido, 600),
    barbero: limpio(entrada.barbero, 80),
    creado_por: profile.id,
  });
  if (error) return { ok: false, error: error.code === "42501" ? "El cliente todavía no autoriza fotos." : "No se pudo guardar el look." };
  ficha(cuentaId);
  return { ok: true, id: lookId };
}

/**
 * Sin IA (o además de ella): el barbero dice la forma del rostro y el tipo de
 * pelo, y el catálogo propone por reglas. Deja un análisis manual.
 */
export async function proponerPorFacciones(
  lookId: string,
  perfil: PerfilCliente & { barba: EstiloBarba },
): Promise<Resultado<{ propuestas: number }>> {
  await requireProfile(["admin", "supervisor"]);
  if (
    !FORMAS_ROSTRO.includes(perfil.forma) ||
    !TIPOS_PELO.includes(perfil.pelo) ||
    !DENSIDADES.includes(perfil.densidad) ||
    !ENTRADAS.includes(perfil.entradas) ||
    !ESTILOS_BARBA.some((estilo) => estilo.id === perfil.barba)
  ) {
    return { ok: false, error: "Completa las facciones." };
  }
  const supabase = await createClient();
  const look = await leerLook(supabase, lookId);
  if (!look) return { ok: false, error: "No encontramos ese look." };
  const barba = ESTILOS_BARBA.find((estilo) => estilo.id === perfil.barba)!;
  const recomendaciones = recomendarPorReglas({ ...perfil, pedido: perfil.pedido ?? look.pedido ?? undefined }, 4);

  await supabase.from("look_propuestas").delete().eq("look_id", look.id).eq("origen", "reglas");
  const { error } = await supabase.from("look_propuestas").insert(
    recomendaciones.map(({ corte, razones }, orden) => ({
      organization_id: look.organization_id,
      look_id: look.id,
      orden: 10 + orden,
      nombre: corte.nombre,
      corte_base: corte.id,
      por_que: razones.length ? `${razones[0][0].toUpperCase()}${razones.join(", ").slice(1)}.` : corte.descripcion,
      que_decirle: corte.descripcion,
      mantencion_semanas: corte.mantencion,
      dificultad: corte.mantencion <= 2 ? "baja" : "media",
      barba: barba.nombre,
      descripcion_visual: `${corte.visual}, ${barba.visual}`,
      mapa: aplicarBarba(corte.mapa, perfil.barba),
      origen: "reglas",
    })),
  );
  if (error) return { ok: false, error: "No se pudieron guardar las propuestas." };

  const { data: actual } = await supabase.from("looks").select("analisis").eq("id", look.id).maybeSingle();
  if (!actual?.analisis) {
    const manual: AnalisisLook = {
      rostro: { forma: perfil.forma, confianza: "media", frente: "", mandibula: "", pomulos: "", notas: "Indicado por el barbero." },
      pelo: { tipo: perfil.pelo, grosor: "medio", densidad: perfil.densidad, color: "", largo_actual_mm: 0, entradas: perfil.entradas, remolinos: "", linea_nacimiento: "" },
      barba: { tiene: perfil.barba !== "sin_barba", densidad: perfil.barba === "sin_barba" ? "nula" : "media", estilo_actual: barba.nombre },
      estilo_actual: "",
      foto_util: true,
      problema_foto: "",
      evitar: [],
      notas_para_barbero: "",
    };
    await supabase.from("looks").update({ analisis: manual, estado: look.estado === "capturado" ? "analizado" : look.estado }).eq("id", look.id);
  }
  ficha(look.cuenta_id);
  return { ok: true, propuestas: recomendaciones.length };
}

export async function agregarDelCatalogo(lookId: string, corteId: string, barbaId: EstiloBarba): Promise<Resultado<{ id: string }>> {
  await requireProfile(["admin", "supervisor"]);
  const corte = CATALOGO_CORTES.find((opcion) => opcion.id === corteId);
  const barba = ESTILOS_BARBA.find((opcion) => opcion.id === barbaId);
  if (!corte || !barba) return { ok: false, error: "Elige un corte del catálogo." };
  const supabase = await createClient();
  const look = await leerLook(supabase, lookId);
  if (!look) return { ok: false, error: "No encontramos ese look." };
  const { data, error } = await supabase
    .from("look_propuestas")
    .insert({
      organization_id: look.organization_id,
      look_id: look.id,
      orden: 50,
      nombre: corte.nombre,
      corte_base: corte.id,
      por_que: "Elegido por el barbero.",
      que_decirle: corte.descripcion,
      mantencion_semanas: corte.mantencion,
      dificultad: "media",
      barba: barba.nombre,
      descripcion_visual: `${corte.visual}, ${barba.visual}`,
      mapa: aplicarBarba(corte.mapa, barbaId),
      origen: "barbero",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "No se pudo agregar." };
  if (look.estado === "capturado") await supabase.from("looks").update({ estado: "analizado" }).eq("id", look.id);
  ficha(look.cuenta_id);
  return { ok: true, id: data.id as string };
}

/** Ajustes del barbero sobre una propuesta: el mapa por zona. */
export async function ajustarPropuesta(propuestaId: string, mapa: unknown): Promise<Resultado> {
  await requireProfile(["admin", "supervisor"]);
  if (!UUID.test(propuestaId)) return { ok: false, error: "Propuesta inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("look_propuestas")
    .update({ mapa: normalizarMapa(mapa) })
    .eq("id", propuestaId)
    .select("look_id, looks(cuenta_id)")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "No se pudo guardar el ajuste." };
  const cuenta = (Array.isArray(data.looks) ? data.looks[0] : data.looks) as { cuenta_id: string } | null;
  if (cuenta) ficha(cuenta.cuenta_id);
  return { ok: true };
}

export async function aprobarPropuesta(lookId: string, propuestaId: string): Promise<Resultado> {
  await requireProfile(["admin", "supervisor"]);
  if (!UUID.test(propuestaId)) return { ok: false, error: "Propuesta inválida." };
  const supabase = await createClient();
  const look = await leerLook(supabase, lookId);
  if (!look) return { ok: false, error: "No encontramos ese look." };
  const { data: propuesta } = await supabase.from("look_propuestas").select("id").eq("id", propuestaId).eq("look_id", look.id).maybeSingle();
  if (!propuesta) return { ok: false, error: "Esa propuesta no es de este look." };
  const { error } = await supabase
    .from("looks")
    .update({ propuesta_aprobada: propuestaId, estado: look.estado === "realizado" ? "realizado" : "aprobado", aprobado_at: new Date().toISOString() })
    .eq("id", look.id);
  if (error) return { ok: false, error: "No se pudo aprobar." };
  ficha(look.cuenta_id);
  return { ok: true };
}

export async function guardarMapaDeCorte(entrada: {
  cuentaId: string;
  lookId?: string | null;
  nombre?: string | null;
  mapa: unknown;
  nota?: string | null;
  profesional?: string | null;
}): Promise<Resultado> {
  const profile = await requireProfile(["admin", "supervisor"]);
  if (!UUID.test(entrada.cuentaId)) return { ok: false, error: "Ficha inválida." };
  if (entrada.lookId && !UUID.test(entrada.lookId)) return { ok: false, error: "Look inválido." };
  const supabase = await createClient();
  const { data: cuenta } = await supabase.from("sales_companies").select("organization_id").eq("id", entrada.cuentaId).maybeSingle();
  if (!cuenta) return { ok: false, error: "No encontramos esa ficha." };
  const { error } = await supabase.from("mapas_de_corte").insert({
    organization_id: cuenta.organization_id,
    cuenta_id: entrada.cuentaId,
    look_id: entrada.lookId ?? null,
    nombre: limpio(entrada.nombre, 120),
    mapa: normalizarMapa(entrada.mapa),
    nota: limpio(entrada.nota, 800),
    profesional: limpio(entrada.profesional, 80),
    registrado_por: profile.id,
  });
  if (error) return { ok: false, error: "No se pudo guardar el mapa de corte." };
  ficha(entrada.cuentaId);
  return { ok: true };
}

export async function registrarFotoDespues(lookId: string, ruta: string): Promise<Resultado> {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();
  const look = await leerLook(supabase, lookId);
  if (!look) return { ok: false, error: "No encontramos ese look." };
  if (!RUTA_FOTO.test(ruta) || !ruta.startsWith(`${look.organization_id}/${look.cuenta_id}/${look.id}/`)) return { ok: false, error: "Ruta de foto inválida." };
  const { error } = await supabase
    .from("looks")
    .update({ foto_despues_path: ruta, estado: "realizado", realizado_at: new Date().toISOString() })
    .eq("id", look.id);
  if (error) return { ok: false, error: "No se pudo guardar la foto." };
  ficha(look.cuenta_id);
  return { ok: true };
}

export async function descartarLook(lookId: string): Promise<Resultado> {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();
  const look = await leerLook(supabase, lookId);
  if (!look) return { ok: false, error: "No encontramos ese look." };
  const { error } = await supabase.from("looks").update({ estado: "descartado", compartir_token: null }).eq("id", look.id);
  if (error) return { ok: false, error: "No se pudo descartar." };
  ficha(look.cuenta_id);
  return { ok: true };
}

/**
 * Le manda al cliente su look por WhatsApp (o correo si no tiene celular):
 * un enlace con token largo que abre las vistas aprobadas sin cuenta.
 */
export async function enviarLookAlCliente(lookId: string): Promise<Resultado<{ url: string }>> {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();
  const look = await leerLook(supabase, lookId);
  if (!look) return { ok: false, error: "No encontramos ese look." };
  if (look.estado !== "aprobado" && look.estado !== "realizado") return { ok: false, error: "Primero aprueben un look." };

  const { data: actual } = await supabase.from("looks").select("compartir_token").eq("id", look.id).maybeSingle();
  const token = (actual?.compartir_token as string | null) ?? randomBytes(24).toString("base64url");
  if (!actual?.compartir_token) {
    const { error } = await supabase.from("looks").update({ compartir_token: token }).eq("id", look.id);
    if (error) return { ok: false, error: "No se pudo crear el enlace." };
  }
  const cabeceras = await headers();
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host") ?? "atlascrm.geimser.cl";
  const proto = cabeceras.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const url = `${proto}://${host}/look/${token}`;

  const [{ data: cuenta }, { data: empresa }] = await Promise.all([
    supabase.from("sales_companies").select("name, phone, email").eq("id", look.cuenta_id).maybeSingle(),
    supabase.from("organizations").select("name").eq("id", look.organization_id).maybeSingle(),
  ]);
  const canal = cuenta?.phone ? "whatsapp" : cuenta?.email ? "correo" : null;
  if (!canal) return { ok: false, error: "La ficha no tiene celular ni correo. Copia el enlace y compártelo." };
  const { error } = await supabase.rpc("programar_mensaje", {
    p_cuenta: look.cuenta_id,
    p_plantilla: "look",
    p_variables: { nombre: String(cuenta?.name ?? "").split(" ")[0], clinica: empresa?.name ?? "la barbería", url },
    p_regla: "look",
    p_origen_ref: look.id,
    p_canal: canal,
  });
  if (error) return { ok: false, error: "No se pudo programar el envío." };
  ficha(look.cuenta_id);
  return { ok: true, url };
}
