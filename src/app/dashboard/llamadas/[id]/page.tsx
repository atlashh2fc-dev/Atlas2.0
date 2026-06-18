import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { notFound } from "next/navigation";
import { getOrCreateOpenCall } from "@/app/actions/calls";
import { CallTypificationForm } from "@/components/call-typification-form";

export default async function LlamadaLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const { id } = await params;
  const supabase = await createClient();

  const { data: lead } = await supabase.from("leads").select("*").eq("id", id).single();
  if (!lead) notFound();

  const call = await getOrCreateOpenCall(id);

  const { data: previousCalls } = await supabase
    .from("calls")
    .select("*")
    .eq("lead_id", id)
    .not("ended_at", "is", null)
    .order("ended_at", { ascending: false })
    .limit(10);

  const { data: interactions } = await supabase
    .from("interactions")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <CallTypificationForm
      lead={lead}
      call={call}
      previousCalls={previousCalls ?? []}
      interactions={interactions ?? []}
      agentId={profile.id}
    />
  );
}
