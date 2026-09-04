begin;

alter table public.integration_inbox_items
  drop constraint if exists integration_inbox_items_event_type_check;

alter table public.integration_inbox_items
  add constraint integration_inbox_items_event_type_check
  check (event_type in (
    'intelligence.decision.v1',
    'engagement.event.v1',
    'mail.message.v1',
    'integration.canary.v1'
  ));

create table public.lead_mail_messages (
  id uuid primary key default gen_random_uuid(),
  integration_item_id uuid unique references public.integration_inbox_items(id) on delete set null,
  source_id uuid not null references public.integration_sources(id) on delete restrict,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  external_campaign_key text not null,
  external_message_id text not null,
  parent_external_message_id text,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_email text,
  to_email text,
  reply_to_email text,
  subject text not null,
  body_text text not null,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_mail_messages_external_campaign_not_blank
    check (btrim(external_campaign_key) <> ''),
  constraint lead_mail_messages_external_message_not_blank
    check (btrim(external_message_id) <> ''),
  constraint lead_mail_messages_subject_length check (length(subject) between 1 and 1000),
  constraint lead_mail_messages_body_length check (length(body_text) between 1 and 100000),
  unique (source_id, external_message_id, direction)
);

create index lead_mail_messages_lead_timeline_idx
  on public.lead_mail_messages (lead_id, occurred_at desc, id desc);

