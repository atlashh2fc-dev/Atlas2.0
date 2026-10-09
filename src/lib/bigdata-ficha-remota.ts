import "server-only";

import { FICHA_RUT_CONTRACT, parseBigdataFicha, type BigdataFicha } from "@/lib/bigdata-ficha";
import { integrationV2Destinations, integrationV2Signature } from "@/lib/integration-v2";
import { compactRut } from "@/lib/rut";

export type FichaBigdataResultado =
  | { estado: "encontrado"; ficha: BigdataFicha }
  | { estado: "no_encontrado" }
  | { estado: "no_disponible"; motivo: string };

/**
 * Ficha de Bigdata por el puente firmado que ya usa el outbox
 * (INTEGRATION_OUTBOX_DESTINATIONS_JSON.bigdata), igual que la consulta de
 * correos a Atlas Lead: mismo secreto, mismos headers, sin llaves nuevas.
 *
 * Vive fuera de las server actions para que no quede expuesta como acción:
 * quien la llama decide antes quién puede consultar.
 */
export async function fichaBigdata(rut: string): Promise<FichaBigdataResultado> {
  const destino = integrationV2Destinations(process.env.INTEGRATION_OUTBOX_DESTINATIONS_JSON).get("bigdata");
  if (!destino) return { estado: "no_disponible", motivo: "El puente con Bigdata no está configurado." };

  const url = new URL("/api/commercial-intelligence/atlas-bridge/ficha-rut", destino.url);
  const rawBody = JSON.stringify({ contract: FICHA_RUT_CONTRACT, rut: compactRut(rut) });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-atlas-source": "atlas2",
        "x-atlas-timestamp": timestamp,
        "x-atlas-signature": integrationV2Signature(destino.secret, timestamp, Buffer.from(rawBody)),
      },
      body: rawBody,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    if (response.status === 404) {
      const body = (await response.json().catch(() => null)) as { found?: unknown } | null;
      // Un 404 sin cuerpo del contrato es la ruta que todavía no existe.
      if (body?.found === false) return { estado: "no_encontrado" };
      return { estado: "no_disponible", motivo: "Bigdata todavía no responde consultas por RUT." };
    }
    if (!response.ok) return { estado: "no_disponible", motivo: `Bigdata respondió ${response.status}.` };
    const body: unknown = await response.json().catch(() => null);
    const ficha = parseBigdataFicha(body);
    return ficha ? { estado: "encontrado", ficha } : { estado: "no_encontrado" };
  } catch {
    return { estado: "no_disponible", motivo: "Bigdata no respondió a tiempo." };
  }
}
