import type { ReactNode } from "react";

import { requireProfile } from "@/lib/auth";
import { requireModule } from "@/lib/modules.server";

/** El arancel es de las clínicas (Dental y Vet) y lo edita administración. */
export default async function Layout({ children }: { children: ReactNode }) {
  await requireModule("ventas_b2c");
  await requireProfile(["admin"]);
  return <>{children}</>;
}
