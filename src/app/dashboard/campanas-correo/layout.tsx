import type { ReactNode } from "react";

import { requireProfile } from "@/lib/auth";
import { requireModule } from "@/lib/modules.server";

/** Campañas de correo: existe donde la empresa contrató el correo (Atlas Lead). */
export default async function Layout({ children }: { children: ReactNode }) {
  await requireModule("correo");
  await requireProfile(["admin", "supervisor"]);
  return <>{children}</>;
}
