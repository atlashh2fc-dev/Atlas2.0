import { unstable_noStore as noStore } from "next/cache";

import {
  cambiarAplicacionDeEmpresa,
  cambiarEstadoEmpresa,
  crearEmpresa,
  moverPersonaDeEmpresa,
} from "@/app/actions/organizaciones";
import { CreatePanel } from "@/components/create-panel";
import {
  ActionForm,
  ActionSubmit,
  Badge,
  Callout,
  Field,
  Input,
  PageHeader,
  SectionCard,
  Select,
  Table,
  TableEmpty,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { APP_MODULES, MODULE_INFO, type AppModule } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";

/**
 * Empresas del CRM.
 *
 * Cada empresa es una frontera real: su gente, sus campañas, sus leads y sus
 * informes no se cruzan. Quien administra Geimser ve solo Geimser; el dueño de
 * la plataforma ve todas y es el único que puede crearlas o mover personas.
 */
export default async function EmpresasAdminPage() {
  // Crear una empresa o mover a alguien cambia lo que esta misma pantalla debe
  // mostrar: se lee siempre fresco.
  noStore();
  await requireProfile(["admin"]);
  const supabase = await createClient();

  const [
    { data: esDuenio },
    { data: empresas },
    { data: personas },
    { data: campanas },
    { data: aplicaciones },
  ] =
    await Promise.all([
      supabase.rpc("is_platform_owner"),
      supabase
        .from("organizations")
        .select("id, slug, name, active, created_at")
        .order("name"),
      supabase
        .from("profiles")
        .select("id, full_name, email, role, active, organization_id")
        .order("full_name"),
      supabase.from("campaigns").select("id, organization_id"),
      supabase.rpc("aplicaciones_de_las_empresas"),
    ]);

  const duenioDePlataforma = esDuenio === true;
  const listaEmpresas = empresas ?? [];
  const listaPersonas = personas ?? [];

  const personasPorEmpresa = new Map<string, number>();
  for (const persona of listaPersonas) {
    if (!persona.organization_id) continue;
    personasPorEmpresa.set(
      persona.organization_id,
      (personasPorEmpresa.get(persona.organization_id) ?? 0) + 1,
    );
  }

  const campanasPorEmpresa = new Map<string, number>();
  for (const campana of campanas ?? []) {
    if (!campana.organization_id) continue;
    campanasPorEmpresa.set(
      campana.organization_id,
      (campanasPorEmpresa.get(campana.organization_id) ?? 0) + 1,
    );
  }

  const nombrePorEmpresa = new Map(listaEmpresas.map((empresa) => [empresa.id, empresa.name]));

  // Qué aplicaciones tiene contratada cada empresa. Lo que no está en la lista
  // está apagado: una app se contrata, no se hereda.
  const contratadas = new Set<string>();
  for (const fila of (aplicaciones ?? []) as { organization_id: string; module: string | null; enabled: boolean }[]) {
    if (fila.module && fila.enabled) contratadas.add(`${fila.organization_id}:${fila.module}`);
  }
  const tieneApp = (empresaId: string, modulo: AppModule) => contratadas.has(`${empresaId}:${modulo}`);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Empresas"
        description="Cada empresa tiene su propia operación dentro de Atlas 2.0. Nada de una se ve desde otra."
        actions={
          duenioDePlataforma ? (
            <CreatePanel
              label="Nueva empresa"
              title="Nueva empresa"
              description="Nace vacía: sin campañas, sin leads y sin personas. Después mueves o creas su equipo."
              action={crearEmpresa}
              submitLabel="Crear empresa"
              successLabel="Empresa creada"
            >
              <Field label="Nombre">
                <Input name="nombre" required placeholder="Altius Ignite" data-autofocus />
              </Field>
              <Field label="Clave">
                <Input name="slug" required placeholder="altius" />
                <p className="mt-1 text-xs text-muted-foreground">
                  Identificador corto en minúsculas. Se usa en integraciones y no se cambia después.
                </p>
              </Field>
            </CreatePanel>
          ) : null
        }
      />

      {!duenioDePlataforma && (
        <Callout tone="info">
          Estás viendo solo tu empresa. Crear empresas y mover personas entre ellas es
          exclusivo del dueño de la plataforma.
        </Callout>
      )}

      <SectionCard title="Empresas" description="Personas y campañas que tiene cada una.">
        <Table>
          <Thead>
            <Tr>
              <Th>Empresa</Th>
              <Th>Clave</Th>
              <Th>Personas</Th>
              <Th>Campañas</Th>
              <Th>Estado</Th>
              {duenioDePlataforma && <Th>Acción</Th>}
            </Tr>
          </Thead>
          <Tbody>
            {listaEmpresas.length === 0 && (
              <TableEmpty colSpan={duenioDePlataforma ? 6 : 5}>
                No hay empresas visibles para tu cuenta.
              </TableEmpty>
            )}
            {listaEmpresas.map((empresa) => (
              <Tr key={empresa.id}>
                <Td className="font-medium text-foreground">{empresa.name}</Td>
                <Td className="text-muted-foreground">{empresa.slug}</Td>
                <Td>{personasPorEmpresa.get(empresa.id) ?? 0}</Td>
                <Td>{campanasPorEmpresa.get(empresa.id) ?? 0}</Td>
                <Td>
                  <Badge tone={empresa.active ? "success" : "neutral"}>
                    {empresa.active ? "Activa" : "Suspendida"}
                  </Badge>
                </Td>
                {duenioDePlataforma && (
                  <Td>
                    <ActionForm
                      action={cambiarEstadoEmpresa}
                      success={empresa.active ? "Empresa suspendida" : "Empresa activada"}
                    >
                      <input type="hidden" name="empresa_id" value={empresa.id} />
                      <input type="hidden" name="activa" value={empresa.active ? "false" : "true"} />
                      <ActionSubmit variant="ghost" size="sm">
                        {empresa.active ? "Suspender" : "Activar"}
                      </ActionSubmit>
                    </ActionForm>
                  </Td>
                )}
              </Tr>
            ))}
          </Tbody>
        </Table>
      </SectionCard>

      {duenioDePlataforma && (
        <SectionCard
          title="Aplicaciones de la suite"
          description="Cada empresa ve en su menú solo lo que tiene contratado. Apagar una aplicación la hace desaparecer, también si alguien escribe la dirección a mano."
        >
          <div className="space-y-5">
            {listaEmpresas.map((empresa) => (
              <div key={empresa.id}>
                <p className="mb-2 text-sm font-medium text-foreground">{empresa.name}</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {APP_MODULES.map((modulo) => {
                    const info = MODULE_INFO[modulo];
                    const activa = tieneApp(empresa.id, modulo);
                    return (
                      <div
                        key={modulo}
                        className={`rounded-lg border p-3 ${activa ? "border-border bg-surface" : "border-dashed border-border"}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{info.label}</p>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                              {info.producto}
                              {!info.dentro && " · sistema aparte"}
                            </p>
                          </div>
                          <Badge tone={activa ? "success" : "neutral"}>{activa ? "Activa" : "Apagada"}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{info.description}</p>
                        <ActionForm
                          action={cambiarAplicacionDeEmpresa}
                          success={activa ? "Aplicación dada de baja" : "Aplicación contratada"}
                        >
                          <input type="hidden" name="empresa_id" value={empresa.id} />
                          <input type="hidden" name="modulo" value={modulo} />
                          <input type="hidden" name="activar" value={activa ? "false" : "true"} />
                          <ActionSubmit variant="ghost" size="sm">
                            {activa ? "Dar de baja" : "Contratar"}
                          </ActionSubmit>
                        </ActionForm>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Personas"
        description={
          duenioDePlataforma
            ? "Mover a alguien de empresa cambia todo lo que puede ver, de inmediato."
            : "Las personas de tu empresa."
        }
      >
        <Table>
          <Thead>
            <Tr>
              <Th>Persona</Th>
              <Th>Correo</Th>
              <Th>Rol</Th>
              <Th>Empresa</Th>
              {duenioDePlataforma && <Th>Mover a</Th>}
            </Tr>
          </Thead>
          <Tbody>
            {listaPersonas.length === 0 && (
              <TableEmpty colSpan={duenioDePlataforma ? 5 : 4}>Sin personas.</TableEmpty>
            )}
            {listaPersonas.map((persona) => (
              <Tr key={persona.id}>
                <Td className="font-medium text-foreground">
                  {persona.full_name}
                  {!persona.active && <span className="ml-2 text-xs text-muted-foreground">(inactiva)</span>}
                </Td>
                <Td className="text-muted-foreground">{persona.email}</Td>
                <Td>{persona.role}</Td>
                <Td>{nombrePorEmpresa.get(persona.organization_id ?? "") ?? "—"}</Td>
                {duenioDePlataforma && (
                  <Td>
                    <ActionForm action={moverPersonaDeEmpresa} success="Persona movida">
                      <input type="hidden" name="perfil_id" value={persona.id} />
                      <div className="flex items-center gap-2">
                        <Select name="empresa_id" defaultValue={persona.organization_id ?? ""}>
                          {listaEmpresas.map((empresa) => (
                            <option key={empresa.id} value={empresa.id}>
                              {empresa.name}
                            </option>
                          ))}
                        </Select>
                        <ActionSubmit variant="ghost" size="sm">
                          Mover
                        </ActionSubmit>
                      </div>
                    </ActionForm>
                  </Td>
                )}
              </Tr>
            ))}
          </Tbody>
        </Table>
      </SectionCard>
    </div>
  );
}
