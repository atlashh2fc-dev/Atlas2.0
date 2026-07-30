import { redirect } from "next/navigation";

/** El dashboard de campaña se consolidó como la pestaña Resumen del detalle. */
export default async function CampaignDashboardRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/admin/campanas/${id}`);
}
