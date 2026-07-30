import { requireProfile } from "@/lib/auth";
import { NavTabs, PageHeader } from "@/components/ui";
import { getTabs } from "@/lib/nav.config";

/**
 * Las integraciones son un único destino: el nombre del proveedor vive dentro
 * de la página, no en el menú (docs/arquitectura-navegacion.md §4.4).
 */
export default async function IntegracionesLayout({ children }: { children: React.ReactNode }) {
  await requireProfile(["admin"]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Integraciones"
        description="Equifax: importación de gestión desde Vocalcom y ejecutivos heredados."
        className="border-b-0 pb-0"
      />
      <NavTabs tabs={getTabs("integraciones")} />
      {children}
    </div>
  );
}
