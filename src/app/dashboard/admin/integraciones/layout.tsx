import { requireProfile } from "@/lib/auth";
import { requireModule } from "@/lib/modules.server";
import { PageHeader } from "@/components/ui";

/**
 * Las integraciones son un único destino: el nombre del proveedor vive dentro
 * de la página, no en el menú (docs/arquitectura-navegacion.md §4.4).
 */
export default async function IntegracionesLayout({ children }: { children: React.ReactNode }) {
  await requireModule("whatsapp");
  await requireProfile(["admin"]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Integraciones"
        description="Conexión de WhatsApp Business."
        className="border-b-0 pb-0"
      />
      {children}
    </div>
  );
}
