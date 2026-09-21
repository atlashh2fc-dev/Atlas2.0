"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { esModulo } from "@/lib/modules";
import { modulosActivos } from "@/lib/modules.server";
import { destinoTrasCambiarEmpresa } from "@/lib/nav.config";
import { createClient } from "@/lib/supabase/server";

/*
 * Administración de empresas.
 *
 * Todo pasa por RPC con la sesión de la persona, nunca con el cliente de
 * servicio: la comprobación de "dueño de la plataforma" vive en la base y así no
 * hay forma de saltársela desde acá. Un admin de Geimser que llame a estas
 * acciones recibe el error de la base, no una pantalla a medias.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

function revalidarEmpresas() {
  revalidatePath("/dashboard/admin/empresas");
  revalidatePath("/dashboard/admin/usuarios");
  revalidatePath("/dashboard", "layout");
}

export async function crearEmpresa(formData: FormData) {
  await requireProfile(["admin"]);
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const nombre = String(formData.get("nombre") ?? "").trim();

  if (!SLUG.test(slug)) {
    throw new Error("La clave debe tener entre 3 y 40 caracteres: minúsculas, números y guiones.");
  }
  if (nombre.length < 2) {
    throw new Error("Escribe el nombre de la empresa.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("crear_organizacion", { p_slug: slug, p_name: nombre });
  if (error) throw new Error(error.message);
  revalidarEmpresas();
}

export async function cambiarEstadoEmpresa(formData: FormData) {
  await requireProfile(["admin"]);
  const empresaId = String(formData.get("empresa_id") ?? "").trim();
  const activa = String(formData.get("activa") ?? "") === "true";
  if (!UUID.test(empresaId)) throw new Error("Empresa inválida.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("activar_organizacion", {
    p_organization_id: empresaId,
    p_activa: activa,
  });
  if (error) throw new Error(error.message);
  revalidarEmpresas();
}

export async function moverPersonaDeEmpresa(formData: FormData) {
  await requireProfile(["admin"]);
  const perfilId = String(formData.get("perfil_id") ?? "").trim();
  const empresaId = String(formData.get("empresa_id") ?? "").trim();
  if (!UUID.test(perfilId)) throw new Error("Persona inválida.");
  if (!UUID.test(empresaId)) throw new Error("Empresa inválida.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("mover_perfil_a_organizacion", {
    p_profile_id: perfilId,
    p_organization_id: empresaId,
  });
  if (error) throw new Error(error.message);
  revalidarEmpresas();
}

/**
 * Cambia la empresa que la persona está mirando. Vacío = todas las suyas.
 *
 * La pantalla actual puede no existir en la empresa nueva (Ventas en una empresa
 * que no lo contrató, o la ficha de un registro ajeno): en ese caso se redirige
 * desde acá, en la misma respuesta, para que el 404 no alcance a pintarse.
 */
export async function elegirEmpresaActiva(formData: FormData) {
  await requireProfile();
  const empresaId = String(formData.get("empresa_id") ?? "").trim();
  const desde = String(formData.get("desde") ?? "/dashboard");
  if (empresaId && !UUID.test(empresaId)) throw new Error("Empresa inválida.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("elegir_organizacion_activa", {
    p_organization_id: empresaId === "" ? null : empresaId,
  });
  if (error) throw new Error(error.message);
  // La empresa elegida cambia lo que ve cada consulta: se revalida todo el panel.
  revalidatePath("/dashboard", "layout");
  const ruta = desde.startsWith("/dashboard") ? desde : "/dashboard";
  const destino = destinoTrasCambiarEmpresa(ruta, await modulosActivos());
  if (destino !== ruta) redirect(destino, RedirectType.replace);
}

/**
 * Contratar o dar de baja una aplicación de la suite para una empresa.
 *
 * Es una decisión comercial, no una preferencia: la base comprueba que quien
 * llama sea el dueño de la plataforma y esta acción solo transporta el dato.
 */
export async function cambiarAplicacionDeEmpresa(formData: FormData) {
  await requireProfile(["admin"]);
  const empresaId = String(formData.get("empresa_id") ?? "").trim();
  const modulo = String(formData.get("modulo") ?? "").trim();
  const activar = String(formData.get("activar") ?? "") === "true";

  if (!UUID.test(empresaId)) throw new Error("Empresa inválida.");
  if (!esModulo(modulo)) throw new Error("Aplicación desconocida.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("cambiar_modulo_de_empresa", {
    p_organization_id: empresaId,
    p_module: modulo,
    p_enabled: activar,
  });
  if (error) throw new Error(error.message);
  revalidarEmpresas();
}
