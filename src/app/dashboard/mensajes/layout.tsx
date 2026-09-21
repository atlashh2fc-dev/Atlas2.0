import type { ReactNode } from "react";

import { requireProfile } from "@/lib/auth";
import { requireModule } from "@/lib/modules.server";

/** La bandeja de la clínica: existe donde hay WhatsApp y se atiende a personas. */
export default async function Layout({ children }: { children: ReactNode }) {
  await requireModule("whatsapp");
  await requireProfile(["admin", "supervisor"]);
  return <>{children}</>;
}
