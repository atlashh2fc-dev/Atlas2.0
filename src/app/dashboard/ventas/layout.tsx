import type { ReactNode } from "react";

import { requireModule } from "@/lib/modules.server";

/**
 * Puerta de la aplicación: si la empresa activa no la tiene contratada, esta
 * ruta no existe para ella. Vive en el layout para cubrir también las páginas
 * hijas, y responde 404 en vez de 403 para no delatar el otro negocio.
 */
export default async function Layout({ children }: { children: ReactNode }) {
  await requireModule("ventas_b2b", "ventas_b2c");
  return <>{children}</>;
}
