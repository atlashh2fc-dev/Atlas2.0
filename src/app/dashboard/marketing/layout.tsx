import type { ReactNode } from "react";

import { requireProfile } from "@/lib/auth";
import { requireModule } from "@/lib/modules.server";

/** Marketing es una aplicación de la suite: existe donde la empresa la contrató. */
export default async function Layout({ children }: { children: ReactNode }) {
  await requireModule("marketing");
  await requireProfile(["admin", "supervisor"]);
  return <>{children}</>;
}
