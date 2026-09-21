import { transbank } from "./transbank";

/**
 * La pasarela de pago, detrás de una interfaz de dos verbos.
 *
 * Atlas registra sus propios pagos; la pasarela solo cobra en línea y
 * confirma. Cualquier proveedor que sepa hacer esas dos cosas (Transbank,
 * Flow, Mercado Pago, Khipu, Fintoc) entra por acá sin tocar la caja.
 * Hoy está Transbank Webpay Plus, que es lo que ya usa cualquier clínica en
 * Chile; la elección sale de `PASARELA_DE_PAGO`.
 */

export type TransaccionCreada = {
  /** Identificador de la pasarela para esta transacción. */
  token: string;
  /** Adónde mandar a la persona a pagar. */
  url: string;
  /** Cómo mandarla: con un formulario POST (Webpay) o un enlace. */
  metodo: "POST" | "GET";
  /** Nombre del campo que lleva el token cuando es POST. */
  campoToken?: string;
};

export type ResultadoTransaccion = {
  estado: "pagado" | "fallido" | "anulado";
  /** Código de autorización o número de operación de la pasarela. */
  referencia: string | null;
  monto: number | null;
  detalle: Record<string, unknown>;
};

export type Pasarela = {
  nombre: "transbank";
  etiqueta: string;
  /** Verdadero cuando cobra de verdad; en integración se usan las tarjetas de prueba. */
  produccion: boolean;
  crear(entrada: { pagoId: string; monto: number; urlRetorno: string }): Promise<TransaccionCreada>;
  /** Cierra la transacción con la pasarela. Idempotente: repetirla no vuelve a cobrar. */
  confirmar(token: string): Promise<ResultadoTransaccion>;
};

export function pasarelaActiva(): Pasarela {
  const elegida = (process.env.PASARELA_DE_PAGO ?? "transbank").toLowerCase();
  if (elegida !== "transbank") {
    throw new Error(`La pasarela "${elegida}" todavía no está integrada. Disponible: transbank.`);
  }
  return transbank();
}
