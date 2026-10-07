import type { ReactNode } from "react";

import { requireProfile } from "@/lib/auth";
import { requireModule } from "@/lib/modules.server";

/** Laboratorio: las órdenes de trabajos dentales de la clínica. */
export default async function Layout({ children }: { children: ReactNode }) {
  await requireModule("ventas_b2c");
  await requireProfile(["admin", "supervisor"]);
  return <>{children}</>;
}
