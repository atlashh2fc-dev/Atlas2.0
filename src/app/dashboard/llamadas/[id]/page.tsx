import { redirect } from "next/navigation";

/**
 * Ruta histórica. La ficha de llamada se fusionó con la ficha del lead
 * para evitar dos pantallas separadas para la misma gestión.
 */
export default async function LlamadaLeadRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/leads/${id}`);
}
