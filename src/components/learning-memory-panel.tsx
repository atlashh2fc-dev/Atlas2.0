import Link from "next/link";
import { BrainCircuit } from "lucide-react";
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
    icon={BrainCircuit}
    tone="violet"
  >
    <div className="space-y-3 p-4">{facts.map((fact) => <div key={fact.id} className="rounded-r-lg border-l-2 border-[color:var(--tone-violet)] bg-surface-muted/40 py-2 pl-3 pr-2">
      <blockquote className="text-sm">{fact.quote}</blockquote>
      <Link className="text-xs text-primary underline" href={`/dashboard/calidad/loop?run=${fact.run_id}`}>Ver evidencia y revisión</Link>
      <LearningMemoryRetraction memoryId={fact.id} />
    </div>)}</div>
  </SectionCard>;
}
