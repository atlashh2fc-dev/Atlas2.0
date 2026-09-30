import { redirect } from "next/navigation";

import { CabeceraDeIntegracion } from "@/components/cabecera-de-integracion";
import { modulosActivos } from "@/lib/modules.server";

export default async function WhatsAppIntegracionLayout({ children }: { children: React.ReactNode }) {
  // Sin WhatsApp contratado se vuelve al catálogo, que es la misma sección del
  // menú: un 404 dejaría al admin fuera de Integraciones al cambiar de empresa.
  if (!(await modulosActivos()).includes("whatsapp")) redirect("/dashboard/admin/integraciones");

  return (
    <div className="space-y-5">
      <CabeceraDeIntegracion
        logo="whatsapp"
        titulo="WhatsApp Business"
        descripcion="Atiende por WhatsApp desde el CRM: el número de la empresa sigue funcionando en el teléfono."
      />
      {children}
    </div>
  );
}
