import { NuevoCliente } from "@/components/terreno/nuevo-cliente";
import { campanaTerrenoActual } from "@/lib/terreno.server";

export default async function TerrenoNuevoPage() {
  const campana = await campanaTerrenoActual();
  if (!campana) return null;
  return <NuevoCliente campaignId={campana.id} />;
}
