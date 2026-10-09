import type { EmbudoVendedor } from "@/lib/terreno";

type Totales = Pick<EmbudoVendedor, "clientes" | "visitados" | "interesados" | "documentos" | "vendidos">;

export function sumarEmbudo<T extends Omit<EmbudoVendedor, "vendedor_id" | "vendedor" | "ultima_visita_at">>(filas: T[]) {
  const base = {
    clientes: 0,
    visitados: 0,
    interesados: 0,
    documentos: 0,
    vendidos: 0,
    descartados: 0,
    visitas: 0,
    visitas_con_gps: 0,
    visitas_con_foto: 0,
    ventas: 0,
    lectores: 0,
    dias_activos: 0,
  };
  for (const fila of filas) {
    for (const clave of Object.keys(base) as (keyof typeof base)[]) base[clave] += fila[clave];
  }
  return base;
}

export function porcentaje(parte: number, total: number): string {
  if (total <= 0) return "—";
  return `${Math.round((parte / total) * 100)}%`;
}

/**
 * Embudo de la cartera ingresada en el período: cuántos clientes llegaron a
 * cada etapa (alguna vez, aunque después hayan salido) y qué parte pasó del
 * paso anterior. Barras horizontales: se leen igual en un teléfono.
 */
export function EmbudoBarras({ totales }: { totales: Totales }) {
  const pasos = [
    { label: "Ingresados", valor: totales.clientes },
    { label: "Visitados", valor: totales.visitados },
    { label: "Interesados", valor: totales.interesados },
    { label: "Documentos / alta", valor: totales.documentos },
    { label: "POS vendido", valor: totales.vendidos },
  ];
  const max = Math.max(1, totales.clientes);

  return (
    <ol className="space-y-3">
      {pasos.map((paso, index) => {
        const anterior = index > 0 ? pasos[index - 1].valor : null;
        return (
          <li key={paso.label} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{paso.label}</span>
              <span className="tabular-nums">
                <span className="font-semibold">{paso.valor.toLocaleString("es-CL")}</span>
                {anterior !== null && (
                  <span className="ml-1.5 text-xs text-muted-foreground">{porcentaje(paso.valor, anterior)} del anterior</span>
                )}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
              <div
                className={index === pasos.length - 1 ? "h-full rounded-full bg-success" : "h-full rounded-full bg-primary"}
                style={{ width: `${(paso.valor / max) * 100}%` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
