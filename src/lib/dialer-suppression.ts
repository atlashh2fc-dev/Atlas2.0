// Lista de no llamar (public.dialer_phone_suppressions). La base decide si un
// teléfono está bloqueado (dialer_phone_block_reason / dialer_lead_block_reason);
// aquí solo se traduce el motivo para quien iba a marcar.

export const DIALER_SUPPRESSION_LABELS: Record<string, string> = {
  cliente_molesto: "cliente molesto",
  numero_erroneo: "número erróneo o no corresponde",
  fuera_de_servicio: "teléfono fuera de servicio",
  cliente_carterizado: "cliente carterizado",
  quiebra_o_cierre: "empresa en quiebra o proceso de cierre",
  no_sujeto_a_venta: "cliente no sujeto a venta",
  pidio_no_llamar: "pidió no ser llamado",
  otro: "bloqueado por un supervisor",
};

export function dialerSuppressionMessage(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const label = DIALER_SUPPRESSION_LABELS[reason] ?? reason.replaceAll("_", " ");
  return `Este teléfono está en la lista de no llamar (${label}). Si es un error, pide a un supervisor que lo levante.`;
}
