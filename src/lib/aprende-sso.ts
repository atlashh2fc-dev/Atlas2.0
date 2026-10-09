import "server-only";

import { createHmac, randomUUID } from "node:crypto";

/**
 * Pase de Atlas CRM a Atlas Aprende: la misma persona entra a Aprende sin
 * volver a iniciar sesión.
 *
 * Son dos productos con su propio Supabase, así que no comparten la sesión.
 * Atlas firma un pase corto (HMAC-SHA256 con APRENDE_SSO_SECRET, compartido
 * con Aprende como ATLAS_SSO_SECRET) y el navegador lo entrega por POST a
 * Aprende, que lo valida, lo marca usado (un solo uso), busca o crea a la
 * persona por su correo y abre su sesión. El pase nunca viaja en la URL.
 *
 * Formato: base64url(JSON del pase) + "." + base64url(firma).
 */

export const APRENDE_URL = (process.env.APRENDE_URL || "https://aprende.geimser.cl").replace(/\/$/, "");

/** Vida del pase: alcanza para el salto, no para reutilizarlo. */
const VIGENCIA_SEGUNDOS = 90;

export type PaseAprende = {
  v: 1;
  iss: "atlas-crm";
  aud: "aprende";
  jti: string;
  iat: number;
  exp: number;
  /** Id del perfil en Atlas (trazabilidad, no se usa como llave en Aprende). */
  sub: string;
  email: string;
  nombre: string;
  /** Slug de la empresa en Atlas; en Aprende es el slug de la institución. */
  org: string;
  rol: string;
  /** Curso al que entra y en el que queda inscrito, si la campaña tiene uno. */
  curso: string | null;
};

export function aprendeSsoConfigurado(): boolean {
  return Boolean(process.env.APRENDE_SSO_SECRET && process.env.APRENDE_SSO_SECRET.length >= 32);
}

export function firmarPaseAprende(datos: Omit<PaseAprende, "v" | "iss" | "aud" | "jti" | "iat" | "exp">): string {
  const secreto = process.env.APRENDE_SSO_SECRET;
  if (!secreto || secreto.length < 32) throw new Error("Falta APRENDE_SSO_SECRET para entrar a Atlas Aprende.");
  const ahora = Math.floor(Date.now() / 1000);
  const pase: PaseAprende = {
    v: 1,
    iss: "atlas-crm",
    aud: "aprende",
    jti: randomUUID(),
    iat: ahora,
    exp: ahora + VIGENCIA_SEGUNDOS,
    ...datos,
  };
  const cuerpo = Buffer.from(JSON.stringify(pase)).toString("base64url");
  const firma = createHmac("sha256", secreto).update(cuerpo).digest("base64url");
  return `${cuerpo}.${firma}`;
}
