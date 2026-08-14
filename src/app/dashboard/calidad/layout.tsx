import { requireProfile } from "@/lib/auth";
import { getTabs } from "@/lib/nav.config";
import { NavTabs, PageHeader } from "@/components/ui";

export default async function CalidadLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile(["admin", "supervisor"]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Calidad"
        description="Revisa grabaciones, transcripciones y resultados del control de calidad."
        className="border-b-0 pb-0"
      />
      <NavTabs tabs={getTabs("calidad", profile.role)} />
      {children}
    </div>
  );
}
