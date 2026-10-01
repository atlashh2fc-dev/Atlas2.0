import { MoverMiembro } from "@/components/plataforma/mover-miembro";
import { UsersRound } from "lucide-react";
import { Avatar, Badge, EmptyState, Table, TableEmpty, Tbody, Td, Th, Thead, Tr } from "@/components/ui";
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
              <TableEmpty colSpan={5}>
                <EmptyState
                  icon={UsersRound}
                  title="Sin miembros todavía"
                  description="Su primer administrador se crea desde su CRM, en Configuración → Usuarios."
                  className="py-4"
                />
              </TableEmpty>
            )}
            {empresa.miembros.map((miembro) => (
              <Tr key={miembro.id}>
                <Td>
                  <span className="flex items-center gap-3">
                    <Avatar name={miembro.nombre} size="md" className={miembro.activo ? "" : "opacity-50"} />
                    <span className="min-w-0">
                      <span className="block font-medium text-foreground">{miembro.nombre}</span>
                      {miembro.correo && <span className="block text-xs text-muted-foreground">{miembro.correo}</span>}
                    </span>
                  </span>
                </Td>
                <Td>
                  <span className="block text-foreground">{ROLE_LABEL[miembro.rol] ?? miembro.rol}</span>
                  {!miembro.principal && <span className="block text-xs text-muted-foreground">Invitado de otra empresa</span>}
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
