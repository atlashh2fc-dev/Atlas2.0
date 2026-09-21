"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { APLICA_A } from "@/lib/arancel";
import { ESTADOS, SUPERFICIES, piezaPorNumero } from "@/lib/odontograma";
import { createClient } from "@/lib/supabase/server";

/*
 * Atenciones y arancel.
 *
 * Registrar una atención pasa por `registrar_atencion`, que en una transacción
 * guarda la atención, actualiza el odontograma si el procedimiento lo cambia y
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

/** Los materiales vienen como JSON desde el formulario; ausentes = la receta. */
function materiales(formData: FormData) {
  const bruto = formData.get("insumos");
  if (bruto === null) return null;
  let lista: unknown;
  try {
    lista = JSON.parse(String(bruto));
  } catch {
    throw new Error("Materiales inválidos.");
  }
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

export async function registrarAtencion(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const cuenta = texto(formData, "cuenta_id") ?? "";
  const producto = texto(formData, "producto_id") ?? "";
  const mascota = texto(formData, "mascota_id");
  const fecha = texto(formData, "fecha");
  const piezaTexto = texto(formData, "pieza");
  const pieza = piezaTexto ? piezaPorNumero(Number(piezaTexto)) : null;

  if (!UUID.test(cuenta)) throw new Error("Ficha inválida.");
  if (!UUID.test(producto)) throw new Error("Elige el procedimiento.");
  if (mascota && !UUID.test(mascota)) throw new Error("Mascota inválida.");
  if (piezaTexto && !pieza) throw new Error("Pieza inválida.");
  if (fecha && !FECHA.test(fecha)) throw new Error("Fecha inválida.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("registrar_atencion", {
    p_cuenta: cuenta,
    p_producto: producto,
    p_precio: monto(formData, "precio"),
    p_pieza: pieza?.numero ?? null,
    p_superficies: formData.getAll("superficies").map(String).filter((valor) => (SUPERFICIES as readonly string[]).includes(valor)),
    p_mascota: mascota,
    p_region: texto(formData, "region", 80),
    p_profesional: texto(formData, "profesional", 120),
    p_nota: texto(formData, "nota", 1000),
    p_fecha: fecha,
    p_actualizar_odontograma: formData.get("actualizar_odontograma") !== "no",
    p_pagado: formData.get("pagado") === "si",
    p_insumos: materiales(formData),
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
