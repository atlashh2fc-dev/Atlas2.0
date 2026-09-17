import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Entrada de negocios desde altiusignite.com.
 *
 * El sitio avisa cuando alguien agenda una reunión, pide un plan de Atlas Pulso,
 * corre el diagnóstico o escribe por el formulario. Acá eso se convierte en un
 * negocio del embudo, con su próxima acción.
 *
 * La firma es HMAC sobre `<timestamp>.<cuerpo crudo>`, igual que el resto de las
 * integraciones del CRM. Sin secreto configurado, la ruta responde 503: es
 * preferible que el sitio reintente a aceptar cualquier cosa.
 */
export const runtime = "nodejs";
export const maxDuration = 20;

const TIPOS = new Set(["reunion", "plan", "diagnostico", "contacto"]);
const VENTANA_SEGUNDOS = 300;

function firmaValida(secreto: string, timestamp: string, cuerpo: string, recibida: string): boolean {
  const esperada = createHmac("sha256", secreto).update(`${timestamp}.${cuerpo}`).digest("hex");
  const a = Buffer.from(esperada);
  const b = Buffer.from(recibida.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

function texto(valor: unknown, max = 500): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim().slice(0, max);
  return limpio === "" ? null : limpio;
}

export async function POST(request: Request) {
  const secreto = process.env.ALTIUS_INTAKE_SECRET;
  if (!secreto) {
    return NextResponse.json({ error: "Integración no configurada" }, { status: 503 });
  }

  const timestamp = request.headers.get("x-altius-timestamp") ?? "";
  const firma = request.headers.get("x-altius-signature") ?? "";
  const cuerpo = await request.text();

  const segundos = Number(timestamp);
  if (!Number.isFinite(segundos) || Math.abs(Date.now() / 1000 - segundos) > VENTANA_SEGUNDOS) {
    return NextResponse.json({ error: "Marca de tiempo fuera de ventana" }, { status: 401 });
  }
  if (!firma || !firmaValida(secreto, timestamp, cuerpo, firma)) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let datos: Record<string, unknown>;
  try {
    datos = JSON.parse(cuerpo) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const tipo = texto(datos.tipo, 40) ?? "";
  const externalId = texto(datos.external_id, 120);
  if (!TIPOS.has(tipo)) {
    return NextResponse.json({ error: "Tipo no válido" }, { status: 400 });
  }
  if (!externalId) {
    return NextResponse.json({ error: "Falta external_id" }, { status: 400 });
  }

  const reunion = texto(datos.reunion_at, 40);
  const montoBruto = Number(datos.monto_mensual);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ingresar_negocio_desde_web", {
    p_organization_slug: texto(datos.empresa_crm, 40) ?? "altius",
    p_external_id: externalId,
    p_kind: tipo,
    p_company_name: texto(datos.empresa, 200),
    p_contact_name: texto(datos.nombre, 200),
    p_contact_email: texto(datos.email, 200),
    p_contact_phone: texto(datos.telefono, 60),
    p_message: texto(datos.mensaje, 4000),
    p_product_code: texto(datos.producto, 60),
    p_monthly_amount: Number.isFinite(montoBruto) && montoBruto > 0 ? montoBruto : null,
    p_meeting_at: reunion,
    p_website: texto(datos.sitio, 300),
    p_source: texto(datos.origen, 60) ?? "web",
  });

  if (error) {
    console.error("[altius-intake] fallo al registrar el negocio", error.message);
    return NextResponse.json({ error: "No se pudo registrar" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) }, { status: 201 });
}
