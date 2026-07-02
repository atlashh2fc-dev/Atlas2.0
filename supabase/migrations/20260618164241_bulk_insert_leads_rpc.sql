-- Inserta un lote de leads evitando duplicados (por rut, o por teléfono si no hay rut),
-- respetando exactamente las mismas RLS que aplicarían a un insert directo del usuario
-- que llama (security invoker, sin elevar privilegios).
create or replace function public.bulk_insert_leads(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  rut_inserted int := 0;
  phone_inserted int := 0;
begin
  with src as (
    select *
    from jsonb_to_recordset(payload) as r(
      full_name text,
      rut text,
      phone text,
      email text,
      status text,
      team_id uuid,
      workflow_id uuid,
      campaign_id uuid,
      created_by uuid
    )
  )
  insert into leads (full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by)
  select full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by
  from src
  where rut is not null and btrim(rut) <> ''
  on conflict (
    (coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (upper(regexp_replace(rut, '[^0-9kK]', '', 'g')))
  ) where rut is not null and btrim(rut) <> ''
  do nothing;
  get diagnostics rut_inserted = row_count;

  with src as (
    select *
    from jsonb_to_recordset(payload) as r(
      full_name text,
      rut text,
      phone text,
      email text,
      status text,
      team_id uuid,
      workflow_id uuid,
      campaign_id uuid,
      created_by uuid
    )
  )
  insert into leads (full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by)
  select full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by
  from src
  where (rut is null or btrim(rut) = '') and phone is not null and btrim(phone) <> ''
  on conflict (
    (coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (regexp_replace(phone, '[^0-9]', '', 'g'))
  ) where rut is null and phone is not null and btrim(phone) <> ''
  do nothing;
  get diagnostics phone_inserted = row_count;

  return jsonb_build_object('inserted', rut_inserted + phone_inserted);
end;
$$;

grant execute on function public.bulk_insert_leads(jsonb) to authenticated;
;
