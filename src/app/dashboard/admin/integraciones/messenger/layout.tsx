import { redirect } from "next/navigation";

import { CabeceraDeIntegracion } from "@/components/cabecera-de-integracion";
import { modulosActivos } from "@/lib/modules.server";

export default async function MessengerIntegracionLayout({ children }: { children: React.ReactNode }) {
  // Messenger entra a la bandeja de mensajería, que es parte del módulo WhatsApp.
  if (!(await modulosActivos()).includes("whatsapp")) redirect("/dashboard/admin/integraciones");

  return (
    <div className="space-y-5">
      <CabeceraDeIntegracion
        logo="messenger"
        titulo="Facebook Messenger"
        descripcion="Los mensajes a la página de Facebook llegan a la bandeja y se responden desde el CRM."
      />
      {children}
    </div>
  );
}
