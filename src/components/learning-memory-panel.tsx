import Link from "next/link";
import { Quote } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Callout, SectionCard } from "@/components/ui";
import { LearningMemoryRetraction } from "@/components/learning-loop-review";

export async function LearningMemoryPanel({ leadId }: { leadId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_ai_loop_memory", { p_lead_id: leadId });
  // An additive module must not break the existing lead UI before migration.
  if (error?.code === "PGRST202" || error?.code === "42883") return null;
  if (error) return <Callout tone="warning">No se pudo consultar la memoria de voz. El historial operativo sigue disponible.</Callout>;
  const facts = (data ?? []) as Array<{ id: string; run_id: string; quote: string; expires_at: string }>;
  if (!facts.length) return null;
  return <SectionCard
    title="Memoria de voz confirmada · observación"
    description="Hechos revisados por una persona, limitados a tus fuentes autorizadas. No reemplazan gestiones ni confirman que un compromiso siga pendiente."
  >
    {/* Cada hecho es una cita: comilla en chip, sin borde de color. */}
    <ul className="divide-y divide-border border-t border-border">{facts.map((fact) => <li key={fact.id} className="flex gap-3 px-5 py-3.5">
      <span className="icon-chip mt-0.5 size-7 rounded-lg" data-tone="violet" aria-hidden="true"><Quote size={13} /></span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <blockquote className="text-sm leading-relaxed text-foreground">{fact.quote}</blockquote>
        <Link className="text-xs font-medium text-primary hover:underline" href={`/dashboard/calidad/loop?run=${fact.run_id}`}>Ver evidencia y revisión</Link>
        <LearningMemoryRetraction memoryId={fact.id} />
      </div>
    </li>)}</ul>
  </SectionCard>;
}
