import { redirect } from "next/navigation";

import { CabeceraDeIntegracion } from "@/components/cabecera-de-integracion";
import { modulosActivos } from "@/lib/modules.server";

export default async function InstagramIntegracionLayout({ children }: { children: React.ReactNode }) {
  // Instagram entra a la bandeja de mensajería, que es parte del módulo WhatsApp.
  if (!(await modulosActivos()).includes("whatsapp")) redirect("/dashboard/admin/integraciones");

  return (
    <div className="space-y-5">
      <CabeceraDeIntegracion
        logo="instagram"
        titulo="Instagram Direct"
        descripcion="Los mensajes directos de la cuenta profesional llegan a la bandeja y se responden desde el CRM."
      />
      {children}
    </div>
  );
}
