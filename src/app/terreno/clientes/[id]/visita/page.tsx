import { notFound, redirect } from "next/navigation";

import { RegistrarVisita } from "@/components/terreno/registrar-visita";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function TerrenoVisitaPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile(["agente", "supervisor", "admin"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("terreno_fichas")
    .select("vendedor_id, lead:leads(full_name)")
    .eq("lead_id", id)
    .maybeSingle();
  if (!data) notFound();
  // Solo el vendedor del cliente registra visitas; el resto vuelve a la ficha.
  if (data.vendedor_id !== profile.id) redirect(`/terreno/clientes/${id}`);

  const lead = Array.isArray(data.lead) ? data.lead[0] : data.lead;
  return <RegistrarVisita leadId={id} nombre={(lead as { full_name?: string } | null)?.full_name ?? "Cliente"} />;
}
