import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Lecturas y cierres de pagos que ocurren sin sesión de Atlas: la página
 * pública de pago y la vuelta desde la pasarela. Van con la clave de servicio
 * y solo tocan el pago que el id o el token nombran.
 */

export type PagoPublico = {
  id: string;
  monto: number;
  medio: string;
  estado: "pendiente" | "pagado" | "fallido" | "anulado";
  referencia: string | null;
  token: string | null;
  pagado_at: string | null;
  created_at: string;
  sales_companies: { name: string } | { name: string }[] | null;
  organizations: { name: string; edicion: string | null } | { name: string; edicion: string | null }[] | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function leerPagoPublico(id: string): Promise<PagoPublico | null> {
  if (!UUID.test(id)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("pagos")
    .select("id, monto, medio, estado, referencia, token, pagado_at, created_at, sales_companies(name), organizations(name, edicion)")
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as PagoPublico | null) ?? null;
}

export async function leerPagoPorToken(token: string): Promise<PagoPublico | null> {
  if (!token || token.length > 200) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("pagos")
    .select("id, monto, medio, estado, referencia, token, pagado_at, created_at, sales_companies(name), organizations(name, edicion)")
    .eq("token", token)
    .maybeSingle();
  return (data as unknown as PagoPublico | null) ?? null;
}

export async function guardarToken(id: string, token: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("pagos").update({ token, updated_at: new Date().toISOString() }).eq("id", id).eq("estado", "pendiente");
  if (error) throw new Error(error.message);
}

export async function cerrarPago(
  id: string,
  estado: "pagado" | "fallido" | "anulado",
  referencia: string | null,
  detalle: Record<string, unknown>,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("confirmar_pago_en_linea", {
    p_pago: id,
    p_estado: estado,
    p_referencia: referencia,
    p_detalle: detalle,
  });
  if (error) throw new Error(error.message);
}

/** El origen público de esta instalación, detrás del proxy de Vercel. */
export function origenDe(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  const proto = request.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function primero<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}
