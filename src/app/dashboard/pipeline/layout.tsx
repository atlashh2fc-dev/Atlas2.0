import type { ReactNode } from "react";

import { requireProfile } from "@/lib/auth";
import { requireModule } from "@/lib/modules.server";

export default async function Layout({ children }: { children: ReactNode }) {
  // La misma puerta que la lista de Ventas: el pipeline es su otra cara.
  await requireModule("ventas_b2b", "ventas_b2c");
  await requireProfile(["admin", "supervisor"]);
  return <>{children}</>;
}
