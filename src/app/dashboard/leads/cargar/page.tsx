import { redirect } from "next/navigation";

/** Ruta histórica: la carga masiva es configuración y vive en Administración. */
export default async function CargarLeadsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ campaign_id?: string }>;
}) {
  const { campaign_id: campaignId } = await searchParams;
  redirect(campaignId ? `/dashboard/admin/cargas?campaign_id=${campaignId}` : "/dashboard/admin/cargas");
}
