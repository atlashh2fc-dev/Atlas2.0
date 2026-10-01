import { cache } from "react";
import { notFound, redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { parseEdicion, type Edicion } from "@/lib/ediciones";
import { APP_MODULES, type AppModule } from "@/lib/modules";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

/**
 * Consola de plataforma: la administración de Atlas como producto.
 *
 * Es el plano de control de un SaaS multiempresa, separado del plano de cada
 * empresa: Altius es una empresa más dentro de Atlas. Todo se ordena por
 * empresa —su gente, sus aplicaciones, su estado—; nunca se mezcla la gente de
 * todas en una sola lista. Solo entra el dueño de la plataforma.
 */

/** Deja pasar solo al dueño de la plataforma; cualquier otro vuelve a su CRM. */
export const requirePlataforma = cache(async () => {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: esDuenio, error } = await supabase.rpc("is_platform_owner");
  if (error) console.error("[plataforma] no se pudo comprobar el dueño", error.message);
  if (esDuenio !== true) redirect("/dashboard");
  return profile;
});

export type MiembroDeEmpresa = {
  id: string;
  nombre: string;
  correo: string | null;
  rol: AppRole;
  activo: boolean;
  /** Es su empresa principal (con la que entra). */
  principal: boolean;
  ultimoIngreso: string | null;
};

export type EmpresaDePlataforma = {
  id: string;
  slug: string;
  nombre: string;
  activa: boolean;
  edicion: Edicion;
  creada: string;
  miembros: MiembroDeEmpresa[];
  miembrosActivos: number;
  campanas: number;
  aplicaciones: AppModule[];
  /** Último ingreso de cualquiera de sus miembros: la señal de si la usan. */
  ultimaActividad: string | null;
};

/**
 * Todas las empresas con su gente, sin el filtro de «la empresa que estás
 * mirando».
 *
 * Con la sesión de la persona, la seguridad por fila muestra solo la empresa
 * elegida en el CRM y la consola vería a medias. Por eso lee con el cliente de
 * servicio, y solo después de `requirePlataforma`. Las escrituras siguen yendo
 * por RPC con la sesión, donde la base vuelve a comprobar al dueño.
 *
 * Los miembros salen de la membresía (`organization_members`), no de la
 * empresa principal del perfil, y sin los dueños de la plataforma, que son
 * miembros de todas para poder entrar a cualquiera.
 */
export const leerPlataforma = cache(async () => {
  await requirePlataforma();
  const admin = createAdminClient();

  const [empresas, perfiles, membresias, duenios, campanas, modulos, ingresos] = await Promise.all([
    admin.from("organizations").select("id, slug, name, active, edicion, created_at").order("name"),
    admin.from("profiles").select("id, full_name, email, role, active"),
    admin.from("organization_members").select("organization_id, profile_id, is_default"),
    admin.from("platform_owners").select("profile_id"),
    admin.from("campaigns").select("organization_id"),
    admin.from("organization_modules").select("organization_id, module, enabled"),
    admin.rpc("ultimo_ingreso_de_personas"),
  ]);

  for (const [que, respuesta] of [
    ["empresas", empresas],
    ["personas", perfiles],
    ["membresías", membresias],
    ["dueños", duenios],
    ["campañas", campanas],
    ["aplicaciones", modulos],
  ] as const) {
    if (respuesta.error) throw new Error(`No se pudieron leer las ${que}: ${respuesta.error.message}`);
  }
  // Sin último ingreso la consola igual sirve: no tumba la página.
  if (ingresos.error) console.error("[plataforma] no se pudo leer el último ingreso", ingresos.error.message);

  // Sale de auth.users por RPC: `auth.admin.listUsers` responde 500 en este proyecto.
  const ultimoIngreso = new Map(
    ((ingresos.data ?? []) as { profile_id: string; last_sign_in_at: string | null }[]).map((fila) => [
      fila.profile_id,
      fila.last_sign_in_at,
    ]),
  );
  const esDuenio = new Set((duenios.data ?? []).map((fila) => fila.profile_id));
  const perfilPorId = new Map((perfiles.data ?? []).map((perfil) => [perfil.id, perfil]));

  const miembrosPorEmpresa = new Map<string, MiembroDeEmpresa[]>();
  for (const membresia of membresias.data ?? []) {
    const perfil = perfilPorId.get(membresia.profile_id);
    if (!perfil || esDuenio.has(membresia.profile_id)) continue;
    const lista = miembrosPorEmpresa.get(membresia.organization_id) ?? [];
    lista.push({
      id: perfil.id,
      nombre: perfil.full_name ?? perfil.email ?? "Sin nombre",
      correo: perfil.email,
      rol: perfil.role as AppRole,
      activo: perfil.active,
      principal: membresia.is_default === true,
      ultimoIngreso: ultimoIngreso.get(perfil.id) ?? null,
    });
    miembrosPorEmpresa.set(membresia.organization_id, lista);
  }

  const campanasPorEmpresa = new Map<string, number>();
  for (const campana of campanas.data ?? []) {
    if (campana.organization_id) {
      campanasPorEmpresa.set(campana.organization_id, (campanasPorEmpresa.get(campana.organization_id) ?? 0) + 1);
    }
  }

  const aplicaciones = new Map<string, Set<string>>();
  for (const fila of modulos.data ?? []) {
    if (!fila.enabled) continue;
    aplicaciones.set(fila.organization_id, (aplicaciones.get(fila.organization_id) ?? new Set()).add(fila.module));
  }

  const lista: EmpresaDePlataforma[] = (empresas.data ?? []).map((empresa) => {
    const miembros = (miembrosPorEmpresa.get(empresa.id) ?? []).sort(
      (a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre, "es"),
    );
    const ultimaActividad = miembros.reduce<string | null>(
      (ultima, miembro) => (miembro.ultimoIngreso && (!ultima || miembro.ultimoIngreso > ultima) ? miembro.ultimoIngreso : ultima),
      null,
    );
    return {
      id: empresa.id,
      slug: empresa.slug,
      nombre: empresa.name,
      activa: empresa.active,
      edicion: parseEdicion(empresa.edicion),
      creada: empresa.created_at,
      miembros,
      miembrosActivos: miembros.filter((miembro) => miembro.activo).length,
      campanas: campanasPorEmpresa.get(empresa.id) ?? 0,
      aplicaciones: APP_MODULES.filter((modulo) => aplicaciones.get(empresa.id)?.has(modulo)),
      ultimaActividad,
    };
  });

  return { empresas: lista };
});

/** Una empresa de la consola, o 404. */
export async function leerEmpresa(id: string) {
  const { empresas } = await leerPlataforma();
  const empresa = empresas.find((candidata) => candidata.id === id);
  if (!empresa) notFound();
  return { empresa, empresas };
}

const ZONA = "America/Santiago";

export function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: ZONA });
}

/** «hoy», «ayer», «hace 5 días» o la fecha: lo que se lee de un vistazo. */
export function haceCuanto(iso: string | null): string {
  if (!iso) return "Nunca";
  const dia = (fecha: Date) => new Date(fecha.toLocaleDateString("en-CA", { timeZone: ZONA })).getTime();
  const dias = Math.round((dia(new Date()) - dia(new Date(iso))) / 86_400_000);
  if (dias <= 0) return "Hoy";
  if (dias === 1) return "Ayer";
  if (dias < 30) return `Hace ${dias} días`;
  return fechaCorta(iso);
}

export function iniciales(nombre: string | null | undefined): string {
  return (nombre ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join("");
}
