"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Layers } from "lucide-react";
import type { AppRole } from "@/lib/types";

type CampaignOption = { id: string; name: string };

/**
 * Rutas donde el alcance de campaña cambia lo que se ve. Se listan por rol
 * porque cada espacio de trabajo tiene su propio árbol (nav.config.ts): el
 * supervisor tiene "Mi equipo" y no tiene el reporte global del admin.
 *
 * `/dashboard/reportes` estaba solo en la lista del admin, así que el
 * supervisor no tenía **ninguna** forma de cambiar la campaña en sus reportes:
 * esa pantalla no trae filtro propio y depende por completo de este selector.
 * `/dashboard/reportes/discador` queda fuera a propósito: ese reporte no
 * segmenta por campaña y el selector aparecería sin hacer nada.
 */
const SCOPED_ROUTES: Record<AppRole, string[]> = {
  admin: ["/dashboard/leads", "/dashboard/reportes", "/dashboard/reportes/integridad"],
  supervisor: [
    "/dashboard/leads",
    "/dashboard/team",
    "/dashboard/reportes",
    "/dashboard/reportes/integridad",
  ],
  agente: ["/dashboard/leads", "/dashboard/agenda"],
};

function supportsScope(pathname: string, role: AppRole) {
  return SCOPED_ROUTES[role].some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

/**
 * Selector de campaña del encabezado.
 *
 * El valor se lee de `useSearchParams`, no de un prop del layout. Los layouts
 * de Next no se vuelven a renderizar en una navegación blanda, así que el
 * `select` controlado recibía siempre el valor viejo y saltaba de vuelta solo:
 * parecía que elegir una campaña no hacía nada.
 */
export function CampaignScopeSwitcher({
  campaigns,
  role,
}: {
  campaigns: CampaignOption[];
  role: AppRole;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!supportsScope(pathname, role)) return null;

  const requested = searchParams.get("campaign") ?? "";
  const selected = campaigns.some((campaign) => campaign.id === requested) ? requested : "";

  function changeScope(campaignId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (campaignId) params.set("campaign", campaignId);
    else params.delete("campaign");
    // Cambiar de campaña reinicia la paginación: la página 7 de otra campaña
    // no significa nada.
    params.delete("page");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <label className="hidden items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground lg:flex">
      <Layers size={14} aria-hidden="true" />
      <span className="sr-only">Contexto de campaña</span>
      <select
        aria-label="Contexto de campaña"
        value={selected}
        onChange={(event) => changeScope(event.target.value)}
        className="max-w-48 bg-transparent font-medium text-foreground outline-none"
      >
        <option value="">Todas las campañas</option>
        {campaigns.map((campaign) => (
          <option key={campaign.id} value={campaign.id}>
            {campaign.name}
          </option>
        ))}
      </select>
    </label>
  );
}
