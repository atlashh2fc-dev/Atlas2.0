"use server";

import type { HoraLibre, ReservaHecha } from "@/lib/reserva";
import { clientePublico } from "@/lib/reserva.server";

/*
 * Las acciones de la página pública de reserva. Todas pasan por funciones de
 * la base que validan el enlace, el servicio y la hora; acá solo se limpia la
 * entrada y se traduce el error a una frase para la persona.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function slugLimpio(slug: string): string {
  return String(slug ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
}

export async function diasConHoras(slug: string, servicio: string, profesional: string | null): Promise<string[]> {
  if (!UUID.test(servicio) || (profesional && !UUID.test(profesional))) return [];
  const { data, error } = await clientePublico().rpc("reserva_dias_con_horas", {
    p_slug: slugLimpio(slug),
    p_servicio: servicio,
    p_profesional: profesional || null,
    p_desde: null,
  });
  if (error) {
    console.error("[reserva] días", error.message);
    return [];
  }
  return Array.isArray(data) ? (data as string[]) : [];
}

export async function horasLibres(slug: string, servicio: string, profesional: string | null, fecha: string): Promise<HoraLibre[]> {
  if (!UUID.test(servicio) || (profesional && !UUID.test(profesional)) || !FECHA.test(fecha)) return [];
  const { data, error } = await clientePublico().rpc("reserva_horas", {
    p_slug: slugLimpio(slug),
    p_servicio: servicio,
    p_profesional: profesional || null,
    p_fecha: fecha,
  });
  if (error) {
    console.error("[reserva] horas", error.message);
    return [];
  }
  return Array.isArray(data) ? (data as HoraLibre[]) : [];
}

export type ResultadoReserva = { ok: true; reserva: ReservaHecha } | { ok: false; error: string; horaOcupada?: boolean };

export async function reservar(entrada: {
  slug: string;
  servicio: string;
  profesional: string;
  inicio: string;
  nombre: string;
  telefono: string;
  correo?: string;
  mascota?: string;
  especie?: string;
  nota?: string;
  /** Campo trampa: una persona no lo ve ni lo llena. */
  sitio?: string;
}): Promise<ResultadoReserva> {
  if (entrada.sitio) return { ok: false, error: "No pudimos tomar la reserva. Inténtalo de nuevo." };
  if (!UUID.test(entrada.servicio) || !UUID.test(entrada.profesional) || Number.isNaN(Date.parse(entrada.inicio))) {
    return { ok: false, error: "Vuelve a elegir el servicio y la hora." };
  }
  const corto = (texto: string | undefined, largo: number) => (texto ?? "").trim().slice(0, largo) || null;
  const { data, error } = await clientePublico().rpc("reservar_en_linea", {
    p_slug: slugLimpio(entrada.slug),
    p_servicio: entrada.servicio,
    p_profesional: entrada.profesional,
    p_inicio: new Date(entrada.inicio).toISOString(),
    p_nombre: corto(entrada.nombre, 80),
    p_telefono: corto(entrada.telefono, 30),
    p_correo: corto(entrada.correo, 120),
    p_mascota: corto(entrada.mascota, 60),
    p_especie: corto(entrada.especie, 30),
    p_nota: corto(entrada.nota, 300),
  });
  if (error) {
    // Los mensajes de la base ya están escritos para la persona.
    const conocido = ["22023", "23P01", "54000", "P0002"].includes(error.code ?? "");
    if (!conocido) console.error("[reserva] reservar", error.code, error.message);
    return { ok: false, error: conocido ? error.message : "No pudimos tomar la reserva. Inténtalo de nuevo en un momento.", horaOcupada: error.code === "23P01" };
  }
  return { ok: true, reserva: data as ReservaHecha };
}

export async function cancelarMiCita(token: string): Promise<boolean> {
  if (!/^[a-f0-9]{32,64}$/.test(token)) return false;
  const { data, error } = await clientePublico().rpc("cancelar_cita_publica", { p_token: token });
  if (error) {
    console.error("[reserva] cancelar", error.message);
    return false;
  }
  return data === true;
}
