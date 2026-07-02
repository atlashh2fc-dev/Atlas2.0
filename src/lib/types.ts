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
  workflow_id?: string | null;
  tipificacion_actual: string | null;
  observacion_actual: string | null;
  next_action_at: string | null;
  workflow_status: string | null;
  assignment_status: string | null;
  managed_at: string | null;
  managed_by: string | null;
  campaign_id: string | null;
  crm_entity_id: string | null;
  external_last_source_code?: string | null;
  external_last_seen_at?: string | null;
  external_priority_rank?: number | null;
  external_priority_reason?: string | null;
  mail_priority_bucket?: string | null;
  mail_priority_rank?: number | null;
  mail_priority_reason?: string | null;
  mail_last_event_at?: string | null;
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

export type WorkflowFieldType = "single_choice" | "multi_select" | "combobox" | "text";

export const WORKFLOW_FIELD_TYPES: { value: WorkflowFieldType; label: string }[] = [
  { value: "single_choice", label: "Opción única (botones)" },
  { value: "combobox", label: "Lista desplegable" },
  { value: "multi_select", label: "Selección múltiple" },
  { value: "text", label: "Texto libre" },
];

export interface WorkflowStep {
  id: string;
  workflow_id: string;
  step_order: number;
  name: string;
  description: string | null;
  is_mandatory: boolean;
  allowed_results: string[] | null;
  field_type: WorkflowFieldType;
  options: string[];
  pos_x: number;
  pos_y: number;
  is_start: boolean;
  created_at: string;
}

export interface WorkflowStepBranch {
  id: string;
  workflow_id: string;
  from_step_id: string;
  from_option: string | null;
  to_step_id: string | null;
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
  next_step_field_type: WorkflowFieldType | null;
  next_step_options: string[] | null;
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

export interface Call {
  id: string;
  lead_id: string;
  agent_id: string;
  status: string | null;
  outcome: string | null;
  reason: string | null;
  notes: string | null;
  next_action_at: string | null;
  next_action_window: string | null;
  callback_owner_user_id: string | null;
  equifax_products: string[] | null;
  equifax_uf_amount: number | null;
  equifax_recipient_email: string | null;
  phone_status: string | null;
  started_at: string;
  ended_at: string | null;
  discarded_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallEvent {
  id: string;
  call_id: string;
  lead_id: string;
  agent_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  workflow_id: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignAgent {
  id: string;
  campaign_id: string;
  profile_id: string;
  assigned_at: string;
}

export interface CampaignPerformance {
  campaign_id: string;
  campaign_name: string;
  is_active: boolean;
  workflow_id: string | null;
  workflow_name: string | null;
  total_leads: number;
  managed_leads: number;
  conversions: number;
  managed_rate: number | null;
}

export interface CampaignDashboardSummaryMetric {
  current: number;
  previous: number;
}

export interface CampaignDashboardSummary {
  total_leads: number;
  range: {
    from: string;
    to: string;
    previous_from: string;
    previous_to: string;
  };
  kpis: {
    gestionadas: CampaignDashboardSummaryMetric;
    contactadas: CampaignDashboardSummaryMetric;
    ventas: CampaignDashboardSummaryMetric;
    uf_total: CampaignDashboardSummaryMetric;
    cotizaciones: number;
  };
  funnel: { name: string; value: number }[];
  reasons: { reason: string; count: number }[];
  products: { product: string; count: number; uf: number }[];
  time_series: { date: string; gestiones: number; ventas: number }[];
  agenda: {
    id: string;
    lead_full_name: string;
    agent_name: string;
    reason: string | null;
    next_action_at: string;
    overdue: boolean;
  }[];
  agents: {
    agent_id: string | null;
    name: string;
    gestiones: number;
    contactos: number;
    ventas: number;
    uf: number;
  }[];
}

export interface HomeDashboardSummary {
  stats: {
    total: number;
    enGestion: number;
    convertidos: number;
  };
  recent: {
    id: string;
    result: string;
    created_at: string;
    lead_name: string;
  }[];
  agenda: {
    id: string;
    full_name: string;
    rut: string | null;
    phone: string | null;
    next_action_at: string;
  }[];
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
