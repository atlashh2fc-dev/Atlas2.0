"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/*
 * Materiales e insumos de la clínica, y la receta de cada procedimiento.
 * Se editan con la sesión de administración: la seguridad por fila decide la
 * empresa. Lo ya usado en atenciones no cambia: guarda el costo de ese día.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function texto(formData: FormData, campo: string, largo = 120): string | null {
  const valor = String(formData.get(campo) ?? "").trim().slice(0, largo);
  return valor === "" ? null : valor;
}

/** Montos en pesos: solo dígitos. */
function monto(formData: FormData, campo: string): number | null {
  const bruto = String(formData.get(campo) ?? "").replace(/[^\d]/g, "");
  return bruto === "" ? null : Number(bruto);
}

/** Cantidades: admiten decimales con coma o punto. */
function cantidad(valor: FormDataEntryValue | null): number | null {
  const bruto = String(valor ?? "").trim().replace(",", ".");
  if (bruto === "") return null;
  const numero = Number(bruto);
  if (!Number.isFinite(numero) || numero < 0 || numero > 1_000_000) throw new Error("Revisa las cantidades.");
  return Math.round(numero * 100) / 100;
}

function revalidar() {
  revalidatePath("/dashboard/admin/insumos");
  revalidatePath("/dashboard/admin/aranceles");
}

export async function guardarInsumo(formData: FormData) {
  await requireProfile(["admin"]);
  const id = texto(formData, "id") ?? "";
  if (!UUID.test(id)) throw new Error("Material inválido.");
  const precio = monto(formData, "precio_venta");
  const cobrable = formData.get("cobrable") === "si";
  if (cobrable && !precio) throw new Error("Para cobrarlo aparte, ponle precio de venta.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("insumos")
    .update({
      costo: monto(formData, "costo") ?? 0,
      precio_venta: precio,
      cobrable,
      stock: cantidad(formData.get("stock")),
      stock_minimo: cantidad(formData.get("stock_minimo")),
      activo: formData.getAll("activo").includes("si"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidar();
}

export async function crearInsumo(formData: FormData) {
  await requireProfile(["admin"]);
  const nombre = texto(formData, "nombre");
  if (!nombre || nombre.length < 2) throw new Error("Escribe el nombre del material.");
  const precio = monto(formData, "precio_venta");
  const cobrable = formData.get("cobrable") === "si";
  if (cobrable && !precio) throw new Error("Para cobrarlo aparte, ponle precio de venta.");

  const supabase = await createClient();
  const { data: empresa, error: sinEmpresa } = await supabase.rpc("current_org_id");
  if (sinEmpresa || !empresa) throw new Error("Elige una empresa antes de editar los materiales.");

  const codigo = `${nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40)}_${Date.now().toString(36).slice(-4)}`;

  const { error } = await supabase.from("insumos").insert({
    organization_id: empresa,
    codigo,
    nombre,
    categoria: texto(formData, "categoria", 60),
    unidad: texto(formData, "unidad", 30) ?? "unidad",
    costo: monto(formData, "costo") ?? 0,
    precio_venta: precio,
    cobrable,
    stock: cantidad(formData.get("stock")),
    stock_minimo: cantidad(formData.get("stock_minimo")),
  });
  if (error) throw new Error(error.message);
  revalidar();
}

/** Reemplaza la receta de un procedimiento por la que viene del formulario. */
export async function guardarReceta(formData: FormData) {
  await requireProfile(["admin"]);
  const producto = texto(formData, "producto_id") ?? "";
  if (!UUID.test(producto)) throw new Error("Procedimiento inválido.");
  const insumos = formData.getAll("insumo_id").map(String);
  const cantidades = formData.getAll("cantidad");
  if (insumos.length > 60 || insumos.length !== cantidades.length) throw new Error("Receta inválida.");

  const lineas = new Map<string, number>();
  insumos.forEach((insumo, indice) => {
    if (!UUID.test(insumo)) throw new Error("Material inválido.");
    const valor = cantidad(cantidades[indice]);
    if (valor && valor > 0) lineas.set(insumo, valor);
  });

  const supabase = await createClient();
  const { data: procedimiento } = await supabase.from("sales_products").select("organization_id").eq("id", producto).maybeSingle();
  if (!procedimiento) throw new Error("No encontramos ese procedimiento.");

  const { error: borrado } = await supabase.from("procedimiento_insumos").delete().eq("producto_id", producto);
  if (borrado) throw new Error(borrado.message);
  if (lineas.size > 0) {
    const { error } = await supabase.from("procedimiento_insumos").insert(
      [...lineas.entries()].map(([insumo, valor]) => ({
        producto_id: producto,
        insumo_id: insumo,
        organization_id: procedimiento.organization_id,
        cantidad: valor,
      })),
    );
    if (error) throw new Error(error.message);
  }
  revalidar();
}
