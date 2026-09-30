import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { LogoDeIntegracion } from "@/components/logo-integracion";
import { modulosActivos } from "@/lib/modules.server";

export default async function WhatsAppIntegracionLayout({ children }: { children: React.ReactNode }) {
  // Sin WhatsApp contratado se vuelve al catálogo, que es la misma sección del
  // menú: un 404 dejaría al admin fuera de Integraciones al cambiar de empresa.
  if (!(await modulosActivos()).includes("whatsapp")) redirect("/dashboard/admin/integraciones");

  return (
    <div className="space-y-5">
      <div className="space-y-3 border-b border-border pb-4">
        <Link
          href="/dashboard/admin/integraciones"
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft size={16} aria-hidden="true" />
          Integraciones
        </Link>
        <div className="flex items-center gap-3">
          <LogoDeIntegracion logo="whatsapp" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">WhatsApp Business</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Atiende por WhatsApp desde el CRM: el número de la empresa sigue funcionando en el teléfono.
            </p>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
