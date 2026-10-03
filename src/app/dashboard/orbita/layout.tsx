import type { ReactNode } from "react";

import { requireProfile } from "@/lib/auth";
import { requireModule } from "@/lib/modules.server";

/** Órbita es una aplicación de la suite: existe donde la empresa la contrató. */
export default async function Layout({ children }: { children: ReactNode }) {
  await requireModule("orbita");
  await requireProfile(["admin", "supervisor"]);
  return <>{children}</>;
}
