import type { ReactNode } from "react";

import { requireProfile } from "@/lib/auth";
import { requireModule } from "@/lib/modules.server";

/** El día del profesional: existe en las ediciones de clínica, para quien atiende. */
export default async function Layout({ children }: { children: ReactNode }) {
  await requireModule("ventas_b2c");
  await requireProfile(["agente", "supervisor", "admin"]);
  return <>{children}</>;
}
