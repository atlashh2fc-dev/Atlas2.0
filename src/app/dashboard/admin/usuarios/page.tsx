import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  updateUserRole,
  toggleUserActive,
  createTeam,
  createUserAccount,
  updateTeamSupervisor,
} from "@/app/actions/admin";
import type { AppRole } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  SectionCard,
  Select,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@/components/ui";

const ROLES: AppRole[] = ["agente", "supervisor", "admin"];

export default async function UsersAdminPage() {
  await requireProfile(["admin"]);
  const supabase = await createClient();

  const { data: users } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });

  const { data: teams } = await supabase.from("teams").select("*").order("name");

  const supervisors = (users ?? []).filter((u) => u.role === "supervisor");
  const supervisorName = (id: string | null) =>
    supervisors.find((s) => s.id === id)?.full_name ?? "Sin supervisor";
  const teamOf = (teamId: string | null) => (teams ?? []).find((t) => t.id === teamId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuarios"
        description="Gestiona roles, equipos y crea nuevas cuentas directamente desde aquí."
      />

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Crear usuario</h2>
        <form action={createUserAccount} className="flex flex-wrap items-end gap-2">
          <Field label="Nombre" className="w-44">
            <Input type="text" name="full_name" required placeholder="Nombre completo" />
          </Field>
          <Field label="Correo" className="w-52">
            <Input type="email" name="email" required placeholder="correo@ejemplo.com" />
          </Field>
          <Field label="Contraseña" className="w-40">
            <Input type="text" name="password" required minLength={6} placeholder="Mínimo 6 caracteres" />
          </Field>
          <Field label="Rol">
            <Select name="role" defaultValue="agente" className="w-auto">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Equipo">
            <Select name="team_id" defaultValue="" className="w-auto">
              <option value="">Sin equipo</option>
              {(teams ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit">Crear usuario</Button>
        </form>
      </Card>

      <SectionCard>
        <Table>
          <Thead>
            <Th>Nombre</Th>
            <Th>Correo</Th>
            <Th>Rol</Th>
            <Th>Equipo</Th>
            <Th>Supervisor</Th>
            <Th>Estado</Th>
            <Th />
          </Thead>
          <Tbody>
            {(users ?? []).map((u) => (
              <Tr key={u.id}>
                <Td strong>{u.full_name}</Td>
                <Td muted>{u.email}</Td>
                <Td>
                  <form action={updateUserRole} className="flex items-center gap-2">
                    <input type="hidden" name="user_id" value={u.id} />
                    <Select name="role" fieldSize="sm" defaultValue={u.role} className="w-auto">
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </Select>
                    <Select name="team_id" fieldSize="sm" defaultValue={u.team_id ?? ""} className="w-auto">
                      <option value="">Sin equipo</option>
                      {(teams ?? []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" size="sm">
                      Guardar
                    </Button>
                  </form>
                </Td>
                <Td muted>{teamOf(u.team_id)?.name ?? "—"}</Td>
                <Td muted>
                  {u.role === "agente" ? supervisorName(teamOf(u.team_id)?.supervisor_id ?? null) : "—"}
                </Td>
                <Td>
                  <Badge tone={u.active ? "success" : "danger"}>{u.active ? "Activo" : "Inactivo"}</Badge>
                </Td>
                <Td align="right">
                  <form action={toggleUserActive}>
                    <input type="hidden" name="user_id" value={u.id} />
                    <input type="hidden" name="active" value={String(u.active)} />
                    <Button type="submit" variant="secondary" size="sm">
                      {u.active ? "Desactivar" : "Activar"}
                    </Button>
                  </form>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </SectionCard>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Equipos</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          El supervisor de un equipo define de quién dependen sus agentes (según el equipo asignado a cada
          usuario arriba).
        </p>
        <ul className="mb-4 space-y-2 text-sm">
          {(teams ?? []).map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
            >
              <span className="font-medium text-foreground">{t.name}</span>
              <form action={updateTeamSupervisor} className="flex items-center gap-2">
                <input type="hidden" name="team_id" value={t.id} />
                <Select name="supervisor_id" fieldSize="sm" defaultValue={t.supervisor_id ?? ""} className="w-auto">
                  <option value="">Sin supervisor</option>
                  {supervisors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </Select>
                <Button type="submit" size="sm">
                  Guardar
                </Button>
              </form>
            </li>
          ))}
          {(teams ?? []).length === 0 && <li className="text-muted-foreground">No hay equipos creados.</li>}
        </ul>
        <form action={createTeam} className="flex max-w-lg flex-wrap items-end gap-2">
          <Field label="Nombre del equipo">
            <Input type="text" name="name" required placeholder="Nombre del equipo" />
          </Field>
          <Field label="Supervisor">
            <Select name="supervisor_id" defaultValue="" className="w-auto">
              <option value="">Sin supervisor</option>
              {supervisors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit">Crear</Button>
        </form>
      </Card>
    </div>
  );
}
