import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const SUPPORTED_METRICS = new Set(["agendas", "cotizaciones", "ventas"]);

function nullableUuid(value: string | null): string | null {
  return value && value !== "null" && value !== "undefined" ? value : null;
}

export async function GET(request: Request) {
  await requireProfile(["supervisor", "admin"]);

  const url = new URL(request.url);
  const metric = url.searchParams.get("metric") ?? "";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const profileId = nullableUuid(url.searchParams.get("profileId"));
  const historicalAgentId = nullableUuid(url.searchParams.get("historicalAgentId"));

  if (!SUPPORTED_METRICS.has(metric)) {
    return NextResponse.json({ error: "Métrica no soportada" }, { status: 400 });
  }

  if (!from || !to || Number.isNaN(new Date(from).getTime()) || Number.isNaN(new Date(to).getTime())) {
    return NextResponse.json({ error: "Rango inválido" }, { status: 400 });
  }

  if (!profileId && !historicalAgentId) {
    return NextResponse.json({ error: "Ejecutivo inválido" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_supervisor_report_drilldown", {
    p_from: from,
    p_to: to,
    p_profile_id: profileId,
    p_historical_agent_id: historicalAgentId,
    p_metric: metric,
    p_limit: 100,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? { metric, limit: 100, items: [] });
}
