export type AppRole = "agente" | "supervisor" | "admin";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: AppRole;
  team_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  name: string;
  supervisor_id: string | null;
  created_at: string;
}

export interface Lead {
  id: string;
  rut: string | null;
  phone: string | null;
  full_name: string;
  email: string | null;
  status: string;
  assigned_to: string | null;
  team_id: string | null;
  extra: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Interaction {
  id: string;
  lead_id: string;
  agent_id: string;
  result: string;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowStep {
  id: string;
  workflow_id: string;
  step_order: number;
  name: string;
  description: string | null;
  is_mandatory: boolean;
  allowed_results: string[] | null;
  created_at: string;
}

export interface LeadWorkflowProgress {
  lead_id: string;
  workflow_id: string | null;
  total_mandatory_steps: number;
  completed_mandatory_steps: number;
  next_step_id: string | null;
  next_step_name: string | null;
  next_step_order: number | null;
  next_step_mandatory: boolean | null;
  next_step_allowed_results: string[] | null;
  is_compliant: boolean;
}

export interface AgentPerformance {
  agent_id: string;
  full_name: string;
  team_id: string | null;
  team_name: string | null;
  total_interactions: number;
  leads_managed: number;
  conversions: number;
  avg_first_response_seconds: number | null;
}

export interface WorkflowCompliance {
  workflow_id: string;
  workflow_name: string;
  total_leads: number;
  compliant_leads: number;
  compliance_rate: number | null;
}

export const LEAD_STATUSES = [
  { value: "nuevo", label: "Nuevo" },
  { value: "en_gestion", label: "En gestión" },
  { value: "contactado", label: "Contactado" },
  { value: "no_contactado", label: "No contactado" },
  { value: "agendado", label: "Agendado" },
  { value: "convertido", label: "Convertido" },
  { value: "descartado", label: "Descartado" },
] as const;

export const INTERACTION_RESULTS = [
  "Contactado - Interesado",
  "Contactado - No interesado",
  "No contesta",
  "Número equivocado",
  "Buzón de voz",
  "Volver a llamar",
  "Agendado",
  "Venta cerrada",
] as const;
