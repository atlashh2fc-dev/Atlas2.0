import type { ReactNode } from "react";

import { requireProfile } from "@/lib/auth";
import { requireModule } from "@/lib/modules.server";

/** Los materiales son de las clínicas (Dental y Vet) y los edita administración. */
export default async function Layout({ children }: { children: ReactNode }) {
  await requireModule("ventas_b2c");
  await requireProfile(["admin"]);
  return <>{children}</>;
}
