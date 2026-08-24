import type { CampaignDirection } from "@/lib/metric-definitions";

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

export type WorkflowStatus = "draft" | "published";

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  /** draft = en construcción; published = operativo para las campañas. */
  status: WorkflowStatus;
  published_at: string | null;
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

export type DialMode = "manual" | "preview" | "progressive" | "predictive";

export const DIAL_MODES: { value: DialMode; label: string; description: string }[] = [
  {
    value: "manual",
    label: "Manual",
    description: "El ejecutivo elige el contacto y marca desde la barra CTI o la ficha del lead. El sistema no inicia llamadas por sí solo.",
  },
  {
    value: "preview",
    label: "Vista previa",
    description: "El sistema prepara el próximo lead para que el ejecutivo vea su ficha antes de que se inicie la llamada automática.",
  },
  {
    value: "progressive",
    label: "Progresivo",
    description: "El sistema inicia aproximadamente una llamada por cada ejecutivo disponible y entrega las que contestan. Mantiene un ritmo controlado y un abandono bajo.",
  },
  {
    value: "predictive",
    label: "Predictivo (asistido)",
    description: "El sistema adelanta más llamadas según el ratio y la contactabilidad esperada para ocupar a los ejecutivos disponibles. Puede aumentar la velocidad, pero también el riesgo de abandono.",
  },
];

export interface DialerCampaignConfig {
  campaign_id: string;
  /** Dirección de la campaña: decide qué familia de KPIs se reporta. */
  campaign_type: CampaignDirection;
  dial_mode: DialMode;
  max_dial_ratio: number;
  caller_id: string | null;
  trunk_context: string;
  queue_name: string;
  wrapup_seconds: number;
  is_active: boolean;
  max_redial_attempts: number;
  abandon_timeout_seconds: number;
  target_abandonment_rate: number;
  amd_enabled: boolean;
  /** Entregar los compromisos agendados a su ejecutivo a la hora acordada. */
  personal_callback_enabled: boolean;
  personal_callback_window_minutes: number;
  personal_callback_retry_seconds: number;
  personal_callback_on_expiry: "keep_in_agenda" | "release_to_pool";
  created_at: string;
  updated_at: string;
}

export interface AiVoiceCampaignConfig {
  campaign_id: string;
  provider: "elevenlabs";
  agent_id: string;
  phone_number_id: string | null;
  max_concurrent_calls: number;
  max_attempts_per_contact: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentSipCredential {
  id: string;
  profile_id: string;
  extension: string;
  sip_password: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentStatusReason {
  id: string;
  code: string;
  label: string;
  is_pause: boolean;
  sort_order: number;
  is_active: boolean;
  is_system: boolean;
  /** El tiempo en este estado cuenta como trabajo efectivo. */
  is_productive: boolean;
  /** El tiempo en este estado no entra en el cálculo de adherencia. */
  excludes_from_adherence: boolean;
  /** Tope sugerido de permanencia en segundos; nulo = sin tope. */
  max_seconds: number | null;
  created_at: string;
  updated_at: string;
}

export interface AgentCurrentStatus {
  profile_id: string;
  reason_id: string;
  since: string;
  updated_at: string;
}

export type PhoneStatus = "offline" | "available" | "ringing" | "on_call" | "wrap_up";

export interface AgentLiveStatus {
  profile_id: string;
  full_name: string;
  email: string;
  extension: string;
  campaign_id: string | null;
  campaign_name: string | null;
  phone_status: PhoneStatus;
  phone_status_since: string | null;
  reason_id: string | null;
  reason_code: string | null;
  reason_label: string | null;
  is_pause: boolean;
  reason_since: string | null;
  control_command_id: string | null;
  control_status: "pending" | "processing" | "completed" | "failed" | null;
  control_requested_at: string | null;
  control_browser_acknowledged_at: string | null;
  control_pbx_completed_at: string | null;
  control_last_error: string | null;
}

export interface QueueHealth {
  campaign_id: string;
  campaign_name: string;
  queue_name: string;
  campaign_type: CampaignDirection;
  in_flight: number;
  attempts_today: number;
  answered_today: number;
  abandoned_today: number;
  completed_today: number;
  no_answer_today: number;
  /** Gestiones cerradas hoy: el trabajo del ejecutivo, no el del marcador. */
  managements_today: number;
  /** Gestiones donde se habló con la persona: denominador real de la conversión. */
  effective_contacts_today: number;
  sales_today: number;
}

export interface CallMetricsReportRow {
  report_date: string;
  campaign_id: string;
  campaign_name: string;
  total_attempts: number;
  answered: number;
  completed: number;
  no_answer: number;
  busy: number;
  failed: number;
  abandoned: number;
  voicemail: number;
  avg_ring_seconds: number | null;
  avg_talk_seconds: number | null;
  abandonment_rate: number | null;
  service_level_20s: number | null;
}

/**
 * Actividad por ejecutivo. Las columnas de jornada llegan en null cuando el
 * reporte se pide filtrado por campaña: ese tiempo no es atribuible a una
 * campaña (ver get_agent_activity_report).
 */
export interface AgentActivityReportRow {
  profile_id: string;
  full_name: string;
  calls_handled: number;
  talk_seconds: number;
  avg_handle_seconds: number | null;
  logged_in_seconds: number | null;
  productive_seconds: number | null;
  occupancy_rate: number | null;
  scheduled_seconds: number | null;
  available_seconds: number | null;
  paused_seconds: number | null;
  disconnected_seconds: number | null;
  adherence_rate: number | null;
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
