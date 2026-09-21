import type { Pasarela, ResultadoTransaccion, TransaccionCreada } from "./pasarela";

/**
 * Transbank Webpay Plus, API REST 1.2.
 *
 * Sin credenciales propias se usa el ambiente de integración de Transbank,
 * que es público y sirve para demostrar el flujo completo con tarjetas de
 * prueba. Con `TBK_COMMERCE_CODE` y `TBK_API_KEY` en producción, cobra de
 * verdad. Documentación: https://www.transbankdevelopers.cl/documentacion/webpay-plus
 */

const INTEGRACION = {
  host: "https://webpay3gint.transbank.cl",
  codigo: "597055555532",
  clave: "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C",
};
const PRODUCCION_HOST = "https://webpay3g.transbank.cl";
const RUTA = "/rswebpaytransaction/api/webpay/v1.2/transactions";

type RespuestaCommit = {
  vci?: string;
  amount?: number;
  status?: string;
  buy_order?: string;
  session_id?: string;
  card_detail?: { card_number?: string };
  accounting_date?: string;
  transaction_date?: string;
  authorization_code?: string;
  payment_type_code?: string;
  response_code?: number;
  installments_number?: number;
  error_message?: string;
};

function credenciales() {
  const codigo = process.env.TBK_COMMERCE_CODE?.trim();
  const clave = process.env.TBK_API_KEY?.trim();
  const produccion = Boolean(codigo && clave) && (process.env.TBK_ENV ?? "produccion").toLowerCase() !== "integracion";
  return {
    produccion,
    host: produccion ? PRODUCCION_HOST : INTEGRACION.host,
    codigo: produccion ? (codigo as string) : INTEGRACION.codigo,
    clave: produccion ? (clave as string) : INTEGRACION.clave,
  };
}

async function llamar<T>(ruta: string, metodo: "POST" | "PUT", cuerpo?: unknown): Promise<T> {
  const { host, codigo, clave } = credenciales();
  const respuesta = await fetch(`${host}${ruta}`, {
    method: metodo,
    headers: {
      "Content-Type": "application/json",
      "Tbk-Api-Key-Id": codigo,
      "Tbk-Api-Key-Secret": clave,
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const texto = await respuesta.text();
  let datos: T & { error_message?: string };
  try {
    datos = (texto ? JSON.parse(texto) : {}) as T & { error_message?: string };
  } catch {
    throw new Error(`Transbank respondió algo que no es JSON (${respuesta.status}).`);
  }
  if (!respuesta.ok) {
    throw new Error(datos.error_message ?? `Transbank respondió ${respuesta.status}.`);
  }
  return datos;
}

export function transbank(): Pasarela {
  const { produccion } = credenciales();
  return {
    nombre: "transbank",
    etiqueta: produccion ? "Webpay Plus" : "Webpay Plus (integración)",
    produccion,

    async crear({ pagoId, monto, urlRetorno }): Promise<TransaccionCreada> {
      // buy_order admite 26 caracteres: el id sin guiones cabe justo.
      const orden = pagoId.replace(/-/g, "").slice(0, 26);
      const datos = await llamar<{ token: string; url: string }>(RUTA, "POST", {
        buy_order: orden,
        session_id: pagoId,
        amount: Math.round(monto),
        return_url: urlRetorno,
      });
      if (!datos.token || !datos.url) throw new Error("Transbank no devolvió el token de la transacción.");
      return { token: datos.token, url: datos.url, metodo: "POST", campoToken: "token_ws" };
    },

    async confirmar(token): Promise<ResultadoTransaccion> {
      let datos: RespuestaCommit;
      try {
        datos = await llamar<RespuestaCommit>(`${RUTA}/${encodeURIComponent(token)}`, "PUT");
      } catch (error) {
        return { estado: "fallido", referencia: null, monto: null, detalle: { error: error instanceof Error ? error.message : String(error) } };
      }
      const autorizado = datos.status === "AUTHORIZED" && datos.response_code === 0;
      return {
        estado: autorizado ? "pagado" : "fallido",
        referencia: datos.authorization_code ?? null,
        monto: typeof datos.amount === "number" ? datos.amount : null,
        detalle: {
          pasarela: "transbank",
          status: datos.status ?? null,
          response_code: datos.response_code ?? null,
          tarjeta: datos.card_detail?.card_number ?? null,
          tipo: datos.payment_type_code ?? null,
          cuotas: datos.installments_number ?? null,
          fecha: datos.transaction_date ?? null,
          vci: datos.vci ?? null,
        },
      };
    },
  };
}
