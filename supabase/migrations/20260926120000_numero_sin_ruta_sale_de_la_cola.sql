-- Un número que el carrier nunca cursa sale de la cola, no se reintenta cada
-- 10 minutos para siempre.
--
-- Auditoría del 26-09-2026 (Equifax, 24 y 25-09): la causa Q.850 34 ("no hay
-- circuito") no era la troncal llena. Salía con 6 a 14 llamadas simultáneas y
-- en 15-20 % de los intentos fuera cual fuera la ráfaga. Era por número: 220
-- teléfonos (202 fijos, sobre todo regionales) fallaban siempre con 34, nunca
-- contestaron y se llevaron 1.054 intentos, ~15 % de la capacidad. Como la red
-- es 'tecnico', no gastaban cupo ni tope: volvían a los 10, 20 y 40 minutos y
-- solo paraban tras 10 fallas seguidas.
--
-- Regla: segunda falla de red (27/34/38) en 7 días hacia un número que en ese
-- tiempo nunca dio otra respuesta (ni sonó, ni ocupado, ni rechazo, ni
-- contestó) => lista de no llamar de la empresa por 30 días, como
-- 'fuera_de_servicio', con source 'discador' y la causa en source_reason.
-- Solo cuentan las fallas en que la troncal estaba cursando: otra llamada de
-- la misma campaña contestó 5 minutos antes o después. Con la troncal caída
-- no se descarta a nadie (eso lo resuelve el cortacircuitos).
--
-- 30 días y no 90 como el número inexistente: si el carrier habilita la ruta,
-- el número vuelve solo. Para devolverlos antes, levantar las filas con
-- source = 'discador' y source_reason like 'Q.850 %' de reason fuera_de_servicio.
--
-- Simulado sobre el historial de producción: con dos fallas atrapa 200
-- números, ninguno contestó después, y ahorra 606 intentos.

-- Comprobar "la troncal cursaba" sin recorrer todos los intentos de la campaña.
create index if not exists dial_attempts_campaign_originated_idx
  on public.dial_attempts (campaign_id, originated_at)
  where originated_at is not null;

-- ¿El carrier devolvió alguna vez algo distinto de una falla de red para este
-- número en los últimos 7 días? Una falla sin causa no dice nada del número.
create or replace function public.dialer_phone_carrier_responded(p_phone text, p_since timestamptz)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select exists (
    select 1
    from public.dial_attempts attempt
    where public.canonical_chile_phone(attempt.phone) = public.canonical_chile_phone(p_phone)
      and attempt.ended_at is not null
      and attempt.ended_at > p_since
      and attempt.attempt_kind = 'pool'
      and (
        attempt.originated_at is not null
        or attempt.status <> 'failed'
        or btrim(coalesce(attempt.hangup_cause, '')) not in ('', '27', '34', '38')
      )
  );
$$;

-- Fallas de red hacia el número con la troncal cursando otras llamadas de la
-- misma campaña.
create or replace function public.dialer_phone_unroutable_failures(p_phone text, p_since timestamptz)
returns integer
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select count(*)::integer
  from public.dial_attempts failure
  where public.canonical_chile_phone(failure.phone) = public.canonical_chile_phone(p_phone)
    and failure.ended_at is not null
    and failure.ended_at > p_since
    and failure.attempt_kind = 'pool'
    and failure.status = 'failed'
    and failure.originated_at is null
    and btrim(coalesce(failure.hangup_cause, '')) in ('27', '34', '38')
    and exists (
      select 1
      from public.dial_attempts working
      where working.campaign_id = failure.campaign_id
        and working.originated_at is not null
        and working.originated_at between failure.ended_at - interval '5 minutes'
                                      and failure.ended_at + interval '5 minutes'
        and working.id <> failure.id
    );
$$;

create or replace function public.dialer_suppress_unroutable_number()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_organization_id uuid;
  v_phone text;
  v_since timestamptz := now() - interval '7 days';
begin
  begin
    v_phone := public.canonical_chile_phone(new.phone);
    if v_phone is null or v_phone !~ '^[0-9]{8,15}$' then
      return null;
    end if;

    select campaign.organization_id into v_organization_id
    from public.campaigns campaign
    where campaign.id = new.campaign_id;
    if v_organization_id is null then
      return null;
    end if;

    -- Ya fuera de la cola de toda la empresa: nada que agregar.
    if exists (
      select 1
      from public.dialer_phone_suppressions suppression
      where suppression.organization_id = v_organization_id
        and suppression.phone = v_phone
        and suppression.campaign_id is null
        and suppression.client_key is null
        and suppression.lifted_at is null
        and (suppression.expires_at is null or suppression.expires_at > now())
    ) then
      return null;
    end if;

    if public.dialer_phone_carrier_responded(v_phone, v_since) then
      return null;
    end if;
    if public.dialer_phone_unroutable_failures(v_phone, v_since) < 2 then
      return null;
    end if;

    insert into public.dialer_phone_suppressions (
      organization_id, phone, reason, source, source_lead_id, source_reason, expires_at, notes
    )
    values (
      v_organization_id, v_phone, 'fuera_de_servicio', 'discador', new.lead_id,
      'Q.850 ' || btrim(new.hangup_cause),
      now() + interval '30 days',
      'El carrier no cursa este número: dos fallas de red con la troncal cursando otras llamadas y ninguna otra respuesta en 7 días.'
    )
    on conflict do nothing;
  exception when others then
    raise warning 'No se pudo suprimir el número sin ruta del intento %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists dial_attempts_suppress_unroutable_number on public.dial_attempts;
create trigger dial_attempts_suppress_unroutable_number
  after update of status on public.dial_attempts
  for each row
  when (
    new.status = 'failed'
    and old.status is distinct from new.status
    and new.attempt_kind = 'pool'
    and btrim(coalesce(new.hangup_cause, '')) in ('27', '34', '38')
  )
  execute function public.dialer_suppress_unroutable_number();

revoke all on function public.dialer_suppress_unroutable_number() from public, anon, authenticated;
revoke all on function public.dialer_phone_carrier_responded(text, timestamptz) from public, anon, authenticated;
revoke all on function public.dialer_phone_unroutable_failures(text, timestamptz) from public, anon, authenticated;

-- Los números que ya cumplen la regla salen ahora, no en su próximo intento.
-- Una fila por número y empresa; el disparador de dialer_phone_suppressions
-- recalcula la espera de cada lead con ese teléfono.
with ultima_falla as (
  select distinct on (campaign.organization_id, public.canonical_chile_phone(attempt.phone))
    campaign.organization_id,
    public.canonical_chile_phone(attempt.phone) as phone,
    attempt.lead_id,
    btrim(attempt.hangup_cause) as cause
  from public.dial_attempts attempt
  join public.campaigns campaign on campaign.id = attempt.campaign_id
  where attempt.ended_at > now() - interval '7 days'
    and attempt.attempt_kind = 'pool'
    and attempt.status = 'failed'
    and attempt.originated_at is null
    and btrim(coalesce(attempt.hangup_cause, '')) in ('27', '34', '38')
    and campaign.organization_id is not null
  order by campaign.organization_id, public.canonical_chile_phone(attempt.phone), attempt.ended_at desc
)
insert into public.dialer_phone_suppressions (
  organization_id, phone, reason, source, source_lead_id, source_reason, expires_at, notes
)
select
  falla.organization_id, falla.phone, 'fuera_de_servicio', 'discador', falla.lead_id,
  'Q.850 ' || falla.cause,
  now() + interval '30 days',
  'El carrier no cursa este número: dos fallas de red con la troncal cursando otras llamadas y ninguna otra respuesta en 7 días.'
from ultima_falla falla
where falla.phone ~ '^[0-9]{8,15}$'
  and not public.dialer_phone_carrier_responded(falla.phone, now() - interval '7 days')
  and public.dialer_phone_unroutable_failures(falla.phone, now() - interval '7 days') >= 2
  and not exists (
    select 1
    from public.dialer_phone_suppressions suppression
    where suppression.organization_id = falla.organization_id
      and suppression.phone = falla.phone
      and suppression.campaign_id is null
      and suppression.client_key is null
      and suppression.lifted_at is null
      and (suppression.expires_at is null or suppression.expires_at > now())
  )
on conflict do nothing;
