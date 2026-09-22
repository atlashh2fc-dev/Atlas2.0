import type { ReactNode } from "react";

import { requireProfile } from "@/lib/auth";
import { requireModule } from "@/lib/modules.server";

/** Reportes de la clínica: existen donde se atiende a personas, las ediciones Dental y Vet. */
export default async function Layout({ children }: { children: ReactNode }) {
  await requireModule("ventas_b2c");
  await requireProfile(["admin", "supervisor"]);
  return <>{children}</>;
}
