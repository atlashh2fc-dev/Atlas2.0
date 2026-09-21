"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { APLICA_A } from "@/lib/arancel";
import { ESTADOS, SUPERFICIES, piezaPorNumero } from "@/lib/odontograma";
import { createClient } from "@/lib/supabase/server";

/*
 * Atenciones y arancel.
 *
 * Una visita pasa por `registrar_atenciones`, que en una transacción guarda
 * cada procedimiento con sus materiales, actualiza el odontograma si el procedimiento lo cambia y
 * deja la línea en la historia de la ficha. El arancel se edita con la sesión
 * de quien administra: la seguridad por fila decide la empresa.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function texto(formData: FormData, campo: string, largo = 400): string | null {
  const valor = String(formData.get(campo) ?? "").trim().slice(0, largo);
  return valor === "" ? null : valor;
}

function monto(formData: FormData, campo: string): number | null {
  const bruto = String(formData.get(campo) ?? "").replace(/[^\d]/g, "");
  return bruto === "" ? null : Number(bruto);
}

/** Valida la lista de materiales usados; ausente = la receta del procedimiento. */
function validarMateriales(lista: unknown) {
  if (lista === undefined || lista === null) return null;
  if (!Array.isArray(lista) || lista.length > 60) throw new Error("Materiales inválidos.");
  return lista.map((item) => {
    const { insumo_id, cantidad, cobrar } = (item ?? {}) as Record<string, unknown>;
    const numero = Number(cantidad);
    if (typeof insumo_id !== "string" || !UUID.test(insumo_id) || !Number.isFinite(numero) || numero <= 0 || numero > 10000) {
      throw new Error("Revisa las cantidades de materiales.");
    }
    return { insumo_id, cantidad: Math.round(numero * 100) / 100, cobrar: cobrar !== false };
  });
}

/**
 * Una visita con varios procedimientos: cada línea con su pieza, superficies,
 * precio y materiales. Se registran juntas en una transacción.
 */
export async function registrarAtenciones(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const cuenta = texto(formData, "cuenta_id") ?? "";
  const mascota = texto(formData, "mascota_id");
  const fecha = texto(formData, "fecha");
  if (!UUID.test(cuenta)) throw new Error("Ficha inválida.");
  if (mascota && !UUID.test(mascota)) throw new Error("Mascota inválida.");
  if (fecha && !FECHA.test(fecha)) throw new Error("Fecha inválida.");

  let lineas: unknown;
  try {
    lineas = JSON.parse(String(formData.get("lineas") ?? "[]"));
  } catch {
    throw new Error("Procedimientos inválidos.");
  }
  if (!Array.isArray(lineas) || lineas.length === 0) throw new Error("Agrega al menos un procedimiento.");
  if (lineas.length > 40) throw new Error("Demasiados procedimientos en una sola atención.");

  const items = lineas.map((linea) => {
    const { producto_id, precio, pieza, superficies, insumos } = (linea ?? {}) as Record<string, unknown>;
    if (typeof producto_id !== "string" || !UUID.test(producto_id)) throw new Error("Procedimiento inválido.");
    const numeroPieza = pieza === null || pieza === undefined || pieza === "" ? null : Number(pieza);
    if (numeroPieza !== null && !piezaPorNumero(numeroPieza)) throw new Error(`La pieza ${String(pieza)} no existe.`);
    const monto = precio === null || precio === undefined || precio === "" ? null : Number(precio);
    if (monto !== null && (!Number.isFinite(monto) || monto < 0 || monto > 1_000_000_000)) throw new Error("Revisa los precios.");
    return {
      producto_id,
      precio: monto === null ? null : Math.round(monto),
      pieza: numeroPieza,
      superficies: Array.isArray(superficies)
        ? superficies.map(String).filter((valor) => (SUPERFICIES as readonly string[]).includes(valor))
        : [],
      insumos: validarMateriales(insumos),
    };
  });

  const supabase = await createClient();
  const { error } = await supabase.rpc("registrar_atenciones", {
    p_cuenta: cuenta,
    p_items: items,
    p_mascota: mascota,
    p_region: texto(formData, "region", 80),
    p_profesional: texto(formData, "profesional", 120),
    p_nota: texto(formData, "nota", 1000),
    p_fecha: fecha,
    p_actualizar_odontograma: formData.get("actualizar_odontograma") !== "no",
    p_pagado: formData.get("pagado") === "si",
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/pacientes/${cuenta}`);
}

export async function marcarAtencionPagada(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const atencion = texto(formData, "atencion_id") ?? "";
  const cuenta = texto(formData, "cuenta_id") ?? "";
  if (!UUID.test(atencion) || !UUID.test(cuenta)) throw new Error("Atención inválida.");
  const pagado = formData.get("pagado") === "si";

  const supabase = await createClient();
  const { error } = await supabase.from("atenciones").update({ pagado }).eq("id", atencion);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/pacientes/${cuenta}`);
}

export async function guardarProcedimiento(formData: FormData) {
  await requireProfile(["admin"]);
  const id = texto(formData, "id") ?? "";
  if (!UUID.test(id)) throw new Error("Procedimiento inválido.");
  const precio = monto(formData, "precio");
  const duracion = monto(formData, "duracion");

  const supabase = await createClient();
  const { error } = await supabase
    .from("sales_products")
    .update({
      one_time_price: precio,
      duracion_min: duracion,
      es_urgencia: formData.get("urgencia") === "si",
      // El checkbox va con un oculto "no" delante: marcado, llegan los dos.
      active: formData.getAll("activo").includes("si"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/aranceles");
}

export async function crearProcedimiento(formData: FormData) {
  await requireProfile(["admin"]);
  const nombre = texto(formData, "nombre", 120);
  const categoria = texto(formData, "categoria", 60);
  const aplica = texto(formData, "aplica_a") ?? "boca";
  const resultado = texto(formData, "resultado");
  if (!nombre || nombre.length < 3) throw new Error("Escribe el nombre del procedimiento.");
  if (!categoria) throw new Error("Elige la categoría.");
  if (!(APLICA_A as readonly string[]).includes(aplica)) throw new Error("Elige a qué se aplica.");
  if (resultado && !(ESTADOS as readonly string[]).includes(resultado)) throw new Error("Resultado inválido.");

  const supabase = await createClient();
  const { data: empresa, error: sinEmpresa } = await supabase.rpc("current_org_id");
  if (sinEmpresa || !empresa) throw new Error("Elige una empresa antes de editar el arancel.");

  const codigo = `${nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40)}_${Date.now().toString(36).slice(-4)}`;

  const { error } = await supabase.from("sales_products").insert({
    organization_id: empresa,
    code: codigo,
    name: nombre,
    one_time_price: monto(formData, "precio"),
    duracion_min: monto(formData, "duracion"),
    categoria,
    aplica_a: aplica,
    es_urgencia: formData.get("urgencia") === "si" || categoria === "Urgencias",
    resultado_odontograma: resultado,
    orden: 500,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/aranceles");
}
