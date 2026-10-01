import Link from "next/link";

import { EDICION_INFO } from "@/lib/ediciones";
import { MODULE_INFO } from "@/lib/modules";
import { fechaCorta, haceCuanto, leerEmpresa } from "@/lib/plataforma.server";

/**
 * Resumen de la empresa: si la usan, quién la administra y qué tiene. Es lo
 * que se mira antes de hablar con el cliente.
 */
export default async function EmpresaResumenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { empresa } = await leerEmpresa(id);
  const base = `/plataforma/empresas/${empresa.id}`;
  const administradores = empresa.miembros.filter((miembro) => miembro.rol === "admin" && miembro.activo);

  return (
    <div className="space-y-8">
      <dl className="grid grid-cols-2 rounded-xl border border-border bg-surface shadow-sm lg:grid-cols-4 lg:divide-x lg:divide-border">
        <Cifra etiqueta="Miembros activos" valor={String(empresa.miembrosActivos)} />
        <Cifra etiqueta="Campañas" valor={String(empresa.campanas)} />
        <Cifra etiqueta="Aplicaciones" valor={String(empresa.aplicaciones.length)} />
        <Cifra etiqueta="Último ingreso" valor={haceCuanto(empresa.ultimaActividad)} />
      </dl>

      <div className="grid gap-8 lg:grid-cols-2">
        <Bloque titulo="Administradores" accion={{ href: `${base}/miembros`, texto: "Ver miembros" }}>
          {administradores.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              Nadie la administra todavía. Crea su primer administrador desde su CRM, en Configuración → Usuarios.
            </p>
          ) : (
            <ul className="divide-y divide-border/70">
              {administradores.map((miembro) => (
                <li key={miembro.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{miembro.nombre}</span>
                    {miembro.correo && <span className="block truncate text-xs text-muted-foreground">{miembro.correo}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{haceCuanto(miembro.ultimoIngreso)}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloque>

        <Bloque titulo="Aplicaciones contratadas" accion={{ href: `${base}/aplicaciones`, texto: "Cambiar" }}>
          {empresa.aplicaciones.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">Ninguna. Sin aplicaciones, su menú queda vacío.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {empresa.aplicaciones.map((modulo) => (
                <li key={modulo} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="font-medium text-foreground">{MODULE_INFO[modulo].label}</span>
                  <span className="text-xs text-muted-foreground">{MODULE_INFO[modulo].producto}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloque>
      </div>

      <p className="text-[13px] text-muted-foreground">
        {EDICION_INFO[empresa.edicion].label} · creada el {fechaCorta(empresa.creada)} · clave {empresa.slug}
      </p>
    </div>
  );
}

function Cifra({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-[13px] text-muted-foreground">{etiqueta}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-foreground">{valor}</dd>
    </div>
  );
}

function Bloque({
  titulo,
  accion,
  children,
}: {
  titulo: string;
  accion: { href: string; texto: string };
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold tracking-tight text-foreground">{titulo}</h2>
        <Link href={accion.href} className="text-[13px] font-medium text-primary hover:underline">
          {accion.texto}
        </Link>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">{children}</div>
    </section>
  );
}