create table public.mail_reply_commands (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  source_message_id uuid not null references public.lead_mail_messages(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  idempotency_key text not null,
  subject text not null,
  body_text text not null,
  status text not null default 'queued'
    check (status in ('queued', 'delivered', 'failed')),
  outbox_event_id uuid references public.integration_outbox_events(id) on delete set null,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint mail_reply_commands_idempotency_not_blank check (btrim(idempotency_key) <> ''),
  constraint mail_reply_commands_subject_length check (length(subject) between 1 and 1000),
  constraint mail_reply_commands_body_length check (length(body_text) between 1 and 20000),
  unique (requested_by, idempotency_key)
);

create index mail_reply_commands_lead_idx
  on public.mail_reply_commands (lead_id, created_at desc);

alter table public.lead_mail_messages enable row level security;
alter table public.mail_reply_commands enable row level security;

create policy lead_mail_messages_assigned_content_select
on public.lead_mail_messages
for select
to authenticated
using (
  coalesce(public.is_current_app_session_valid(), false)
  and exists (
    select 1
    from public.profiles actor
    join public.leads lead on lead.id = lead_mail_messages.lead_id
    where actor.id = (select auth.uid())
      and actor.active
      and (
        (actor.role = 'agente'::public.app_role and lead.assigned_to = actor.id)
        or (
          actor.role = 'supervisor'::public.app_role
          and lead.team_id = any(public.supervised_team_ids())
        )
      )
  )
);

create policy mail_reply_commands_assigned_select
on public.mail_reply_commands
for select
to authenticated
using (
  coalesce(public.is_current_app_session_valid(), false)
  and exists (
    select 1
    from public.profiles actor
    join public.leads lead on lead.id = mail_reply_commands.lead_id
    where actor.id = (select auth.uid())
      and actor.active
      and (
        (actor.role = 'agente'::public.app_role and lead.assigned_to = actor.id)
        or (
          actor.role = 'supervisor'::public.app_role
          and lead.team_id = any(public.supervised_team_ids())
        )
      )
  )
);

revoke all on table public.lead_mail_messages from public, anon, authenticated;
revoke all on table public.mail_reply_commands from public, anon, authenticated;
grant select on table public.lead_mail_messages to authenticated;
grant select on table public.mail_reply_commands to authenticated;
grant select, insert, update, delete on table public.lead_mail_messages to service_role;
grant select, insert, update, delete on table public.mail_reply_commands to service_role;

create or replace function public.apply_mail_messages_v1(
  p_worker_id text,
  p_item_ids uuid[]
)
returns table (item_id uuid, success boolean, error_code text)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.request_is_service_role() then
    raise exception 'apply_mail_messages_v1 requiere service_role.';
  end if;
  if coalesce(cardinality(p_item_ids), 0) > 500 then
    raise exception 'integration_v2_batch_limit';
  end if;

  return query
  with input as (
    select item.id, item.source_id, item.external_key, item.occurred_at, item.payload,
      batch.campaign_id,
      nullif(btrim(item.payload->>'external_campaign_key'), '') as external_campaign_key,
      nullif(btrim(item.payload->>'message_id'), '') as external_message_id,
      nullif(btrim(item.payload->>'parent_message_id'), '') as parent_external_message_id,
      lower(nullif(btrim(item.payload->>'direction'), '')) as direction,
      nullif(btrim(item.payload->>'from_email'), '') as from_email,
      nullif(btrim(item.payload->>'to_email'), '') as to_email,
      nullif(btrim(item.payload->>'reply_to_email'), '') as reply_to_email,
      nullif(left(btrim(item.payload->>'message_subject'), 1000), '') as message_subject,
      nullif(left(btrim(item.payload->>'message_body'), 100000), '') as message_body
    from public.integration_inbox_items item
    join public.integration_inbox_batches batch on batch.id = item.batch_id
    where item.id = any(coalesce(p_item_ids, array[]::uuid[]))
      and item.status = 'processing'
      and item.lease_owner = btrim(p_worker_id)
      and item.event_type = 'mail.message.v1'
  ), resolved as (
    select input.*, reference.lead_id,
      mapped.id as mail_campaign_id
    from input
    left join public.mail_campaigns mapped
      on mapped.source_id = input.source_id
     and mapped.campaign_id = input.campaign_id
     and mapped.external_campaign_key = input.external_campaign_key
    left join public.lead_external_refs reference
      on reference.source_id = input.source_id
     and reference.campaign_id = input.campaign_id
     and reference.external_key = input.external_key
  ), inserted as (
    insert into public.lead_mail_messages (
      integration_item_id, source_id, campaign_id, lead_id,
      external_campaign_key, external_message_id, parent_external_message_id,
      direction, from_email, to_email, reply_to_email,
      subject, body_text, occurred_at, metadata
    )
    select resolved.id, resolved.source_id, resolved.campaign_id, resolved.lead_id,
      resolved.external_campaign_key, resolved.external_message_id,
      resolved.parent_external_message_id, resolved.direction,
      resolved.from_email, resolved.to_email, resolved.reply_to_email,
      resolved.message_subject, resolved.message_body, resolved.occurred_at,
      jsonb_strip_nulls(jsonb_build_object(
        'mail_campaign_id', resolved.mail_campaign_id,
        'provider_message_id', resolved.payload->>'provider_message_id'
      ))
    from resolved
    where resolved.lead_id is not null
      and resolved.mail_campaign_id is not null
      and resolved.external_message_id is not null
      and resolved.direction in ('inbound', 'outbound')
      and resolved.message_subject is not null
      and resolved.message_body is not null
    on conflict (source_id, external_message_id, direction) do update
    set parent_external_message_id = coalesce(excluded.parent_external_message_id, public.lead_mail_messages.parent_external_message_id),
        from_email = coalesce(excluded.from_email, public.lead_mail_messages.from_email),
        to_email = coalesce(excluded.to_email, public.lead_mail_messages.to_email),
        reply_to_email = coalesce(excluded.reply_to_email, public.lead_mail_messages.reply_to_email),
        subject = excluded.subject,
        body_text = excluded.body_text,
        occurred_at = greatest(public.lead_mail_messages.occurred_at, excluded.occurred_at),
        metadata = public.lead_mail_messages.metadata || excluded.metadata,
        integration_item_id = coalesce(public.lead_mail_messages.integration_item_id, excluded.integration_item_id),
        updated_at = now()
    returning integration_item_id
  ), commands_updated as (
    update public.mail_reply_commands command
    set status = 'delivered',
        provider_message_id = resolved.payload->>'provider_message_id',
        delivered_at = resolved.occurred_at,
        last_error = null,
        updated_at = now()
    from resolved
    where nullif(resolved.payload->>'crm_reply_command_id', '') is not null
      and (resolved.payload->>'crm_reply_command_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and command.id = (resolved.payload->>'crm_reply_command_id')::uuid
      and command.lead_id = resolved.lead_id
    returning command.id
  )
  select resolved.id,
    resolved.lead_id is not null
      and resolved.mail_campaign_id is not null
      and resolved.external_message_id is not null
      and resolved.direction in ('inbound', 'outbound')
      and resolved.message_subject is not null
      and resolved.message_body is not null,
    case
      when resolved.lead_id is null then 'lead_not_found_or_ambiguous'
      when resolved.mail_campaign_id is null then 'mail_campaign_not_found'
      when resolved.external_message_id is null then 'invalid_message_id'
      when resolved.direction not in ('inbound', 'outbound') then 'invalid_message_direction'
      when resolved.message_subject is null then 'invalid_message_subject'
      when resolved.message_body is null then 'invalid_message_body'
      else null
    end
  from resolved;
end;
$function$;

revoke all on function public.apply_mail_messages_v1(text, uuid[])
  from public, anon, authenticated;
grant execute on function public.apply_mail_messages_v1(text, uuid[]) to service_role;

create or replace function public.enqueue_assigned_mail_reply(
  p_lead_id uuid,
  p_source_message_id uuid,
  p_body_text text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_lead public.leads%rowtype;
  v_message public.lead_mail_messages%rowtype;
  v_source_id uuid;
  v_external_lead_key text;
  v_external_campaign_key text;
  v_mail_status public.mail_campaign_lead_status%rowtype;
  v_subject text;
  v_body text := nullif(btrim(coalesce(p_body_text, '')), '');
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_command_id uuid;
  v_outbox_id uuid;
begin
  if v_actor_id is null
     or not coalesce(public.is_current_app_session_valid(), false)
     or not exists (
       select 1 from public.profiles actor
       where actor.id = v_actor_id
         and actor.active
         and actor.role = 'agente'::public.app_role
     ) then
    raise exception 'Solo un ejecutivo activo puede responder correos.';
  end if;

  if v_body is null or length(v_body) > 20000 then
    raise exception 'La respuesta debe contener entre 1 y 20000 caracteres.';
  end if;
  if v_key is null or length(v_key) > 200 then
    raise exception 'La clave de idempotencia es inválida.';
  end if;

  select * into v_lead
  from public.leads lead
  where lead.id = p_lead_id
  for update;
  if not found or v_lead.assigned_to is distinct from v_actor_id then
    raise exception 'Solo el ejecutivo asignado puede responder este correo.';
  end if;
  if nullif(btrim(coalesce(v_lead.email, '')), '') is null then
    raise exception 'El registro no tiene un correo válido para responder.';
  end if;

  select * into v_message
  from public.lead_mail_messages message
  where message.id = p_source_message_id
    and message.lead_id = p_lead_id
  for share;
  if not found then
    raise exception 'El mensaje de origen no pertenece a este registro.';
  end if;

  select status.* into v_mail_status
  from public.mail_campaign_lead_status status
  where status.lead_id = p_lead_id
    and status.campaign_id = v_lead.campaign_id
  order by status.last_seen_at desc, status.mail_campaign_id
  limit 1;
  if v_mail_status.unsubscribed or v_mail_status.complained or v_mail_status.bounced then
    raise exception 'No se puede responder: el contacto está bloqueado por baja, queja o rebote.';
  end if;

  select reference.source_id, reference.external_key, campaign.external_campaign_key
  into v_source_id, v_external_lead_key, v_external_campaign_key
  from public.lead_external_refs reference
  join public.mail_campaigns campaign
    on campaign.source_id = reference.source_id
   and campaign.campaign_id = v_lead.campaign_id
   and campaign.external_campaign_key = v_message.external_campaign_key
  where reference.lead_id = p_lead_id
    and reference.campaign_id = v_lead.campaign_id
  order by reference.last_seen_at desc, reference.id
  limit 1;
  if v_source_id is null or v_external_lead_key is null or v_external_campaign_key is null then
    raise exception 'El registro no tiene un vínculo Atlas Lead listo para responder.';
  end if;

  v_subject := case
    when v_message.subject ~* '^\s*re:' then v_message.subject
    else 'Re: ' || v_message.subject
  end;

  select command.id, command.outbox_event_id
  into v_command_id, v_outbox_id
  from public.mail_reply_commands command
  where command.requested_by = v_actor_id
    and command.idempotency_key = v_key;
  if v_command_id is not null then
    return jsonb_build_object(
      'queued', true,
      'replayed', true,
      'command_id', v_command_id,
      'outbox_event_id', v_outbox_id
    );
  end if;

  insert into public.mail_reply_commands (
    lead_id, campaign_id, source_message_id, requested_by,
    idempotency_key, subject, body_text
  ) values (
    p_lead_id, v_lead.campaign_id, p_source_message_id, v_actor_id,
    v_key, v_subject, v_body
  )
  returning id into v_command_id;

  insert into public.integration_outbox_events (
    destination_source_id, event_id, event_type, aggregate_type,
    aggregate_id, schema_version, payload
  ) values (
    v_source_id,
    'mail.reply.requested.v1:' || v_command_id::text,
    'mail.reply.requested.v1',
    'lead',
    v_external_lead_key,
    '2',
    jsonb_build_object(
      'crm_campaign_id', v_lead.campaign_id,
      'external_campaign_key', v_external_campaign_key,
      'external_key', v_external_lead_key,
      'source_lead_id', v_external_lead_key,
      'source_message_id', v_message.external_message_id,
      'recipient_email', lower(btrim(v_lead.email)),
      'subject', v_subject,
      'body_text', v_body,
      'requested_by', v_actor_id,
      'crm_reply_command_id', v_command_id,
      'correlation_id', v_message.external_message_id
    )
  )
  returning id into v_outbox_id;

  update public.mail_reply_commands
  set outbox_event_id = v_outbox_id,
      updated_at = now()
  where id = v_command_id;

  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    p_lead_id, v_lead.crm_entity_id, v_actor_id, 'mail.reply_queued',
    jsonb_build_object(
      'command_id', v_command_id,
      'source_message_id', p_source_message_id,
      'outbox_event_id', v_outbox_id
    )
  );

  return jsonb_build_object(
    'queued', true,
    'replayed', false,
    'command_id', v_command_id,
    'outbox_event_id', v_outbox_id
  );
end;
$function$;

revoke all on function public.enqueue_assigned_mail_reply(uuid, uuid, text, text)
  from public, anon;
grant execute on function public.enqueue_assigned_mail_reply(uuid, uuid, text, text)
  to authenticated;

-- A contextual call belongs to the assigned executive even when the record
-- came from mail and has no agenda row. It preserves the same single-open-call
-- and duplicate-number invariants as the agenda callback.
create or replace function public.begin_agent_assigned_lead_call(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor public.profiles%rowtype;
  v_lead public.leads%rowtype;
  v_digits text;
  v_subscriber text;
  v_phone text;
  v_call_id uuid;
  v_open_call_id uuid;
  v_now timestamptz := now();
begin
  if v_actor_id is null or not coalesce(public.is_current_app_session_valid(), false) then
    raise exception 'No autenticado.';
  end if;
  select * into v_actor
  from public.profiles actor
  where actor.id = v_actor_id
    and actor.role = 'agente'::public.app_role
    and actor.active
  for update;
  if not found then raise exception 'Solo un ejecutivo activo puede llamar este registro.'; end if;
  if v_actor.team_id is null then raise exception 'Tu usuario no tiene equipo asignado.'; end if;
  if v_actor.intercall_break_until is not null and v_actor.intercall_break_until > v_now then
    raise exception 'La interrupción legal sigue en curso. Espera antes de realizar otra llamada.';
  end if;

  select * into v_lead
  from public.leads lead
  where lead.id = p_lead_id
  for update;
  if not found then raise exception 'El registro no existe.'; end if;
  if v_lead.assigned_to is distinct from v_actor_id then
    raise exception 'Solo el ejecutivo asignado puede llamar este registro.';
  end if;
  if not exists (
    select 1
    from public.campaigns campaign
    join public.dialer_campaign_configs config
      on config.campaign_id = campaign.id and config.is_active
    where campaign.id = v_lead.campaign_id and campaign.is_active
  ) then
    raise exception 'La campaña no está activa o no tiene discado operativo configurado.';
  end if;

  v_digits := regexp_replace(coalesce(v_lead.phone, ''), '[^0-9]', '', 'g');
  if length(v_digits) = 8 then v_digits := '569' || v_digits;
  elsif length(v_digits) = 9 and left(v_digits, 1) = '9' then v_digits := '56' || v_digits;
  end if;
  if v_digits !~ '^569[0-9]{8}$' then
    raise exception 'El teléfono del registro no es un móvil chileno válido.';
  end if;
  v_phone := '+' || v_digits;
  v_subscriber := right(v_digits, 8);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_digits, 0));

  select call.id into v_open_call_id
  from public.calls call
  where call.agent_id = v_actor_id
    and call.ended_at is null
    and call.started_at >= v_now - interval '4 hours'
  order by call.started_at desc
  limit 1
  for update;
  if v_open_call_id is not null then
    raise exception 'Tienes una gestión pendiente de tipificación. Ciérrala antes de llamar.';
  end if;
  if exists (
    select 1 from public.calls call
    join public.leads lead on lead.id = call.lead_id
    where call.ended_at is null
      and call.started_at >= v_now - interval '4 hours'
      and right(public.normalize_lead_contact('phone', lead.phone), 8) = v_subscriber
  ) or exists (
    select 1 from public.dial_attempts attempt
    where attempt.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
      and right(regexp_replace(coalesce(attempt.phone, ''), '[^0-9]', '', 'g'), 8) = v_subscriber
  ) then
    raise exception 'Este número ya tiene una llamada en curso.';
  end if;

  update public.leads
  set managed_by = v_actor_id, updated_at = v_now
  where id = p_lead_id;
  insert into public.calls (lead_id, agent_id)
  values (p_lead_id, v_actor_id)
  returning id into v_call_id;
  insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
  values (
    v_call_id, p_lead_id, v_actor_id, 'cti.assigned_lead_call_started',
    jsonb_build_object('campaign_id', v_lead.campaign_id, 'phone', v_phone, 'source', 'assigned_lead')
  );
  insert into public.sensitive_access_log (actor_id, action, target_profile_id, metadata)
  values (
    v_actor_id, 'cti.assigned_lead_call', null,
    jsonb_build_object('lead_id', p_lead_id, 'call_id', v_call_id, 'campaign_id', v_lead.campaign_id)
  );
  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    p_lead_id, v_lead.crm_entity_id, v_actor_id, 'lead.assigned_call_started',
    jsonb_build_object('campaign_id', v_lead.campaign_id, 'call_id', v_call_id)
  );
  return jsonb_build_object(
    'lead_id', p_lead_id,
    'call_id', v_call_id,
    'campaign_id', v_lead.campaign_id,
    'phone', v_phone,
    'subscriber', v_subscriber,
    'full_name', v_lead.full_name
  );
end;
$function$;

revoke all on function public.begin_agent_assigned_lead_call(uuid) from public, anon;
grant execute on function public.begin_agent_assigned_lead_call(uuid) to authenticated;

commit;
