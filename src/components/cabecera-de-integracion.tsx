import Link from "next/link";

import { LogoDeIntegracion, type LogoIntegracion } from "@/components/logo-integracion";

/**
 * Cabecera de cada integración: la ruta de vuelta al catálogo, el logo oficial,
 * el nombre y para qué sirve. Misma forma que la cabecera de una campaña o una
 * cola: la integración se lee como una entidad del producto.
 */
export function CabeceraDeIntegracion({ logo, titulo, descripcion }: { logo: LogoIntegracion; titulo: string; descripcion: string }) {
  return (
    <div className="space-y-4">
      <nav aria-label="Ruta" className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Link href="/dashboard/admin/integraciones" className="transition-colors hover:text-foreground">
          Integraciones
        </Link>
        <span aria-hidden="true" className="text-border-strong">
          /
        </span>
        <span aria-current="page" className="truncate text-foreground">
          {titulo}
        </span>
      </nav>
      <div className="flex items-start gap-3.5">
        <LogoDeIntegracion logo={logo} />
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-foreground">{titulo}</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{descripcion}</p>
        </div>
      </div>
    </div>
  );
}
