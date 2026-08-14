-- Grabaciones post-llamada para el modulo de Calidad (aplicada 20260814180641).
--
-- El audio vive en el bucket privado `call-recordings`. Esta tabla es el
-- catalogo autoritativo que enlaza cada objeto con el intento, llamada, lead,
-- campana, ejecutivo y equipo que eran efectivos al momento de grabar.
-- La escritura es exclusiva del backend (service_role); admin y supervisores
-- solo obtienen lectura, y el supervisor queda limitado a sus equipos.

create table public.call_recordings (
  id uuid primary key default gen_random_uuid(),
  dial_attempt_id uuid not null unique
    references public.dial_attempts(id) on delete restrict,
  call_id uuid not null
    references public.calls(id) on delete restrict,
  lead_id uuid not null
    references public.leads(id) on delete restrict,
  campaign_id uuid not null
    references public.campaigns(id) on delete restrict,
  agent_id uuid not null
    references public.profiles(id) on delete restrict,
  team_id uuid
    references public.teams(id) on delete restrict,
  storage_bucket text not null default 'call-recordings',
  storage_path text unique,
  codec text,
  mime_type text,
  size_bytes bigint,
  sha256 text,
  duration_seconds numeric(12, 3),
  status text not null default 'recording',
  error_message text,
  ingest_token_hash text,
  ingest_expires_at timestamptz,
  ingested_at timestamptz,
  started_at timestamptz not null,
  ended_at timestamptz,
  retention_until timestamptz not null default (now() + interval '60 days'),
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint call_recordings_storage_bucket_check
    check (storage_bucket = 'call-recordings'),
  constraint call_recordings_storage_path_check
    check (
      storage_path is null
      or (
        storage_path = btrim(storage_path)
        and storage_path <> ''
        and storage_path !~ '(^/|\\\\|(^|/)\.\.(/|$)|//)'
      )
    ),
  constraint call_recordings_status_check
    check (status in (
      'recording', 'processing', 'uploading', 'ready',
      'failed', 'archived', 'deleted'
    )),
  constraint call_recordings_size_bytes_check
    check (size_bytes is null or size_bytes > 0),
  constraint call_recordings_duration_seconds_check
    check (duration_seconds is null or duration_seconds >= 0),
  constraint call_recordings_sha256_check
    check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint call_recordings_ingest_token_hash_check
    check (ingest_token_hash is null or ingest_token_hash ~ '^[0-9a-f]{64}$'),
  constraint call_recordings_ingest_token_pair_check
    check ((ingest_token_hash is null) = (ingest_expires_at is null)),
  constraint call_recordings_ingest_expiry_check
    check (ingest_expires_at is null or ingest_expires_at > created_at),
  constraint call_recordings_ingested_time_check
    check (ingested_at is null or ingested_at >= started_at),
  constraint call_recordings_time_order_check
    check (ended_at is null or ended_at >= started_at),
  constraint call_recordings_retention_check
    check (
      retention_until > started_at
      and retention_until <= created_at + interval '60 days'
    ),
  constraint call_recordings_failed_error_check
    check (
      status <> 'failed'
      or nullif(btrim(error_message), '') is not null
    ),
  constraint call_recordings_ready_payload_check
    check (
      status <> 'ready'
      or (
        storage_path is not null
        and nullif(btrim(codec), '') is not null
        and mime_type in ('audio/ogg', 'audio/opus')
        and size_bytes > 0
        and sha256 is not null
        and duration_seconds >= 0
        and ended_at is not null
        and ingested_at is not null
      )
    ),
  constraint call_recordings_archive_time_check
    check (status <> 'archived' or archived_at is not null),
  constraint call_recordings_deleted_time_check
    check (status <> 'deleted' or deleted_at is not null)
);

comment on table public.call_recordings is
  'Catalogo inmutable de identidad y ciclo de vida de grabaciones post-llamada; audio en Storage privado.';
comment on column public.call_recordings.team_id is
  'Snapshot del equipo al iniciar la grabacion; evita que cambios posteriores de asignacion alteren el alcance historico.';
