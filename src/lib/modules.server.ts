import { cache } from "react";
import { notFound } from "next/navigation";

import type { EmpresaDisponible } from "@/components/selector-empresa";
import { parseEdicion, type Edicion } from "@/lib/ediciones";
import { APP_MODULES, type AppModule } from "@/lib/modules";
import type { AppRole } from "@/lib/types";
import { getWorkspacePermissions } from "@/lib/workspace-permissions";
import { sesionActual } from "@/lib/sesion.server";

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
  /** Nombre de la empresa que se está mirando. */
  empresa: string | null;
  /** Quien mira es el dueño de la plataforma. */
  duenio: boolean;
};

/**
 * Lo que el panel necesita saber de la empresa que se está mirando —edición,
 * aplicaciones y a qué empresas llega la persona—. Viaja junto con el perfil
 * en la misma RPC de `sesionActual`, así que pedirlo no cuesta ningún viaje
 * adicional: el layout, el menú y la página lo piden por separado y es la
 * misma respuesta.
 */
export const contextoDeMiEmpresa = cache(async (): Promise<ContextoDeEmpresa> => {
  const sesion = await sesionActual();
  const data = sesion.estado === "activa" ? sesion.contexto : null;
  if (!data || typeof data !== "object") {
    if (sesion.estado === "activa") console.error("[empresa] no se pudo leer el contexto de la empresa");
    return { edicion: "center", modulos: [], empresas: [], empresa: null, duenio: false };
  }
  const contexto = data as {
    edicion?: unknown;
    modulos?: unknown;
    empresas?: unknown;
    empresa?: unknown;
    duenio?: unknown;
  };
  return {
    edicion: parseEdicion(contexto.edicion),
    modulos: soloModulos(contexto.modulos),
    empresas: Array.isArray(contexto.empresas) ? (contexto.empresas as EmpresaDisponible[]) : [],
    empresa: typeof contexto.empresa === "string" ? contexto.empresa : null,
    duenio: contexto.duenio === true,
  };
});

/**
 * Puede leer el contenido de las conversaciones: ejecutivos y supervisión por
 * su rol, y el dueño de la plataforma aunque sea admin. Administración no lee
 * mensajes; el dueño sí, para mostrar y auditar el producto. Leer no es
 * atender: responder sigue siendo del ejecutivo asignado.
 */
export async function puedeLeerConversaciones(role: AppRole): Promise<boolean> {
  if (getWorkspacePermissions(role).canReadConversationContent) return true;
  return (await contextoDeMiEmpresa()).duenio;
}

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
