import { unstable_noStore as noStore } from "next/cache";

import { crearEmpresa } from "@/app/actions/organizaciones";
import { CreatePanel } from "@/components/create-panel";
import { CamposNuevaEmpresa } from "@/components/plataforma/campos-nueva-empresa";
import { ListaDeEmpresas } from "@/components/plataforma/lista-de-empresas";
import { Field, PageHeader, Select } from "@/components/ui";
import { EDICIONES, EDICION_INFO } from "@/lib/ediciones";
import { haceCuanto, iniciales, leerPlataforma } from "@/lib/plataforma.server";

/**
 * Inicio de la consola: las empresas que usan Atlas. Todo lo demás —su gente,
 * sus aplicaciones, su estado— se ve entrando a cada una. La única acción
 * primaria es crear una empresa.
 */
export default async function PlataformaEmpresasPage() {
  noStore();
  const { empresas } = await leerPlataforma();
  const activas = empresas.filter((empresa) => empresa.activa).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Empresas"
        description={`${activas} ${activas === 1 ? "empresa activa" : "empresas activas"}. Cada una es un cliente de Atlas con su propia gente y su propia operación; Altius incluida.`}
        actions={
          <CreatePanel
            label="Nueva empresa"
            title="Nueva empresa"
            description="Nace con la plantilla de su edición: aplicaciones, etapas del embudo y catálogo. Después invitas a su equipo desde su CRM."
            action={crearEmpresa}
            submitLabel="Crear empresa"
            successLabel="Empresa creada"
          >
            <CamposNuevaEmpresa />
            <Field label="Edición">
              <Select name="edicion" required defaultValue="center">
                {EDICIONES.map((edicion) => (
                  <option key={edicion} value={edicion}>
                    {EDICION_INFO[edicion].label}
                  </option>
                ))}
              </Select>
            </Field>
          </CreatePanel>
        }
      />

      <ListaDeEmpresas
        filas={empresas.map((empresa) => ({
          id: empresa.id,
          nombre: empresa.nombre,
          slug: empresa.slug,
          edicion: empresa.edicion,
          edicionNombre: EDICION_INFO[empresa.edicion].label,
          activa: empresa.activa,
          miembrosActivos: empresa.miembrosActivos,
          aplicaciones: empresa.aplicaciones.length,
          actividad: haceCuanto(empresa.ultimaActividad),
          iniciales: iniciales(empresa.nombre),
        }))}
      />
    </div>
  );
}
