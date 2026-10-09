"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { fichaToFields } from "@/lib/bigdata-ficha";
import { fichaBigdata } from "@/lib/bigdata-ficha-remota";
import { normalizeChilePhone } from "@/lib/chile-phone";
import { mensajeDeError } from "@/lib/errores-de-accion";
import { formatRut, isValidRut } from "@/lib/rut";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { esMotivo, esResultado, type DatosCliente, type Etapa } from "@/lib/terreno";

/** Lo que el vendedor ve al buscar un RUT antes de crear el cliente. */
export type BusquedaRut =
  | { ok: false; message: string }
  | {
      ok: true;
      rut: string;
      /** Ya está en la campaña: si es suyo se abre; si es de otro, se avisa. */
      enCampana: { leadId: string; propio: boolean; vendedor: string | null; etapa: Etapa | null; nombre: string } | null;
      /** Datos propuestos, de Atlas primero y Bigdata para lo que falte. */
      propuesta: Partial<DatosCliente>;
      fuente: "atlas" | "bigdata" | "atlas_y_bigdata" | null;
      /** Bigdata no respondió: se dice para que el vendedor no espere datos. */
      avisoBigdata: string | null;
    };

type Resultado = { ok: true; leadId: string; duplicate?: boolean } | { ok: false; message: string };

const ROLES = ["agente", "supervisor", "admin"] as const;

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function telefonoOpcional(value: string): string | null {
  if (!value) return null;
  try {
    return normalizeChilePhone(value);
  } catch {
    throw new Error("El teléfono no es un número chileno válido. Ejemplo: +56 9 1234 5678.");
  }
}

function rutOpcional(value: string): string | null {
  if (!value) return null;
  if (!isValidRut(value)) throw new Error("El RUT no es válido: revisa los números y el dígito verificador.");
  return formatRut(value);
}

function detalle(datos: Partial<DatosCliente>, completadoCon?: string | null) {
  return {
    nombre_contacto: texto(datos.nombre_contacto) || null,
    rubro: texto(datos.rubro) || null,
    direccion: texto(datos.direccion) || null,
    comuna: texto(datos.comuna) || null,
    region: texto(datos.region) || null,
    completado_con: completadoCon === "bigdata" || completadoCon === "atlas" ? completadoCon : null,
  };
}

function revalidarTerreno(leadId?: string) {
  revalidatePath("/terreno");
  revalidatePath("/terreno/avance");
  if (leadId) revalidatePath(`/terreno/clientes/${leadId}`);
}

/**
 * Busca un RUT para el vendedor: si ya está en la campaña, y lo que Atlas y
 * Bigdata saben de él. Atlas manda; Bigdata solo rellena lo vacío. Bigdata se
 * consulta solo si el vendedor pertenece a la campaña (lo valida la RPC antes).
 */
export async function buscarRutTerreno(campaignId: string, rutInput: string): Promise<BusquedaRut> {
  await requireProfile([...ROLES]);
  if (!isValidRut(rutInput)) return { ok: false, message: "RUT inválido: revisa el dígito verificador." };
  const rut = formatRut(rutInput);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("terreno_buscar_rut", { p_campaign_id: campaignId, p_rut: rut });
  if (error) return { ok: false, message: mensajeDeError(error) };

  const respuesta = (data ?? {}) as {
    en_campana?: { lead_id: string; propio: boolean | null; vendedor: string | null; etapa: Etapa | null; nombre: string } | null;
    atlas?: Record<string, string> | null;
  };
  const enCampana = respuesta.en_campana
    ? {
        leadId: respuesta.en_campana.lead_id,
        propio: respuesta.en_campana.propio === true,
        vendedor: respuesta.en_campana.vendedor,
        etapa: respuesta.en_campana.etapa,
        nombre: respuesta.en_campana.nombre,
      }
    : null;
  // Ya está en la campaña: no hace falta gastar una consulta a Bigdata.
  if (enCampana) return { ok: true, rut, enCampana, propuesta: {}, fuente: null, avisoBigdata: null };

  const atlas = respuesta.atlas ?? {};
  const propuesta: Partial<DatosCliente> = {
    full_name: atlas.full_name,
    phone: atlas.phone,
    email: atlas.email,
    nombre_contacto: atlas.nombre_contacto,
    rubro: atlas.rubro,
    direccion: atlas.direccion,
    comuna: atlas.comuna,
    region: atlas.region,
  };
  const hayAtlas = Object.values(propuesta).some(Boolean);

  const bigdata = await fichaBigdata(rut);
  let hayBigdata = false;
  if (bigdata.estado === "encontrado") {
    const campos = fichaToFields(bigdata.ficha);
    const desdeBigdata: Partial<DatosCliente> = {
      full_name: campos.full_name,
      phone: campos.phone,
      email: campos.email,
      nombre_contacto: campos.contact_name,
      rubro: campos.rubro,
      direccion: campos.direccion,
      comuna: campos.comuna,
      region: campos.region,
    };
    for (const [clave, valor] of Object.entries(desdeBigdata) as [keyof DatosCliente, string][]) {
      if (valor && !propuesta[clave]) {
        propuesta[clave] = valor;
        hayBigdata = true;
      }
    }
  }

  return {
    ok: true,
    rut,
    enCampana: null,
    propuesta,
    fuente: hayAtlas && hayBigdata ? "atlas_y_bigdata" : hayAtlas ? "atlas" : hayBigdata ? "bigdata" : null,
    avisoBigdata: bigdata.estado === "no_disponible" ? bigdata.motivo : null,
  };
}

