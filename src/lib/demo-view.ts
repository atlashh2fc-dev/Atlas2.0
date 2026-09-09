import type { AppRole } from "@/lib/types";

/**
 * Cuentas de demostración.
 *
 * Mostrar el CRM exige recorrer el mismo dato desde dos miradas: el puesto del
 * ejecutivo y el tablero del supervisor. Abrir dos sesiones en medio de una
 * reunión rompe el hilo, y fingir la vista mentiría: en Atlas el rol es lo que
 * la RLS de Supabase usa para decidir qué datos entrega.
 *
 * Por eso el conmutador cambia de cuenta, no de rol. Cambiarle el rol al
 * ejecutivo lo sacaría de la lista de ejecutivos del equipo y sus gestiones
 * desaparecerían del reporte justo mientras se muestra el reporte.
 *
 * Admin queda fuera a propósito: un admin ve toda la base del CRM, no solo la
 * campaña de la demostración, y estas cuentas se le entregan a terceros.
 */
export type DemoViewRole = Extract<AppRole, "agente" | "supervisor">;

export type DemoViewAccount = {
  id: string;
  full_name: string;
  role: AppRole;
};

export const DEMO_VIEW_ROLES: DemoViewRole[] = ["agente", "supervisor"];

const ROLE_LABEL: Record<DemoViewRole, string> = {
  agente: "Ejecutivo",
  supervisor: "Supervisor",
};

export function isDemoViewRole(value: unknown): value is DemoViewRole {
  return value === "agente" || value === "supervisor";
}

export function demoViewRoleLabel(role: AppRole): string {
  return isDemoViewRole(role) ? ROLE_LABEL[role] : role;
}

/** Etiqueta del selector: "Ejecutivo · Camila Reyes". */
export function demoAccountLabel(account: DemoViewAccount): string {
  return `${demoViewRoleLabel(account.role)} · ${account.full_name.split(" ")[0]}`;
}

/**
 * Orden estable del selector: primero la vista del ejecutivo, que es por donde
 * parte cualquier demo, y dentro de cada rol por nombre.
 */
export function sortDemoAccounts(accounts: DemoViewAccount[]): DemoViewAccount[] {
  return [...accounts].sort((a, b) => {
    if (a.role !== b.role) return a.role === "agente" ? -1 : 1;
    return a.full_name.localeCompare(b.full_name, "es");
  });
}
