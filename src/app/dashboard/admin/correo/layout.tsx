import type { ReactNode } from "react";

import { requireProfile } from "@/lib/auth";
import { requireModule } from "@/lib/modules.server";

export default async function Layout({ children }: { children: ReactNode }) {
  // Las clínicas leen y responden desde aquí; el contact center conecta el
  // buzón desde el que salen las propuestas del cotizador Equifax.
  await requireModule("ventas_b2c", "leads");
  await requireProfile(["admin"]);
  return <>{children}</>;
}
