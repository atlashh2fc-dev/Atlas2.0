import { Sparkles } from "lucide-react";

import { SectionCard } from "@/components/ui";
import { instanteEnChile } from "@/lib/citas";
import { createClient } from "@/lib/supabase/server";

type Fila = { estado: string; barbero: string | null; propuesta_aprobada: string | null; compartir_token: string | null };

/**
 * El Estudio de Look en el período: cuántos looks se hicieron, cuántos
 * terminaron en un corte aprobado y realizado, cuántos se le mandaron al
 * cliente, y cuánto se usó la IA. Por barbero, para ver quién lo aprovecha.
 */
export async function ResumenLooks({ desde, hasta }: { desde: string; hasta: string }) {
  const supabase = await createClient();
  const inicio = instanteEnChile(desde, "00:00").toISOString();
  const fin = new Date(instanteEnChile(hasta, "00:00").getTime() + 24 * 60 * 60 * 1000).toISOString();
  const [{ data: looksData }, { data: usoData }] = await Promise.all([
    supabase.from("looks").select("estado, barbero, propuesta_aprobada, compartir_token").gte("created_at", inicio).lt("created_at", fin).limit(5000),
    supabase.from("uso_ia_looks").select("tipo, ok").gte("created_at", inicio).lt("created_at", fin).limit(20000),
  ]);
  const looks = (looksData ?? []) as Fila[];
  const uso = (usoData ?? []) as { tipo: string; ok: boolean }[];
  if (looks.length === 0) return null;

  const aprobados = looks.filter((look) => look.propuesta_aprobada).length;
  const realizados = looks.filter((look) => look.estado === "realizado").length;
  const enviados = looks.filter((look) => look.compartir_token).length;
  const porBarbero = new Map<string, { looks: number; aprobados: number }>();
  for (const look of looks) {
    const clave = look.barbero ?? "Sin barbero";
    const actual = porBarbero.get(clave) ?? { looks: 0, aprobados: 0 };
    actual.looks += 1;
    if (look.propuesta_aprobada) actual.aprobados += 1;
    porBarbero.set(clave, actual);
  }
  const cuenta = (tipo: string) => uso.filter((fila) => fila.tipo === tipo && fila.ok).length;
  const porcentaje = (parte: number) => `${Math.round((parte / looks.length) * 100)} %`;

  const cifras: [string, string, string][] = [
    ["Looks", String(looks.length), "sesiones del Estudio"],
    ["Aprobados", String(aprobados), `${porcentaje(aprobados)} de los looks`],
    ["Realizados", String(realizados), `${porcentaje(realizados)} con foto del resultado`],
    ["Enviados al cliente", String(enviados), "por WhatsApp o correo"],
  ];

  return (
    <SectionCard icon={Sparkles} tone="amber" title="Estudio de Look" description="Del período elegido. El uso de IA es lo que se factura en los proveedores.">
      <div className="grid gap-px bg-border sm:grid-cols-4">
        {cifras.map(([etiqueta, valor, ayuda]) => (
          <div key={etiqueta} className="bg-surface px-4 py-3">
            <p className="text-xs text-muted-foreground">{etiqueta}</p>
            <p className="text-2xl font-semibold tabular-nums text-foreground">{valor}</p>
            <p className="text-xs text-muted-foreground">{ayuda}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1 font-medium">Barbero</th>
              <th className="py-1 text-right font-medium">Looks</th>
              <th className="py-1 text-right font-medium">Aprobados</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[...porBarbero.entries()]
              .sort((a, b) => b[1].looks - a[1].looks)
              .map(([barbero, fila]) => (
                <tr key={barbero}>
                  <td className="py-1.5 text-foreground">{barbero}</td>
                  <td className="py-1.5 text-right tabular-nums">{fila.looks}</td>
                  <td className="py-1.5 text-right tabular-nums">{fila.aprobados}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {[
            ["Análisis con IA", cuenta("analisis")],
            ["Fotos simuladas", cuenta("imagen")],
          ].map(([etiqueta, valor]) => (
            <div key={etiqueta as string} className="rounded-lg bg-surface-muted px-3 py-2">
              <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
              <dd className="text-lg font-semibold tabular-nums text-foreground">{valor}</dd>
            </div>
          ))}
        </dl>
      </div>
    </SectionCard>
  );
}
