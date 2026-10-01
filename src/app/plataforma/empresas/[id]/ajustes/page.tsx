import { cambiarEstadoEmpresa } from "@/app/actions/organizaciones";
import { ActionForm, ActionSubmit } from "@/components/ui";
import { EDICION_INFO } from "@/lib/ediciones";
import { fechaCorta, leerEmpresa } from "@/lib/plataforma.server";

/**
 * Ajustes de la empresa. Suspender vive acá, en su propia pestaña y al final,
 * lejos de lo que se toca a diario.
 */
export default async function EmpresaAjustesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { empresa } = await leerEmpresa(id);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Datos</h2>
        <dl className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <Dato etiqueta="Nombre" valor={empresa.nombre} />
          <Dato etiqueta="Clave" valor={empresa.slug} nota="Se usa en integraciones; no se cambia." />
          <Dato etiqueta="Edición" valor={EDICION_INFO[empresa.edicion].label} nota="Define su plantilla y su color." />
          <Dato etiqueta="Creada" valor={fechaCorta(empresa.creada)} />
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
          {empresa.activa ? "Suspender la empresa" : "Reactivar la empresa"}
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-danger/25 bg-surface px-5 py-4 shadow-sm">
          <p className="max-w-xl text-sm text-muted-foreground">
            {empresa.activa
              ? "Nadie de la empresa podrá entrar ni operar mientras esté suspendida. Sus datos no se borran y se reactiva desde acá."
              : "La empresa vuelve a operar con sus datos, su gente y sus aplicaciones tal como quedaron."}
          </p>
          <ActionForm
            action={cambiarEstadoEmpresa}
            success={empresa.activa ? "Empresa suspendida" : "Empresa reactivada"}
            confirm={
              empresa.activa
                ? {
                    title: `¿Suspender ${empresa.nombre}?`,
                    description: `${empresa.miembrosActivos} ${empresa.miembrosActivos === 1 ? "persona pierde" : "personas pierden"} el acceso de inmediato y su operación se detiene. Los datos se conservan y puedes reactivarla desde acá.`,
                    confirmLabel: "Suspender empresa",
                    typeToConfirm: empresa.slug,
                  }
                : undefined
            }
          >
            <input type="hidden" name="empresa_id" value={empresa.id} />
            <input type="hidden" name="activa" value={empresa.activa ? "false" : "true"} />
            <ActionSubmit variant={empresa.activa ? "danger" : "secondary"}>
              {empresa.activa ? "Suspender" : "Reactivar"}
            </ActionSubmit>
          </ActionForm>
        </div>
      </section>
    </div>
  );
}

function Dato({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota?: string }) {
  return (
    <div className="grid gap-1 px-5 py-3.5 sm:grid-cols-[180px_1fr]">
      <dt className="text-[13px] text-muted-foreground">{etiqueta}</dt>
      <dd className="text-sm text-foreground">
        {valor}
        {nota && <span className="ml-2 text-xs text-muted-foreground">{nota}</span>}
      </dd>
    </div>
  );
}
