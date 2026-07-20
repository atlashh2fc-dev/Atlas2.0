import { requireProfile } from "@/lib/auth";
import { HelpCenter } from "@/components/help-center";

export default async function HelpPage() {
  const profile = await requireProfile(["agente", "supervisor", "admin"]);
  return <HelpCenter role={profile.role} />;
}
