"use client";

import { usePathname } from "next/navigation";
import { navItemForPath, navTone } from "@/lib/nav-tone";

/**
 * Chip del encabezado de página: toma el icono y el color del destino del menú
 * que contiene la ruta, así cada pantalla queda marcada igual que en el menú
 * sin que cada página tenga que declararlo.
 */
export function PageHeaderChip() {
  const pathname = usePathname();
  const item = navItemForPath(pathname);
  if (!item) return null;
  const Icon = item.icon;
  return (
    <span className="icon-chip size-10 rounded-xl" data-tone={navTone(item.id)} aria-hidden="true">
      <Icon size={20} />
    </span>
  );
}