comment on column public.call_recordings.retention_until is
  'Fecha maxima de permanencia hot en Supabase Storage; nunca supera 60 dias desde la ingesta.';

create index call_recordings_call_id_idx
  on public.call_recordings (call_id);
create index call_recordings_lead_started_idx
  on public.call_recordings (lead_id, started_at desc);
create index call_recordings_campaign_started_idx
  on public.call_recordings (campaign_id, started_at desc);
create index call_recordings_agent_started_idx
  on public.call_recordings (agent_id, started_at desc);
create index call_recordings_team_started_idx
  on public.call_recordings (team_id, started_at desc);
create index call_recordings_ready_retention_idx
  on public.call_recordings (retention_until)
  where status = 'ready';
create index call_recordings_failed_updated_idx
  on public.call_recordings (updated_at)
  where status = 'failed';

-- Verifica que los rotulos desnormalizados correspondan al mismo intento y
-- conserva esos identificadores como snapshot historico. El trigger tambien
-- impide resucitar una grabacion ya marcada como eliminada.
create function public.enforce_call_recording_integrity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_attempt public.dial_attempts%rowtype;
  v_call public.calls%rowtype;
  v_lead public.leads%rowtype;
begin
  if tg_op = 'INSERT' then
    select *
      into v_attempt
      from public.dial_attempts
     where id = new.dial_attempt_id;

    if not found then
      raise exception 'dial_attempt % no existe', new.dial_attempt_id;
    end if;

    if v_attempt.call_id is null
      or v_attempt.agent_id is null
      or v_attempt.call_id is distinct from new.call_id
      or v_attempt.lead_id is distinct from new.lead_id
      or v_attempt.campaign_id is distinct from new.campaign_id
      or v_attempt.agent_id is distinct from new.agent_id then
      raise exception 'Los rotulos de la grabacion no corresponden al dial_attempt %', new.dial_attempt_id;
    end if;

    select * into v_call from public.calls where id = new.call_id;
    if not found
      or v_call.lead_id is distinct from new.lead_id
      or v_call.agent_id is distinct from new.agent_id then
      raise exception 'La llamada % no corresponde al lead/ejecutivo indicado', new.call_id;
    end if;

    select * into v_lead from public.leads where id = new.lead_id;
    if not found or v_lead.campaign_id is distinct from new.campaign_id then
      raise exception 'El lead % no corresponde a la campana indicada', new.lead_id;
    end if;

    if new.team_id is null then
      new.team_id := v_lead.team_id;
    elsif new.team_id is distinct from v_lead.team_id then
      raise exception 'El equipo indicado no corresponde al equipo actual del lead %', new.lead_id;
    end if;
  else
    if new.dial_attempt_id is distinct from old.dial_attempt_id
      or new.call_id is distinct from old.call_id
      or new.lead_id is distinct from old.lead_id
      or new.campaign_id is distinct from old.campaign_id
      or new.agent_id is distinct from old.agent_id
      or new.team_id is distinct from old.team_id
      or new.storage_bucket is distinct from old.storage_bucket
      or new.started_at is distinct from old.started_at
      or new.created_at is distinct from old.created_at then
      raise exception 'La identidad y los snapshots de una grabacion son inmutables';
    end if;

    if old.status = 'deleted' and new.status <> 'deleted' then
      raise exception 'Una grabacion eliminada no puede reactivarse';
    end if;

    if old.ingested_at is not null and (
      new.ingest_token_hash is distinct from old.ingest_token_hash
      or new.ingest_expires_at is distinct from old.ingest_expires_at
      or new.ingested_at is distinct from old.ingested_at
    ) then
      raise exception 'La evidencia de ingesta es inmutable una vez confirmada';
    end if;

    if new.status <> old.status and not (
      (old.status = 'recording' and new.status in ('processing', 'uploading', 'ready', 'failed', 'deleted'))
      or (old.status = 'processing' and new.status in ('uploading', 'ready', 'failed', 'deleted'))
      or (old.status = 'uploading' and new.status in ('ready', 'failed', 'deleted'))
      or (old.status = 'ready' and new.status in ('failed', 'archived', 'deleted'))
      or (old.status = 'failed' and new.status in ('recording', 'processing', 'uploading', 'deleted'))
      or (old.status = 'archived' and new.status = 'deleted')
    ) then
      raise exception 'Transicion de grabacion invalida: % -> %', old.status, new.status;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function public.enforce_call_recording_integrity()
  from public, anon, authenticated, service_role;

