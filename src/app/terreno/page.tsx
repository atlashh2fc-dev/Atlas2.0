import { ListaClientes } from "@/components/terreno/lista-clientes";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ClienteTerreno } from "@/lib/terreno";
import { campanaTerrenoActual } from "@/lib/terreno.server";

export default async function TerrenoClientesPage() {
  const profile = await requireProfile(["agente", "supervisor", "admin"]);
  const campana = await campanaTerrenoActual();
  if (!campana) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("terreno_fichas")
    .select(
      "lead_id, campaign_id, vendedor_id, etapa, motivo_salida, nombre_contacto, rubro, direccion, comuna, region, completado_con, pos_cantidad, pos_modelo, visitas, ultima_visita_at, proxima_visita_at, etapa_at, created_at, lead:leads(id, full_name, rut, phone, email)",
    )
    .eq("campaign_id", campana.id)
    .eq("vendedor_id", profile.id)
    .order("etapa_at", { ascending: false })
    .limit(500);

  if (error) console.error("[terreno] no se pudieron leer los clientes", error.message);
  const clientes = ((data ?? []) as unknown as ClienteTerreno[]).map((cliente) => ({
    ...cliente,
    lead: Array.isArray(cliente.lead) ? (cliente.lead[0] ?? null) : cliente.lead,
  }));

  return <ListaClientes clientes={clientes} error={Boolean(error)} ahora={new Date().toISOString()} />;
}
