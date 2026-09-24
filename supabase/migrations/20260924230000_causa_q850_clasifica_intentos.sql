-- La causa Q.850 del carrier decide qué fue un intento que no conectó.
--
-- Auditoría del 24-09-2026: Asterisk le entregaba al motor solo "Failure,
-- reason 0" para todo lo que el carrier rechazaba, y la base lo contaba como
-- falla técnica. Así, un número que no existe (404), un celular apagado (480),
-- un rechazo del destino (403) y una caída real de la troncal eran lo mismo:
--   * el cortacircuitos se abría con la troncal sana (30 min sin discado);
--   * los números muertos se reintentaban cada 10 min: el 2.º-3.º intento al
--     mismo número fallaba 85 % y el 4.º 96 %, la mitad de la capacidad.
-- Desde ahora el AMI envía DIAL_ATTEMPT_ID en los eventos (channelvars) y el
-- motor guarda en dial_attempts.hangup_cause la causa del Hangup.
--
-- Clases (dialer_attempt_result_class):
--   'invalido'  1/22/28: el número no existe o cambió. Cuenta como intento.
--               Con dos en 7 días el número entra a la lista de no llamar de la
--               empresa por 90 días (numero_erroneo, source 'discador').
--   'real'      16/17/18/19/20/21/31: al cliente le llegó (ocupado, no
--               contesta, apagado, rechazó). Escalones normales de espera.
--   'tecnico'   red (34/38/41/42/47) o sin causa: espera corta, no gasta
--               intentos, y solo esto cuenta para el cortacircuitos.

create or replace function public.dialer_attempt_result_class(
  p_status text,
  p_attempt_kind text,
  p_originated_at timestamptz,
  p_hangup_cause text
)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $$
  select case
    when p_status not in ('no_answer', 'busy', 'failed', 'voicemail', 'abandoned', 'completed') then null
    when p_attempt_kind = 'personal_callback' and p_originated_at is null then 'ignorado'
    when p_status = 'failed' and btrim(coalesce(p_hangup_cause, '')) in ('1', '22', '28') then 'invalido'
    when p_status = 'failed' and btrim(coalesce(p_hangup_cause, '')) in ('16', '17', '18', '19', '20', '21', '31') then 'real'
    when p_status = 'failed' and p_originated_at is null then 'tecnico'
    when p_status = 'failed' and btrim(coalesce(p_hangup_cause, '')) in ('34', '38', '41', '42', '47') then 'tecnico'
    else 'real'
  end;
$$;

-- El discador puede ser fuente de una supresión.
alter table public.dialer_phone_suppressions
  drop constraint if exists dialer_phone_suppressions_source_check;
alter table public.dialer_phone_suppressions
  add constraint dialer_phone_suppressions_source_check check (source in (
    'tipificacion', 'atlas1', 'ficha', 'manual', 'discador'
  ));

-- Segundo "número no existe" en 7 días: fuera de la cola de toda la empresa
-- por 90 días. Dos y no uno, por si el carrier devolvió un 404 transitorio.
create or replace function public.dialer_suppress_invalid_number()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_organization_id uuid;
  v_phone text;
begin
  begin
    v_phone := public.canonical_chile_phone(new.phone);
    if v_phone is null or v_phone !~ '^[0-9]{8,15}$' then
      return null;
    end if;
    if (
      select count(*)
      from public.dial_attempts previous
      where public.canonical_chile_phone(previous.phone) = v_phone
        and previous.ended_at > now() - interval '7 days'
        and previous.status = 'failed'
        and btrim(coalesce(previous.hangup_cause, '')) in ('1', '22', '28')
    ) < 2 then
      return null;
    end if;

    select campaign.organization_id into v_organization_id
    from public.campaigns campaign
    where campaign.id = new.campaign_id;
    if v_organization_id is null then
      return null;
    end if;

    insert into public.dialer_phone_suppressions (
      organization_id, phone, reason, source, source_lead_id, source_reason, expires_at, notes
    )
    values (
      v_organization_id, v_phone, 'numero_erroneo', 'discador', new.lead_id,
      'Q.850 ' || btrim(new.hangup_cause),
      now() + interval '90 days',
      'El carrier respondió dos veces que el número no existe.'
    )
    on conflict do nothing;
  exception when others then
    raise warning 'No se pudo suprimir el número inexistente del intento %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists dial_attempts_suppress_invalid_number on public.dial_attempts;
create trigger dial_attempts_suppress_invalid_number
  after update of status on public.dial_attempts
  for each row
  when (
    new.status = 'failed'
    and old.status is distinct from new.status
    and btrim(coalesce(new.hangup_cause, '')) in ('1', '22', '28')
  )
  execute function public.dialer_suppress_invalid_number();

revoke all on function public.dialer_suppress_invalid_number() from public, anon, authenticated;
