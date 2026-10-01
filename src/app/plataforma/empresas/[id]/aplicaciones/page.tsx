import { cambiarAplicacionDeEmpresa } from "@/app/actions/organizaciones";
import { ActionForm, ActionSubmit, Badge } from "@/components/ui";
import { APP_MODULES, MODULE_INFO, type AppModule } from "@/lib/modules";
import { leerEmpresa } from "@/lib/plataforma.server";

/**
 * Aplicaciones de la empresa: lo que ve en su menú. Contratar o dar de baja es
 * una decisión comercial de la plataforma; la base vuelve a comprobar al dueño.
 */
export default async function EmpresaAplicacionesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { empresa } = await leerEmpresa(id);

  const grupos: { titulo: string; modulos: AppModule[] }[] = [
    { titulo: "Dentro de Atlas", modulos: APP_MODULES.filter((modulo) => MODULE_INFO[modulo].dentro) },
    { titulo: "Otros productos de la suite", modulos: APP_MODULES.filter((modulo) => !MODULE_INFO[modulo].dentro) },
  ];

  return (
    <div className="space-y-8">
      <p className="text-[13px] text-muted-foreground">
        Dar de baja una aplicación la saca del menú de la empresa, también si alguien escribe la dirección a mano. Sus datos no se borran.
      </p>
      {grupos.map((grupo) => (
        <section key={grupo.titulo} className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight text-foreground">{grupo.titulo}</h2>
          <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            {grupo.modulos.map((modulo) => {
              const info = MODULE_INFO[modulo];
              const activa = empresa.aplicaciones.includes(modulo);
              return (
                <li key={modulo} className="flex items-center gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {info.label}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">{info.producto}</span>
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{info.description}</p>
                  </div>
                  <span className="hidden w-28 sm:block">
                    <Badge tone={activa ? "success" : "neutral"}>{activa ? "Contratada" : "Sin contratar"}</Badge>
                  </span>
                  <ActionForm
                    action={cambiarAplicacionDeEmpresa}
                    success={activa ? `${info.label} dada de baja` : `${info.label} contratada`}
                    confirm={
                      activa
                        ? {
                            title: `¿Dar de baja ${info.label}?`,
                            description: `Desaparece del menú de las ${empresa.miembrosActivos} personas activas de ${empresa.nombre}. Sus datos no se borran y se vuelve a contratar cuando quieras.`,
                            confirmLabel: `Dar de baja ${info.label}`,
                          }
                        : undefined
                    }
                  >
                    <input type="hidden" name="empresa_id" value={empresa.id} />
                    <input type="hidden" name="modulo" value={modulo} />
                    <input type="hidden" name="activar" value={activa ? "false" : "true"} />
                    <ActionSubmit variant={activa ? "ghost" : "secondary"} size="sm" className="w-28">
                      {activa ? "Dar de baja" : "Contratar"}
                    </ActionSubmit>
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
