import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { LogoDeIntegracion, type LogoIntegracion } from "@/components/logo-integracion";

/** Cabecera de cada integración: volver al catálogo, logo oficial, nombre y para qué sirve. */
export function CabeceraDeIntegracion({ logo, titulo, descripcion }: { logo: LogoIntegracion; titulo: string; descripcion: string }) {
  return (
    <div className="space-y-3 border-b border-border pb-4">
      <Link
        href="/dashboard/admin/integraciones"
        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft size={16} aria-hidden="true" />
        Integraciones
      </Link>
      <div className="flex items-center gap-3">
        <LogoDeIntegracion logo={logo} />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{titulo}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{descripcion}</p>
        </div>
      </div>
    </div>
  );
}