export async function crearClienteTerreno(
  campaignId: string,
  datos: DatosCliente,
  completadoCon?: string | null,
): Promise<Resultado> {
  try {
    await requireProfile([...ROLES]);
    const nombre = texto(datos.full_name);
    if (!nombre) return { ok: false, message: "Escribe el nombre del comercio o de la persona." };

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("terreno_crear_cliente", {
      p_campaign_id: campaignId,
      p_full_name: nombre,
      p_rut: rutOpcional(texto(datos.rut)),
      p_phone: telefonoOpcional(texto(datos.phone)),
      p_email: texto(datos.email) || null,
      p_detalle: detalle(datos, completadoCon),
    });
    if (error) return { ok: false, message: mensajeDeError(error) };

    const { lead_id: leadId, duplicate } = (data ?? {}) as { lead_id?: string; duplicate?: boolean };
    if (!leadId) return { ok: false, message: "No se pudo crear el cliente." };
    revalidarTerreno(leadId);
    return { ok: true, leadId, duplicate: duplicate === true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo crear el cliente." };
  }
}

export async function actualizarClienteTerreno(leadId: string, datos: DatosCliente): Promise<Resultado> {
  try {
    await requireProfile([...ROLES]);
    const nombre = texto(datos.full_name);
    if (!nombre) return { ok: false, message: "Escribe el nombre del comercio o de la persona." };

    const supabase = await createClient();
    const { error } = await supabase.rpc("terreno_actualizar_cliente", {
      p_lead_id: leadId,
      p_full_name: nombre,
      p_rut: rutOpcional(texto(datos.rut)),
      p_phone: telefonoOpcional(texto(datos.phone)),
      p_email: texto(datos.email) || null,
      p_detalle: detalle(datos),
    });
    if (error) return { ok: false, message: mensajeDeError(error) };
    revalidarTerreno(leadId);
    return { ok: true, leadId };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudieron guardar los datos." };
  }
}

const FOTO_MAX_BYTES = 5 * 1024 * 1024;
const FOTO_TIPOS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function numero(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Registra una visita. La foto la sube el servidor (bucket privado) solo
 * después de comprobar, con la sesión del vendedor, que el cliente es suyo;
 * si la RPC rechaza la visita, la foto se borra.
 */
export async function registrarVisitaTerreno(formData: FormData): Promise<Resultado> {
  const profile = await requireProfile([...ROLES]);
  const leadId = texto(formData.get("lead_id"));
  const etapa = texto(formData.get("etapa"));
  const motivo = texto(formData.get("motivo"));
  const foto = formData.get("foto");

  if (!leadId) return { ok: false, message: "Falta el cliente." };
  if (!esResultado(etapa)) return { ok: false, message: "Elige el resultado de la visita." };
  if (etapa === "descartado" && !esMotivo(motivo)) return { ok: false, message: "Indica por qué no sigue." };
  if (!(foto instanceof File) || foto.size === 0) return { ok: false, message: "Falta la foto de la visita." };
  const extension = FOTO_TIPOS[foto.type];
  if (!extension) return { ok: false, message: "La foto debe ser JPG, PNG o WebP." };
  if (foto.size > FOTO_MAX_BYTES) return { ok: false, message: "La foto pesa más de 5 MB. Toma otra." };

  const supabase = await createClient();
  const { data: ficha, error: fichaError } = await supabase
    .from("terreno_fichas")
    .select("organization_id, vendedor_id")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (fichaError) return { ok: false, message: mensajeDeError(fichaError) };
  if (!ficha || ficha.vendedor_id !== profile.id) {
    return { ok: false, message: "Solo el vendedor del cliente registra sus visitas." };
  }

  const fotoPath = `${ficha.organization_id}/${leadId}/${new Date().toISOString().slice(0, 10)}-${randomUUID()}.${extension}`;
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from("terreno-visitas")
    .upload(fotoPath, foto, { contentType: foto.type, upsert: false });
  if (uploadError) {
    console.error("[terreno] no se pudo subir la foto", uploadError.message);
    return { ok: false, message: "No se pudo subir la foto. Revisa la señal e inténtalo de nuevo." };
  }

  const lat = numero(formData.get("lat"));
  const lng = numero(formData.get("lng"));
  const posCantidad = numero(formData.get("pos_cantidad"));
  const proximaTexto = texto(formData.get("proxima_at"));
  const proxima = proximaTexto ? new Date(proximaTexto) : null;
  if (proxima && Number.isNaN(proxima.getTime())) return { ok: false, message: "La fecha de la próxima visita no es válida." };
  const { error } = await supabase.rpc("terreno_registrar_visita", {
    p_lead_id: leadId,
    p_etapa: etapa,
    p_motivo_salida: etapa === "descartado" ? motivo : null,
    p_nota: texto(formData.get("nota")) || null,
    p_lat: lat,
    p_lng: lng,
    p_precision_m: numero(formData.get("precision_m")) === null ? null : Math.round(numero(formData.get("precision_m"))!),
    p_sin_ubicacion: lat === null || lng === null ? texto(formData.get("sin_ubicacion")) || null : null,
    p_foto_path: fotoPath,
    p_pos_cantidad: etapa === "vendido" && posCantidad !== null ? Math.round(posCantidad) : null,
    p_pos_modelo: etapa === "vendido" ? texto(formData.get("pos_modelo")) || null : null,
    p_proxima_at: etapa === "vendido" || etapa === "descartado" ? null : (proxima?.toISOString() ?? null),
  });
  if (error) {
    await admin.storage.from("terreno-visitas").remove([fotoPath]);
    return { ok: false, message: mensajeDeError(error) };
  }

  revalidarTerreno(leadId);
  return { ok: true, leadId };
}
