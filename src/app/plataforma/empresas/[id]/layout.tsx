import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight } from "lucide-react";

import { Badge, NavTabs, buttonClasses } from "@/components/ui";
import { EDICION_INFO } from "@/lib/ediciones";
import { iniciales, leerEmpresa } from "@/lib/plataforma.server";

/**
 * Una empresa vista desde la plataforma. Como en Clerk o WorkOS, la empresa
 * es la unidad: su gente, sus aplicaciones y sus ajustes cuelgan de ella en
 * pestañas. Lo único destacado es entrar a su CRM.
 */
export default async function EmpresaLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  await connection();
  const { id } = await params;
  const { empresa } = await leerEmpresa(id);
  const base = `/plataforma/empresas/${empresa.id}`;

  return (
    <div className="space-y-6">
      <nav aria-label="Ruta" className="text-[13px] text-muted-foreground">
        <Link href="/plataforma" className="hover:text-foreground">
          Empresas
        </Link>
        <span className="mx-1.5 text-border-strong">/</span>
        <span className="text-foreground">{empresa.nombre}</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            data-edicion={empresa.edicion}
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-base font-semibold text-primary"
          >
            {iniciales(empresa.nombre)}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">{empresa.nombre}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
              <span>{EDICION_INFO[empresa.edicion].label}</span>
              <span>{empresa.slug}</span>
              <Badge tone={empresa.activa ? "success" : "neutral"}>{empresa.activa ? "Activa" : "Suspendida"}</Badge>
            </p>
          </div>
        </div>
        {/* Una visita real elige la empresa y abre su CRM; no es un enlace de
            Next porque precargarlo no debe cambiar la empresa activa. */}
        {empresa.activa && (
          <a href={`/cambiar-empresa?empresa=${empresa.id}&volver=/dashboard`} className={buttonClasses()}>
            Abrir su CRM
            <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        )}
      </div>

      <NavTabs
        tabs={[
          { label: "Resumen", href: base },
          { label: "Miembros", href: `${base}/miembros`, badge: undefined },
          { label: "Aplicaciones", href: `${base}/aplicaciones` },
          { label: "Ajustes", href: `${base}/ajustes` },
        ]}
      />

      <div className="pt-2">{children}</div>
    </div>
  );
}
