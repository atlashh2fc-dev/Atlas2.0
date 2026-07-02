create or replace function public.import_vocalcom_events(
  p_file_name text,
  p_file_size bigint,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_batch_id uuid;
  v_source_count integer := coalesce(jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), 0);
  v_inserted_count integer := 0;
  v_matched_count integer := 0;
  v_ambiguous_count integer := 0;
  v_unmatched_count integer := 0;
  v_connected_count integer := 0;
  v_not_connected_count integer := 0;
  v_indeterminate_count integer := 0;
begin
  if v_actor_id is null then
    raise exception 'No autenticado.';
  end if;

  if v_role <> 'admin' then
    raise exception 'Solo un administrador puede cargar archivos Vocalcom.';
  end if;

  if v_source_count = 0 then
    raise exception 'El archivo no trae filas Vocalcom para procesar.';
  end if;

  insert into public.vocalcom_import_batches (
    file_name,
    file_size,
    source_row_count,
    uploaded_by
  )
  values (
    coalesce(nullif(btrim(p_file_name), ''), 'vocalcom.csv'),
    p_file_size,
    v_source_count,
    v_actor_id
  )
  returning id into v_batch_id;

  with source_rows as (
    select
      value as row_data,
      coalesce((value->>'row_number')::integer, ordinality::integer + 1) as row_number,
      nullif(value->>'event_key', '') as event_key,
      nullif(value->>'rut', '') as rut,
      nullif(value->>'normalized_rut', '') as normalized_rut,
      nullif(value->>'telefono_original', '') as telefono_original,
      nullif(value->>'telefono_vocalcom', '') as telefono_vocalcom,
      nullif(value->>'phone_normalized', '') as phone_normalized,
      nullif(value->>'called_at', '')::timestamptz as called_at,
      nullif(value->>'stats_date', '') as stats_date,
      nullif(value->>'stats_hour', '') as stats_hour,
      nullif(value->>'stats_datetime', '') as stats_datetime,
      nullif(value->>'stats_utc_datetime', '')::timestamptz as stats_utc_datetime,
      nullif(value->>'agent_external_id', '') as agent_external_id,
      nullif(value->>'agent_name', '') as agent_name,
      nullif(value->>'duration_seconds', '')::integer as duration_seconds,
      nullif(value->>'wrapup', '') as wrapup,
      nullif(value->>'status_group', '') as status_group,
      nullif(value->>'status_code', '') as status_code,
      nullif(value->>'status_detail', '') as status_detail,
      nullif(value->>'status_text', '') as status_text,
      nullif(value->>'status_text_detail', '') as status_text_detail,
      nullif(value->>'comments', '') as comments,
      case when value ? 'connected' then (value->>'connected')::boolean else null end as connected,
      coalesce(nullif(value->>'connection_status', ''), 'indeterminate') as connection_status,
      coalesce(nullif(value->>'connection_rule', ''), 'sin_regla') as connection_rule
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality
  ),
  prepared_rows as (
    select
      *,
      coalesce(
        event_key,
        md5(concat_ws('|',
          coalesce(normalized_rut, ''),
          coalesce(phone_normalized, ''),
          coalesce(stats_datetime, ''),
          coalesce(agent_external_id, ''),
          coalesce(agent_name, ''),
          coalesce(duration_seconds::text, ''),
          coalesce(wrapup, ''),
          coalesce(status_code, ''),
          coalesce(status_text, '')
        ))
      ) as effective_event_key
    from source_rows
    where coalesce(phone_normalized, normalized_rut, stats_datetime) is not null
  ),
  inserted as (
    insert into public.vocalcom_call_events (
      import_batch_id,
      row_number,
      event_key,
      rut,
      normalized_rut,
      telefono_original,
      telefono_vocalcom,
      phone_normalized,
      called_at,
      stats_date,
      stats_hour,
      stats_datetime,
      stats_utc_datetime,
      agent_external_id,
      agent_name,
      duration_seconds,
      wrapup,
      status_group,
      status_code,
      status_detail,
      status_text,
      status_text_detail,
      comments,
      touched,
      connected,
      connection_status,
      connection_rule,
      raw
    )
    select
      v_batch_id,
      row_number,
      effective_event_key,
      rut,
      normalized_rut,
      telefono_original,
      telefono_vocalcom,
      phone_normalized,
      called_at,
      stats_date,
      stats_hour,
      stats_datetime,
      stats_utc_datetime,
      agent_external_id,
      agent_name,
      duration_seconds,
      wrapup,
      status_group,
      status_code,
      status_detail,
      status_text,
      status_text_detail,
      comments,
      true,
      connected,
      case
        when connection_status in ('connected', 'not_connected', 'indeterminate') then connection_status
        else 'indeterminate'
      end,
      connection_rule,
      row_data
    from prepared_rows
    on conflict (event_key) do nothing
    returning *
  ),
  matched as (
    select
      i.id as event_id,
      m.lead_id,
      m.matched_by,
      m.match_status
    from inserted i
    left join lateral (
      with candidates as (
        select distinct l.id, 'rut_phone'::text as matched_by, 1 as priority
        from public.leads l
        where i.normalized_rut is not null
          and i.phone_normalized is not null
          and public.normalize_lead_rut(l.rut) = i.normalized_rut
          and (
            public.normalize_lead_contact('phone', l.phone) = i.phone_normalized
            or exists (
              select 1
              from public.lead_contacts lc
              where lc.lead_id = l.id
                and lc.contact_type = 'phone'
                and lc.normalized_value = i.phone_normalized
            )
          )
        union
        select distinct l.id, 'rut'::text as matched_by, 2 as priority
        from public.leads l
        where i.normalized_rut is not null
          and public.normalize_lead_rut(l.rut) = i.normalized_rut
        union
        select distinct l.id, 'phone'::text as matched_by, 3 as priority
        from public.leads l
        where i.phone_normalized is not null
          and (
            public.normalize_lead_contact('phone', l.phone) = i.phone_normalized
            or exists (
              select 1
              from public.lead_contacts lc
              where lc.lead_id = l.id
                and lc.contact_type = 'phone'
                and lc.normalized_value = i.phone_normalized
            )
          )
      ),
      top_priority as (
        select min(priority) as priority from candidates
      ),
      top_candidates as (
        select c.*
        from candidates c
        join top_priority tp on tp.priority = c.priority
      )
      select
        case when count(*) = 1 then min(id::text)::uuid else null end as lead_id,
        case when count(*) = 1 then min(matched_by) else null end as matched_by,
        case
          when count(*) = 1 then 'matched'
          when count(*) > 1 then 'ambiguous'
          else 'unmatched'
        end as match_status
      from top_candidates
    ) m on true
  ),
  updated_events as (
    update public.vocalcom_call_events e
    set
      lead_id = matched.lead_id,
      matched_by = matched.matched_by,
      match_status = coalesce(matched.match_status, 'unmatched')
    from matched
    where e.id = matched.event_id
    returning e.*
  ),
  latest_by_lead as (
    select distinct on (lead_id)
      lead_id,
      called_at,
      connection_status,
      duration_seconds,
      import_batch_id
    from updated_events
    where lead_id is not null
      and called_at is not null
    order by lead_id, called_at desc, created_at desc
  )
  update public.leads l
  set
    vocalcom_last_touched_at = greatest(
      coalesce(l.vocalcom_last_touched_at, '-infinity'::timestamptz),
      latest_by_lead.called_at
    ),
    vocalcom_last_connected_at = case
      when latest_by_lead.connection_status = 'connected' then greatest(
        coalesce(l.vocalcom_last_connected_at, '-infinity'::timestamptz),
        latest_by_lead.called_at
      )
      else l.vocalcom_last_connected_at
    end,
    vocalcom_last_connection_status = latest_by_lead.connection_status,
    vocalcom_last_duration_seconds = latest_by_lead.duration_seconds,
    vocalcom_last_import_batch_id = latest_by_lead.import_batch_id
  from latest_by_lead
  where l.id = latest_by_lead.lead_id
    and (
      l.vocalcom_last_touched_at is null
      or latest_by_lead.called_at >= l.vocalcom_last_touched_at
    );

  select count(*)
  into v_inserted_count
  from public.vocalcom_call_events
  where import_batch_id = v_batch_id;

  select
    count(*) filter (where match_status = 'matched'),
    count(*) filter (where match_status = 'ambiguous'),
    count(*) filter (where match_status in ('unmatched', 'pending')),
    count(*) filter (where connection_status = 'connected'),
    count(*) filter (where connection_status = 'not_connected'),
    count(*) filter (where connection_status = 'indeterminate')
  into
    v_matched_count,
    v_ambiguous_count,
    v_unmatched_count,
    v_connected_count,
    v_not_connected_count,
    v_indeterminate_count
  from public.vocalcom_call_events
  where import_batch_id = v_batch_id;

  update public.vocalcom_import_batches
  set
    inserted_count = v_inserted_count,
    duplicate_count = greatest(v_source_count - v_inserted_count, 0),
    matched_count = v_matched_count,
    ambiguous_count = v_ambiguous_count,
    unmatched_count = v_unmatched_count,
    connected_count = v_connected_count,
    not_connected_count = v_not_connected_count,
    indeterminate_count = v_indeterminate_count
  where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'source_rows', v_source_count,
    'inserted', v_inserted_count,
    'duplicates', greatest(v_source_count - v_inserted_count, 0),
    'matched', v_matched_count,
    'ambiguous', v_ambiguous_count,
    'unmatched', v_unmatched_count,
    'connected', v_connected_count,
    'not_connected', v_not_connected_count,
    'indeterminate', v_indeterminate_count
  );
end;
$function$;

revoke all on function public.import_vocalcom_events(text, bigint, jsonb) from public, anon;
grant execute on function public.import_vocalcom_events(text, bigint, jsonb) to authenticated;
