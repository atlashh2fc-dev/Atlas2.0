import { cache } from "react";
import { notFound } from "next/navigation";

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

/**
 * Módulos de la empresa que se está mirando. Se cachea por petición: el menú,
 * la cabecera y la página la piden por separado y es la misma respuesta.
 */
export const modulosActivos = cache(async (): Promise<AppModule[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("modulos_de_mi_empresa");
  if (error) {
    console.error("[modulos] no se pudieron leer los módulos de la empresa", error.message);
    return [];
  }
  return soloModulos(data);
});

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
