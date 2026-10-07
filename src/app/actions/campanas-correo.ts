"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import type { CampanaDetalle, ConteoAudiencia, DatosCampana, FiltrosAudiencia, OpcionesAudiencia, Programacion } from "@/lib/campanas-correo";
import {
  atlasLead,
  conteoDeAudiencia,
  empresaActual,
  opcionesDeAudiencia,
  paginaDeAudiencia,
  type FilaDeAudiencia,
} from "@/lib/campanas-correo.server";
import { modulosActivos } from "@/lib/modules.server";

/*
 * Lo que se hace con una campaña de correo desde el CRM. Atlas Lead valida el
 * contenido, la versión y el estado; acá se comprueba quién pide y para qué
 * empresa, y se le pasa el actor para el registro de la campaña.
 */

type Ok<T> = { ok: true } & T;
type Falla = { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUTA = "/dashboard/campanas-correo";

async function contexto(roles: ("admin" | "supervisor")[] = ["admin", "supervisor"], conBigdata = false) {
  const perfil = await requireProfile(roles);
  const modulos = await modulosActivos();
  if (!modulos.includes("correo")) {
    throw new Error("Esta empresa no tiene Campañas de correo contratado.");
  }
  // La audiencia sale de la base de Bigdata: solo para quien la tiene contratada.
  if (conBigdata && !modulos.includes("bigdata")) {
    throw new Error("La audiencia sale de Bigdata, y esta empresa no lo tiene contratado.");
  }
  const empresa = await empresaActual();
  if (!empresa) throw new Error("No se pudo identificar la empresa que estás mirando.");
  return { empresa, actor: { tipo: "persona" as const, id: perfil.id, nombre: perfil.full_name } };
}

function falla(error: unknown): Falla {
  // Un redirect de sesión vencida o rol sin permiso tiene que llegar al navegador, no a un toast.
  unstable_rethrow(error);
  return { ok: false, error: error instanceof Error ? error.message : "No se pudo completar la operación." };
}

/** Conecta la empresa a Atlas Lead (la crea allá si no existe). Solo administración. */
export async function conectarAtlasLead(): Promise<Ok<object> | Falla> {
  try {
    const { empresa } = await contexto(["admin"]);
    const resultado = await atlasLead(empresa.slug, "conectar", { nombre: empresa.nombre });
    if (!resultado.ok) return { ok: false, error: `No se pudo conectar con Atlas Lead: ${resultado.error}` };
    revalidatePath(RUTA);
    revalidatePath("/dashboard/admin/integraciones");
    return { ok: true };
  } catch (error) {
    return falla(error);
  }
}

export async function guardarCampanaCorreo(input: {
  campanaId?: string;
  version?: number;
  datos: DatosCampana;
}): Promise<Ok<{ campana: CampanaDetalle }> | Falla> {
  try {
    const { empresa, actor } = await contexto();
    if (input.campanaId && !UUID.test(input.campanaId)) return { ok: false, error: "Campaña inválida." };
    const resultado = await atlasLead<{ campana: CampanaDetalle }>(empresa.slug, "guardar", {
      campana_id: input.campanaId,
      version: input.version,
      actor,
      datos: input.datos,
    });
    if (!resultado.ok) return { ok: false, error: resultado.error };
    revalidatePath(RUTA);
    return { ok: true, campana: resultado.datos.campana };
  } catch (error) {
    return falla(error);
  }
}

/** Nombre, límite diario y programación, sin tocar los correos (se puede con la campaña enviando). */
export async function ajustarCampanaCorreo(input: {
  campanaId: string;
  version?: number;
  nombre?: string;
  limiteDiario?: number | null;
  programacion?: Programacion | null;
}): Promise<Ok<{ campana: CampanaDetalle }> | Falla> {
  try {
    const { empresa, actor } = await contexto();
    if (!UUID.test(input.campanaId)) return { ok: false, error: "Campaña inválida." };
    const resultado = await atlasLead<{ campana: CampanaDetalle }>(empresa.slug, "ajustar", {
      campana_id: input.campanaId,
      version: input.version,
      actor,
      nombre: input.nombre,
      limite_diario: input.limiteDiario,
      programacion: input.programacion,
    });
    if (!resultado.ok) return { ok: false, error: resultado.error };
    revalidatePath(RUTA);
    revalidatePath(`${RUTA}/${input.campanaId}`);
    return { ok: true, campana: resultado.datos.campana };
  } catch (error) {
    return falla(error);
  }
}

export async function vistaPreviaCorreo(input: {
  campanaId?: string;
  paso: number;
  borrador?: Partial<DatosCampana>;
}): Promise<Ok<{ html: string; asunto: string; empresaEjemplo: string }> | Falla> {
  try {
    const { empresa } = await contexto();
    const resultado = await atlasLead<{ html: string; asunto: string; empresa_ejemplo: string }>(empresa.slug, "vista_previa", {
      campana_id: input.campanaId,
      paso: Math.max(0, Math.min(4, Math.floor(input.paso))),
      borrador: input.borrador,
    });
    if (!resultado.ok) return { ok: false, error: resultado.error };
    return { ok: true, html: resultado.datos.html, asunto: resultado.datos.asunto, empresaEjemplo: resultado.datos.empresa_ejemplo };
  } catch (error) {
    return falla(error);
  }
}

export async function enviarPruebaCorreo(input: {
  campanaId: string;
  destinatarios: { nombre: string; email: string }[];
}): Promise<Ok<{ enviados: number; fallidos: number; resultados: { email: string; paso: number; ok: boolean; error: string | null }[] }> | Falla> {
  try {
    const { empresa, actor } = await contexto();
    if (!UUID.test(input.campanaId)) return { ok: false, error: "Campaña inválida." };
    const destinatarios = input.destinatarios
      .map((item) => ({ nombre: item.nombre.trim() || item.email.trim(), email: item.email.trim().toLowerCase() }))
      .filter((item) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(item.email));
    if (!destinatarios.length) return { ok: false, error: "Escribe al menos un correo para la prueba." };
    const resultado = await atlasLead<{ enviados: number; fallidos: number; resultados: { email: string; paso: number; ok: boolean; error: string | null }[] }>(
      empresa.slug,
      "prueba",
      { campana_id: input.campanaId, actor, destinatarios },
    );
    if (!resultado.ok) return { ok: false, error: resultado.error };
    revalidatePath(`${RUTA}/${input.campanaId}`);
    return { ok: true, ...resultado.datos };
  } catch (error) {
    return falla(error);
  }
}

/**
 * Lanzar, pausar, reanudar o cancelar. Devuelve el motivo en vez de lanzar:
 * en producción Next oculta el mensaje de un error de server action, y el
 * motivo de Atlas Lead («carga la audiencia», «la fecha de término ya pasó») es
 * justo lo que la persona necesita leer.
 */
export async function cambiarEstadoCampanaCorreo(input: { campanaId: string; accion: "lanzar" | "pausar" | "reanudar" | "cancelar" }): Promise<Ok<object> | Falla> {
  try {
    const { empresa, actor } = await contexto();
    if (!UUID.test(input.campanaId)) return { ok: false, error: "Campaña inválida." };
    if (!["lanzar", "pausar", "reanudar", "cancelar"].includes(input.accion)) return { ok: false, error: "Acción inválida." };
    const resultado = await atlasLead(empresa.slug, "estado", { campana_id: input.campanaId, accion: input.accion, actor });
    if (!resultado.ok) return { ok: false, error: resultado.error };
    revalidatePath(RUTA);
    revalidatePath(`${RUTA}/${input.campanaId}`);
    return { ok: true };
  } catch (error) {
    return falla(error);
  }
}

/** URL firmada para que el navegador suba la imagen directo a Atlas Lead. */
export async function prepararSubidaDeImagen(input: { nombre: string; tipo: string; bytes: number }): Promise<Ok<{ subidaUrl: string; urlPublica: string; clavePublica: string | null }> | Falla> {
  try {
    const { empresa } = await contexto();
    const resultado = await atlasLead<{ subida_url: string; url_publica: string; clave_publica: string | null }>(empresa.slug, "imagen", {
      nombre: input.nombre,
      tipo: input.tipo,
      bytes: input.bytes,
    });
    if (!resultado.ok) return { ok: false, error: resultado.error };
    return { ok: true, subidaUrl: resultado.datos.subida_url, urlPublica: resultado.datos.url_publica, clavePublica: resultado.datos.clave_publica };
  } catch (error) {
    return falla(error);
  }
}

// ---------------------------------------------------------------------------
// Audiencia desde Bigdata

function limpiarFiltros(filtros: FiltrosAudiencia): FiltrosAudiencia {
  const lista = (valores?: string[]) => (valores?.length ? valores.slice(0, 200) : undefined);
  return {
    regiones: lista(filtros.regiones),
    comunas: lista(filtros.comunas),
    rubros: lista(filtros.rubros),
    tamanos: lista(filtros.tamanos),
    cargos: lista(filtros.cargos),
    trabajadores_min: typeof filtros.trabajadores_min === "number" ? filtros.trabajadores_min : undefined,
    trabajadores_max: typeof filtros.trabajadores_max === "number" ? filtros.trabajadores_max : undefined,
    solo_activas: filtros.solo_activas ?? true,
    excluir_clientes_equifax: filtros.excluir_clientes_equifax ?? false,
    contacto: filtros.contacto ?? "ambos",
    nombre_contiene: filtros.nombre_contiene?.trim() || undefined,
  };
}

export async function opcionesDeAudienciaCorreo(filtros: FiltrosAudiencia): Promise<Ok<{ opciones: OpcionesAudiencia }> | Falla> {
  try {
    await contexto(undefined, true);
    const resultado = await opcionesDeAudiencia(limpiarFiltros(filtros));
    return resultado.ok ? { ok: true, opciones: resultado.datos } : { ok: false, error: resultado.error };
  } catch (error) {
    return falla(error);
  }
}

export async function contarAudienciaCorreo(filtros: FiltrosAudiencia): Promise<Ok<{ conteo: ConteoAudiencia }> | Falla> {
  try {
    await contexto(undefined, true);
    const resultado = await conteoDeAudiencia(limpiarFiltros(filtros));
    return resultado.ok ? { ok: true, conteo: resultado.datos } : { ok: false, error: resultado.error };
  } catch (error) {
    return falla(error);
  }
}

const POR_PAGINA = 500;

/** Un campo largo de Bigdata no puede tumbar la página entera: se recorta a lo que acepta Atlas Lead. */
function corto(valor: string | null | undefined, largo: number): string | null {
  const limpio = valor?.replace(/\s+/g, " ").trim();
  return limpio ? limpio.slice(0, largo) : null;
}

function aContacto(fila: FilaDeAudiencia) {
  return {
    email: fila.email.trim().toLowerCase().slice(0, 254),
    nombre: corto(fila.nombre, 160),
    empresa: corto(fila.empresa, 240),
    rut: corto(fila.rut, 20),
    cargo: corto(fila.cargo, 160),
    telefono: corto(fila.telefono, 40),
    region: corto(fila.region, 120),
    comuna: corto(fila.comuna, 120),
    rubro: corto(fila.rubro, 240),
    referencia: corto(fila.referencia, 120),
  };
}

/**
 * Un tramo de la carga de audiencia: trae una página de Bigdata y se la
 * entrega a Atlas Lead. La pantalla lo llama en bucle mostrando el avance; el
 * último tramo deja la audiencia asignada a la campaña. Así ninguna llamada
 * se acerca al límite de tiempo, aunque la audiencia sea de miles.
 */
export async function transferirAudienciaCorreo(input: {
  campanaId: string;
  filtros: FiltrosAudiencia;
  despues: string | null;
  loteId: string | null;
  cargados: number;
  maximo: number;
  nombre: string;
}): Promise<
  | Ok<{ loteId: string; despues: string | null; cargados: number; terminado: boolean; totalLote: number; dadosDeBaja: number; bloqueados: number }>
  | Falla
> {
  try {
    const { empresa, actor } = await contexto(undefined, true);
    if (!UUID.test(input.campanaId)) return { ok: false, error: "Campaña inválida." };
    const filtros = limpiarFiltros(input.filtros);
    const maximo = Math.max(1, Math.min(50_000, Math.floor(input.maximo)));
    const restante = maximo - input.cargados;
    const limite = Math.max(1, Math.min(POR_PAGINA, restante));

    const pagina = await paginaDeAudiencia(filtros, input.despues, limite);
    if (!pagina.ok) return { ok: false, error: pagina.error };

    const cargados = input.cargados + pagina.datos.filas.length;
    const terminado = !pagina.datos.siguiente || cargados >= maximo;
    const entrega = await atlasLead<{ lote_id: string; total_lote: number; dados_de_baja: number }>(empresa.slug, "audiencia", {
      campana_id: input.campanaId,
      actor,
      lote_id: input.loteId,
      nombre: input.nombre.slice(0, 160),
      origen: { fuente: "bigdata", filtros, maximo },
      contactos: pagina.datos.filas.map(aContacto),
      finalizar: terminado,
    });
    if (!entrega.ok) return { ok: false, error: entrega.error };

    if (terminado) {
      revalidatePath(RUTA);
      revalidatePath(`${RUTA}/${input.campanaId}`);
    }
    return {
      ok: true,
      loteId: entrega.datos.lote_id,
      despues: pagina.datos.siguiente,
      cargados,
      terminado,
      totalLote: entrega.datos.total_lote,
      dadosDeBaja: entrega.datos.dados_de_baja,
      bloqueados: pagina.datos.bloqueados ?? 0,
    };
  } catch (error) {
    return falla(error);
  }
}
