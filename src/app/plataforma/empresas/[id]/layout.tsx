import { connection } from "next/server";
import { ArrowUpRight } from "lucide-react";

import { Badge, NavTabs, buttonClasses } from "@/components/ui";
import { EDICION_INFO } from "@/lib/ediciones";
import { leerEmpresa } from "@/lib/plataforma.server";
import { CabeceraDeEntidad, Migas } from "@/app/dashboard/admin/_diseno";

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
      <Migas items={[{ label: "Empresas", href: "/plataforma" }, { label: empresa.nombre }]} />

      <CabeceraDeEntidad
        nombre={empresa.nombre}
        seed={empresa.slug}
        apagada={!empresa.activa}
        meta={
          <>
            <Badge tone={empresa.activa ? "success" : "neutral"}>{empresa.activa ? "Activa" : "Suspendida"}</Badge>
            <span>{EDICION_INFO[empresa.edicion].label}</span>
            <span className="font-mono text-[11px]">{empresa.slug}</span>
          </>
        }
        acciones={
          /* Una visita real elige la empresa y abre su CRM; no es un enlace de
             Next porque precargarlo no debe cambiar la empresa activa. */
          empresa.activa ? (
            <a href={`/cambiar-empresa?empresa=${empresa.id}&volver=/dashboard`} className={buttonClasses()}>
              Abrir su CRM
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          ) : undefined
        }
      />

      <NavTabs
        tabs={[
          { label: "Resumen", href: base },
          { label: "Miembros", href: `${base}/miembros`, badge: undefined },
          { label: "Aplicaciones", href: `${base}/aplicaciones` },
          { label: "Ajustes", href: `${base}/ajustes` },
        ]}
      />

      <div className="pt-1">{children}</div>
    </div>
  );
}
