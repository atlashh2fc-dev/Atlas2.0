import { redirect } from "next/navigation";

/**
 * Ruta histórica. El buscador de llamadas se fusionó con el buscador
 * de leads (más el buscador global Cmd/Ctrl+K) para evitar dos cuadros
 * de búsqueda equivalentes en el producto.
 */
export default async function LlamadasRedirect({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  redirect(q ? `/dashboard/leads?q=${encodeURIComponent(q)}` : "/dashboard/leads");
}
