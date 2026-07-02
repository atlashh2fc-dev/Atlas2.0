-- Tabla calls: una fila por llamada/gestion sobre un lead
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  agent_id uuid not null references public.profiles(id),
  -- cascada Estado -> Resultado -> Motivo (validada en la app, igual que leads.status)
  status text,
  outcome text,
  reason text,
  notes text,
  -- agenda / callback
  next_action_at timestamptz,
  next_action_window text,
  callback_owner_user_id uuid references public.profiles(id),
  -- validaciones comerciales Equifax (solo aplican cuando status = connected)
  equifax_products text[],
  equifax_uf_amount numeric,
  equifax_recipient_email text,
  -- estado telefonico externo, si existe integracion de telefonia
  phone_status text,
  -- ciclo de vida de la llamada
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  discarded_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calls_lead_id_idx on public.calls(lead_id);
create index if not exists calls_agent_id_idx on public.calls(agent_id);
create index if not exists calls_open_agenda_idx on public.calls(lead_id, next_action_at) where ended_at is null;

alter table public.calls enable row level security;

create policy "calls_select_authenticated" on public.calls
  for select to authenticated using (true);

create policy "calls_insert_own" on public.calls
  for insert to authenticated with check (agent_id = auth.uid());

create policy "calls_update_authenticated" on public.calls
  for update to authenticated using (true);

-- Tabla call_events: auditoria de eventos de la gestion (call.progress_updated, call.agenda_saved, call.closed, call.discarded)
create table if not exists public.call_events (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  agent_id uuid references public.profiles(id),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists call_events_call_id_idx on public.call_events(call_id);
create index if not exists call_events_lead_id_idx on public.call_events(lead_id);

alter table public.call_events enable row level security;

create policy "call_events_select_authenticated" on public.call_events
  for select to authenticated using (true);

create policy "call_events_insert_authenticated" on public.call_events
  for insert to authenticated with check (true);

-- Extension de leads para reflejar el resultado de la tipificacion
alter table public.leads
  add column if not exists tipificacion_actual text,
  add column if not exists observacion_actual text,
  add column if not exists next_action_at timestamptz,
  add column if not exists workflow_status text,
  add column if not exists assignment_status text,
  add column if not exists managed_at timestamptz,
  add column if not exists managed_by uuid references public.profiles(id);

create index if not exists leads_next_action_at_idx on public.leads(next_action_at);
;
