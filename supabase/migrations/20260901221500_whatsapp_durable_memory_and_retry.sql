-- Memoria conversacional durable y recuperación automática del asistente.
-- La memoria evita que un hilo largo empiece de cero; el worker recupera
-- mensajes cuyo procesamiento en segundo plano no alcanzó a ejecutarse.

create table public.whatsapp_conversation_memories (
  conversation_id uuid primary key references public.whatsapp_conversations(id) on delete cascade,
  memory jsonb not null default '{"summary":"","customer_facts":[],"needs":[],"service_interests":[],"objections":[],"commitments":[],"open_items":[]}'::jsonb
    check (jsonb_typeof(memory) = 'object'),
  memory_version integer not null default 1 check (memory_version > 0),
  model text,
  source_message_count integer not null default 0 check (source_message_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.whatsapp_conversation_memory_sources (
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  message_id uuid not null references public.whatsapp_messages(id) on delete cascade,
  included_at timestamptz not null default now(),
  primary key (conversation_id, message_id)
);

create index whatsapp_conversation_memory_sources_message_idx
  on public.whatsapp_conversation_memory_sources(message_id);

alter table public.whatsapp_conversation_memories enable row level security;
alter table public.whatsapp_conversation_memory_sources enable row level security;

revoke all on table public.whatsapp_conversation_memories from anon, authenticated;
revoke all on table public.whatsapp_conversation_memory_sources from anon, authenticated;
grant all on table public.whatsapp_conversation_memories to service_role;
grant all on table public.whatsapp_conversation_memory_sources to service_role;

create or replace function public.get_whatsapp_memory_candidates(
  p_conversation_id uuid,
  p_limit integer default 120
)
returns table (
  id uuid,
  direction text,
  message_type text,
  text_body text,
  sent_by uuid,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select message.id, message.direction, message.message_type, message.text_body,
         message.sent_by, message.created_at
  from public.whatsapp_messages message
  where message.conversation_id = p_conversation_id
    and not exists (
      select 1
      from public.whatsapp_conversation_memory_sources source
      where source.conversation_id = p_conversation_id
        and source.message_id = message.id
    )
  order by message.created_at asc, message.id asc
  limit least(greatest(coalesce(p_limit, 120), 1), 200);
$$;

revoke all on function public.get_whatsapp_memory_candidates(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.get_whatsapp_memory_candidates(uuid, integer)
  to service_role;

create or replace function public.save_whatsapp_conversation_memory(
  p_conversation_id uuid,
  p_memory jsonb,
  p_message_ids uuid[],
  p_model text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saved integer;
begin
  if jsonb_typeof(p_memory) <> 'object' then
    raise exception 'invalid_whatsapp_conversation_memory';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_message_ids, array[]::uuid[])) as candidate(message_id)
    where not exists (
      select 1 from public.whatsapp_messages message
      where message.id = candidate.message_id
        and message.conversation_id = p_conversation_id
    )
  ) then
    raise exception 'whatsapp_memory_message_conversation_mismatch';
  end if;

  insert into public.whatsapp_conversation_memory_sources(conversation_id, message_id)
  select p_conversation_id, candidate.message_id
  from unnest(coalesce(p_message_ids, array[]::uuid[])) as candidate(message_id)
  on conflict do nothing;

  select count(*) into v_saved
  from public.whatsapp_conversation_memory_sources
  where conversation_id = p_conversation_id;

  insert into public.whatsapp_conversation_memories(
    conversation_id, memory, model, source_message_count
  ) values (
    p_conversation_id, p_memory, nullif(btrim(p_model), ''), v_saved
  )
  on conflict (conversation_id) do update
  set memory = excluded.memory,
      memory_version = public.whatsapp_conversation_memories.memory_version + 1,
      model = excluded.model,
      source_message_count = excluded.source_message_count,
      updated_at = now();
end;
$$;

revoke all on function public.save_whatsapp_conversation_memory(uuid, jsonb, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.save_whatsapp_conversation_memory(uuid, jsonb, uuid[], text)
  to service_role;

alter table public.whatsapp_ai_runs
  add column attempt_count integer not null default 1 check (attempt_count between 1 and 5),
  add column last_attempt_at timestamptz not null default now(),
  add column next_retry_at timestamptz;

create or replace function public.get_whatsapp_ai_work(p_limit integer default 20)
returns table (conversation_id uuid, inbound_message_id uuid)
language sql
security definer
set search_path = public
as $$
  select message.conversation_id, message.id
  from public.whatsapp_messages message
  join public.whatsapp_conversations conversation on conversation.id = message.conversation_id
  join public.whatsapp_ai_configs config on config.campaign_id = conversation.campaign_id and config.enabled
  left join public.whatsapp_ai_runs run on run.inbound_message_id = message.id
  where message.direction = 'inbound'
    and message.message_type = 'text'
    and nullif(btrim(message.text_body), '') is not null
    and conversation.status <> 'closed'
    and conversation.ai_state = 'auto'
    and message.id = (
      select latest.id
      from public.whatsapp_messages latest
      where latest.conversation_id = message.conversation_id
        and not (latest.direction = 'outbound' and latest.status = 'failed')
      order by latest.created_at desc, latest.id desc
      limit 1
    )
    and (
      run.id is null
      or (run.status = 'failed' and run.attempt_count < 3 and coalesce(run.next_retry_at, now()) <= now())
      or (run.status = 'processing' and run.attempt_count < 3 and run.last_attempt_at <= now() - interval '3 minutes')
    )
  order by message.created_at asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.get_whatsapp_ai_work(integer)
  from public, anon, authenticated;
grant execute on function public.get_whatsapp_ai_work(integer)
  to service_role;

comment on table public.whatsapp_conversation_memories is
  'Resumen estructurado acumulativo usado para mantener continuidad más allá de la ventana reciente.';
comment on function public.get_whatsapp_ai_work(integer) is
  'Encuentra el último inbound respondible sin ejecución o con ejecución reintentable.';

update public.whatsapp_ai_configs
set system_prompt = system_prompt || $ux$

REGLAS DE EXPERIENCIA CONVERSACIONAL
- Aplica divulgación progresiva: una respuesta cubre una sola capa de información. No descargues la ficha completa.
- Una respuesta normal debe tener entre 160 y 320 caracteres cuando sea posible, nunca más de 420; máximo tres frases, dos párrafos y una pregunta.
- Ante una consulta amplia explica solo qué hace el servicio y formula una pregunta breve de encuadre. No agregues precio, públicos, módulos, CRM, horarios ni contratación si no fueron preguntados.
- Ofrecer atención humana no equivale a derivar. Devuelve handoff=true solo si el último mensaje acepta o pide explícitamente hablar con una persona, agendar, cotizar un precio final, plantea un reclamo real o requiere un dato no respaldado.
- No repitas presentaciones ni solicites datos ya entregados. Usa la memoria y los mensajes más recientes para continuar naturalmente.
$ux$,
    knowledge_version = greatest(knowledge_version, 3),
    max_history_messages = 12,
    updated_at = now()
where campaign_id = 'f59045b2-cb77-49dd-ae4a-a105cdd55121'::uuid
   or campaign_id = (
     select id from public.campaigns
     where name = 'Meta Ads · WhatsApp · Secretaria Virtual Geimser'
     limit 1
   );
