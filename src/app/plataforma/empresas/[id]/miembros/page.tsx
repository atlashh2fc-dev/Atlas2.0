import { MoverMiembro } from "@/components/plataforma/mover-miembro";
import { Badge, Table, TableEmpty, Tbody, Td, Th, Thead, Tr } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/nav.config";
import { haceCuanto, leerEmpresa } from "@/lib/plataforma.server";

/**
 * Miembros de la empresa. El día a día de su gente (crear, roles, equipos) lo
 * hace su propio administrador en su CRM; acá la plataforma solo ve quién está
 * y, si hace falta, mueve a alguien de empresa.
 */
export default async function EmpresaMiembrosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { empresa, empresas } = await leerEmpresa(id);
  const otras = empresas.filter((destino) => destino.id !== empresa.id);

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">
        {empresa.miembros.length} {empresa.miembros.length === 1 ? "miembro" : "miembros"}. Crear personas y cambiar roles lo
        hace su administrador desde su CRM.
      </p>
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <Table>
          <Thead>
            <Th>Persona</Th>
            <Th>Rol</Th>
            <Th>Último ingreso</Th>
            <Th>Estado</Th>
            <Th align="right">
              <span className="sr-only">Acciones</span>
            </Th>
          </Thead>
          <Tbody>
            {empresa.miembros.length === 0 && (
              <TableEmpty colSpan={5}>Sin miembros todavía. Su primer administrador se crea desde su CRM.</TableEmpty>
            )}
            {empresa.miembros.map((miembro) => (
              <Tr key={miembro.id}>
                <Td>
                  <p className="font-medium text-foreground">{miembro.nombre}</p>
                  {miembro.correo && <p className="mt-0.5 text-xs text-muted-foreground">{miembro.correo}</p>}
                </Td>
                <Td muted>
                  {ROLE_LABEL[miembro.rol] ?? miembro.rol}
                  {!miembro.principal && <span className="block text-xs">Invitado de otra empresa</span>}
                </Td>
                <Td muted>{haceCuanto(miembro.ultimoIngreso)}</Td>
                <Td>
                  <Badge tone={miembro.activo ? "success" : "neutral"}>{miembro.activo ? "Activo" : "Inactivo"}</Badge>
                </Td>
                <Td align="right">
                  {miembro.principal && otras.length > 0 && (
                    <MoverMiembro
                      perfilId={miembro.id}
                      nombre={miembro.nombre}
                      destinos={otras.map((destino) => ({ id: destino.id, nombre: destino.nombre }))}
                    />
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </div>
  );
}