create trigger call_recordings_enforce_integrity
before insert or update on public.call_recordings
for each row execute function public.enforce_call_recording_integrity();

-- Auditoria append-only. El backend registra tanto la emision de una URL
-- firmada como el inicio/fin de reproduccion, descargas y operaciones de ciclo
-- de vida. Nunca se expone escritura directa al navegador.
create table public.call_recording_access_logs (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null
    references public.call_recordings(id) on delete restrict,
  actor_id uuid
    references public.profiles(id) on delete set null,
  actor_role public.app_role,
  action text not null check (action in (
    'signed_url_created', 'playback_started', 'playback_completed',
    'downloaded', 'archived', 'deleted'
  )),
  request_id uuid,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  accessed_at timestamptz not null default now()
);

comment on table public.call_recording_access_logs is
  'Auditoria append-only de acceso y operaciones sobre grabaciones; escritura exclusiva de backend.';

create index call_recording_access_logs_recording_accessed_idx
  on public.call_recording_access_logs (recording_id, accessed_at desc);
create index call_recording_access_logs_actor_accessed_idx
  on public.call_recording_access_logs (actor_id, accessed_at desc)
  where actor_id is not null;

alter table public.call_recordings enable row level security;
alter table public.call_recording_access_logs enable row level security;

create policy call_recordings_quality_select
on public.call_recordings
for select
to authenticated
using (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'supervisor'
    and team_id = any((select unnest(public.supervised_team_ids())))
  )
);

create policy call_recording_access_logs_quality_select
on public.call_recording_access_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.call_recordings recording
    where recording.id = recording_id
      and (
        (select public.current_role_name()) = 'admin'
        or (
          (select public.current_role_name()) = 'supervisor'
          and recording.team_id = any((select unnest(public.supervised_team_ids())))
        )
      )
  )
);

-- Opt-in explicito al Data API. RLS decide filas; los grants deciden
-- operaciones. El frontend no puede crear, modificar ni borrar catalogo/logs.
revoke all on public.call_recordings from anon, authenticated;
revoke all on public.call_recording_access_logs from anon, authenticated;
grant select (
  id,
  dial_attempt_id,
  call_id,
  lead_id,
  campaign_id,
  agent_id,
  team_id,
  storage_bucket,
  storage_path,
  codec,
  mime_type,
  size_bytes,
  sha256,
  duration_seconds,
  status,
  error_message,
  started_at,
  ended_at,
  retention_until,
  archived_at,
  deleted_at,
  created_at,
  updated_at
) on public.call_recordings to authenticated;
grant select on public.call_recording_access_logs to authenticated;

revoke all on public.call_recordings from service_role;
revoke all on public.call_recording_access_logs from service_role;
grant select, insert, update on public.call_recordings to service_role;
grant select, insert on public.call_recording_access_logs to service_role;

-- Bucket hot privado: Opus en contenedor Ogg, maximo 100 MiB por llamada.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'call-recordings',
  'call-recordings',
  false,
  104857600,
  array['audio/ogg', 'audio/opus']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- No hay policies INSERT/UPDATE/DELETE para authenticated: carga, reemplazo,
-- archivado y borrado pasan exclusivamente por Storage API con service_role.
-- La lectura exige una correspondencia exacta bucket+ruta con el catalogo,
-- estado ready y alcance de Calidad; conocer/adivinar una ruta no da acceso.
create policy call_recordings_storage_quality_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'call-recordings'
  and exists (
    select 1
    from public.call_recordings recording
    where recording.storage_bucket = storage.objects.bucket_id
      and recording.storage_path = storage.objects.name
      and recording.status = 'ready'
      and (
        (select public.current_role_name()) = 'admin'
        or (
          (select public.current_role_name()) = 'supervisor'
          and recording.team_id = any((select unnest(public.supervised_team_ids())))
        )
      )
  )
);
