import { cache } from "react";
import { notFound } from "next/navigation";

import type { EmpresaDisponible } from "@/components/selector-empresa";
import { parseEdicion, type Edicion } from "@/lib/ediciones";
import { APP_MODULES, type AppModule } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";

/**
 * Lectura de módulos contra la base. Vive aparte de `modules.ts` porque el menú
 * es un componente de cliente y no puede arrastrar el cliente de servidor.
 */

function soloModulos(valores: unknown): AppModule[] {
  if (!Array.isArray(valores)) return [];
  return valores.filter((valor): valor is AppModule =>
    typeof valor === "string" && (APP_MODULES as readonly string[]).includes(valor),
  );
}

export type ContextoDeEmpresa = {
  edicion: Edicion;
  modulos: AppModule[];
  empresas: EmpresaDisponible[];
};

/**
 * Lo que el panel necesita saber de la empresa que se está mirando —edición,
 * aplicaciones y a qué empresas llega la persona— en un solo viaje a la base.
 * Se cachea por petición: el layout, el menú y la página lo piden por separado
 * y es la misma respuesta.
 */
export const contextoDeMiEmpresa = cache(async (): Promise<ContextoDeEmpresa> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("contexto_de_mi_empresa");
  if (error || !data || typeof data !== "object") {
    console.error("[empresa] no se pudo leer el contexto de la empresa", error?.message);
    return { edicion: "center", modulos: [], empresas: [] };
  }
  const contexto = data as { edicion?: unknown; modulos?: unknown; empresas?: unknown };
  return {
    edicion: parseEdicion(contexto.edicion),
    modulos: soloModulos(contexto.modulos),
    empresas: Array.isArray(contexto.empresas) ? (contexto.empresas as EmpresaDisponible[]) : [],
  };
});

/** Módulos de la empresa que se está mirando. */
export async function modulosActivos(): Promise<AppModule[]> {
  return (await contextoDeMiEmpresa()).modulos;
}

/**
 * Cierra una página que no corresponde a la empresa activa.
 *
 * Responde 404 y no 403 a propósito: para esta empresa esa pantalla no existe,
 * y decir "existe pero no puedes" ya revela algo del otro negocio.
 */
export async function requireModule(...permitidos: AppModule[]): Promise<void> {
  const activos = await modulosActivos();
  if (!permitidos.some((modulo) => activos.includes(modulo))) notFound();
}
