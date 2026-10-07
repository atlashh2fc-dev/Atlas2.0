-- Perfil «Calidad» (parte 2): pautas versionadas por empresa, validación humana
-- de cada evaluación y lectura de grabaciones para el nuevo perfil.
--
-- Qué ve Calidad: todas las grabaciones, transcripciones y evaluaciones de la
-- empresa que está mirando (la política restrictiva de aislamiento por empresa
-- sigue intacta). No ve clientes, ventas, campañas ni usuarios: solo calidad.
--
-- Las pautas dejan de vivir en el código. Cada empresa carga la suya (planilla
-- de rúbrica), con versión, campañas a las que aplica y muestra diaria. La
-- evaluación guarda un snapshot de la rúbrica usada: cambiar la pauta nunca
-- reescribe una nota histórica.

-- 1. Pautas ---------------------------------------------------------------

create table public.quality_pautas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  version integer not null,
  name text not null,
  campaign_ids uuid[] not null default '{}',
  status text not null default 'vigente',
  rubrics jsonb not null,
  scale jsonb not null default '{"cumple": 1, "parcial": 0.5, "no_cumple": 0, "no_aplica": 1}'::jsonb,
  objective numeric(5, 2) not null default 95,
  min_seconds integer not null default 60,
  sample_outcomes text[] not null default '{sale,interested,callback,not_interested}',
  daily_sample_per_agent integer not null default 0,
  notes text,
  source_filename text,
  source_sha256 text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quality_pautas_key_version_unique unique (organization_id, key, version),
  constraint quality_pautas_key_check check (key ~ '^[a-z0-9_]{2,60}$'),
  constraint quality_pautas_version_check check (version > 0),
  constraint quality_pautas_name_check check (nullif(btrim(name), '') is not null),
  constraint quality_pautas_status_check check (status in ('vigente', 'archivada')),
  constraint quality_pautas_rubrics_check check (
    jsonb_typeof(rubrics) = 'array' and jsonb_array_length(rubrics) between 1 and 10
  ),
  constraint quality_pautas_scale_check check (jsonb_typeof(scale) = 'object'),
  constraint quality_pautas_objective_check check (objective between 0 and 100),
  constraint quality_pautas_min_seconds_check check (min_seconds between 0 and 3600),
  constraint quality_pautas_sample_check check (daily_sample_per_agent between 0 and 50)
);

comment on table public.quality_pautas is
  'Pauta de calidad versionada por empresa: rúbricas (atributo, peso, definición), escala y muestra automática.';
comment on column public.quality_pautas.rubrics is
  'Arreglo de rúbricas [{key, name, outcomes[], criteria[{id, name, weight, definition}]}]; outcomes "*" = resto de tipificaciones.';
comment on column public.quality_pautas.daily_sample_per_agent is
  'Llamadas por ejecutivo y día que Atlas transcribe y evalúa solo. 0 = solo a pedido.';

-- Una sola versión vigente por pauta y empresa.
create unique index quality_pautas_one_active_idx
  on public.quality_pautas (organization_id, key)
  where status = 'vigente';
create index quality_pautas_campaigns_idx
  on public.quality_pautas using gin (campaign_ids);

alter table public.quality_pautas enable row level security;

create policy quality_pautas_quality_select
on public.quality_pautas
for select
to authenticated
using (
  organization_id = any((select public.current_org_ids())::uuid[])
  and (select public.current_role_name()) in ('admin', 'supervisor', 'calidad')
);

revoke all on public.quality_pautas from anon, authenticated, service_role;
grant select on public.quality_pautas to authenticated;
grant select, insert, update on public.quality_pautas to service_role;

-- 2. Evaluación IA: enlace a la pauta y causa de llamada no válida ----------

alter table public.call_quality_evaluations
  add column if not exists pauta_id uuid references public.quality_pautas(id) on delete set null,
  add column if not exists invalid_reason text,
  add column if not exists critical_errors integer,
  add column if not exists non_critical_errors integer;

alter table public.call_quality_evaluations
  add constraint call_quality_evaluations_invalid_reason_check
    check (invalid_reason is null or invalid_reason in ('audio_incompleto', 'corte', 'no_corresponde', 'error_tecnico'));

create index if not exists call_quality_evaluations_pauta_idx
  on public.call_quality_evaluations (pauta_id, completed_at desc)
  where pauta_id is not null;

-- 3. Validación humana -------------------------------------------------------

create table public.call_quality_reviews (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null unique references public.call_recordings(id) on delete cascade,
  evaluation_id uuid references public.call_quality_evaluations(id) on delete set null,
  pauta_id uuid references public.quality_pautas(id) on delete set null,
  rubric_key text not null,
  rubric_version integer not null,
  rubric_snapshot jsonb not null,
  reviewer_id uuid references public.profiles(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  agent_id uuid references public.profiles(id) on delete set null,
  call_started_at timestamptz not null,
  call_validity text not null default 'valida',
  criteria jsonb not null default '[]'::jsonb,
  overall_score numeric(5, 2),
  verdict text not null,
  critical_errors integer not null default 0,
  non_critical_errors integer not null default 0,
  ai_score numeric(5, 2),
  ai_agreement numeric(4, 3),
  action text not null default 'sin_accion',
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint call_quality_reviews_validity_check
    check (call_validity in ('valida', 'audio_incompleto', 'corte', 'no_corresponde', 'error_tecnico')),
  constraint call_quality_reviews_verdict_check
    check (verdict in ('cumple', 'parcial', 'no_cumple', 'no_evaluable')),
  constraint call_quality_reviews_score_check
    check (overall_score is null or overall_score between 0 and 100),
  constraint call_quality_reviews_ai_score_check
    check (ai_score is null or ai_score between 0 and 100),
  constraint call_quality_reviews_agreement_check
    check (ai_agreement is null or ai_agreement between 0 and 1),
  constraint call_quality_reviews_action_check
    check (action in ('feedback_individual', 'recapacitacion_masiva', 'escalar_supervision', 'sin_accion')),
  constraint call_quality_reviews_criteria_check check (jsonb_typeof(criteria) = 'array'),
  constraint call_quality_reviews_valid_score_check
    check (call_validity <> 'valida' or overall_score is not null),
  constraint call_quality_reviews_comment_check check (comment is null or length(comment) <= 4000)
);

comment on table public.call_quality_reviews is
  'Validación humana de una llamada contra la pauta: corrige o confirma a la IA y es la nota oficial.';
comment on column public.call_quality_reviews.ai_agreement is
  'Proporción de atributos en que la analista coincidió con la evaluación IA (calibración).';

create index call_quality_reviews_org_started_idx
  on public.call_quality_reviews (organization_id, call_started_at desc);
create index call_quality_reviews_agent_started_idx
  on public.call_quality_reviews (agent_id, call_started_at desc);
create index call_quality_reviews_reviewer_idx
  on public.call_quality_reviews (reviewer_id);
create index call_quality_reviews_evaluation_idx
  on public.call_quality_reviews (evaluation_id);
create index call_quality_reviews_pauta_idx
  on public.call_quality_reviews (pauta_id);
create index call_quality_reviews_campaign_idx
  on public.call_quality_reviews (campaign_id);

alter table public.call_quality_reviews enable row level security;

create policy call_quality_reviews_organization_isolation
on public.call_quality_reviews
as restrictive
for all
to authenticated
using (organization_id = any((select public.current_org_ids())::uuid[]));

create policy call_quality_reviews_quality_select
on public.call_quality_reviews
for select
to authenticated
using (
  (select public.current_role_name()) in ('admin', 'calidad')
  or (
    (select public.current_role_name()) = 'supervisor'
    and exists (
      select 1 from public.call_recordings recording
      where recording.id = call_quality_reviews.recording_id
        and recording.team_id in (select unnest(public.supervised_team_ids()))
    )
  )
);

revoke all on public.call_quality_reviews from anon, authenticated, service_role;
grant select on public.call_quality_reviews to authenticated;
grant select, insert, update on public.call_quality_reviews to service_role;

-- 4. Calidad lee grabaciones, transcripciones, evaluaciones y audio -----------
-- Las políticas restrictivas por empresa ya existentes siguen acotando a la
-- empresa que la persona está mirando.

drop policy if exists call_recordings_quality_select on public.call_recordings;
create policy call_recordings_quality_select
on public.call_recordings
for select
to authenticated
using (
  (select public.current_role_name()) in ('admin', 'calidad')
  or (
    (select public.current_role_name()) = 'supervisor'
    and team_id in (select unnest(public.supervised_team_ids()))
  )
);

drop policy if exists call_transcriptions_quality_select on public.call_transcriptions;
create policy call_transcriptions_quality_select
on public.call_transcriptions
for select
to authenticated
using (
  exists (
    select 1 from public.call_recordings recording
    where recording.id = call_transcriptions.recording_id
      and (
        (select public.current_role_name()) in ('admin', 'calidad')
        or (
          (select public.current_role_name()) = 'supervisor'
          and recording.team_id in (select unnest(public.supervised_team_ids()))
        )
      )
  )
);

drop policy if exists call_quality_evaluations_quality_select on public.call_quality_evaluations;
create policy call_quality_evaluations_quality_select
on public.call_quality_evaluations
for select
to authenticated
using (
  exists (
    select 1 from public.call_recordings recording
    where recording.id = call_quality_evaluations.recording_id
      and (
        (select public.current_role_name()) in ('admin', 'calidad')
        or (
          (select public.current_role_name()) = 'supervisor'
          and recording.team_id in (select unnest(public.supervised_team_ids()))
        )
      )
  )
);

drop policy if exists call_recording_access_logs_quality_select on public.call_recording_access_logs;
create policy call_recording_access_logs_quality_select
on public.call_recording_access_logs
for select
to authenticated
using (
  exists (
    select 1 from public.call_recordings recording
    where recording.id = call_recording_access_logs.recording_id
      and (
        (select public.current_role_name()) in ('admin', 'calidad')
        or (
          (select public.current_role_name()) = 'supervisor'
          and recording.team_id in (select unnest(public.supervised_team_ids()))
        )
      )
  )
);

-- El enlace firmado del audio exige que storage.objects autorice el objeto.
-- Se agrega la empresa explícitamente: storage no tiene política restrictiva.
drop policy if exists call_recordings_storage_quality_select on storage.objects;
create policy call_recordings_storage_quality_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'call-recordings'
  and exists (
    select 1 from public.call_recordings recording
    where recording.storage_bucket = objects.bucket_id
      and recording.storage_path = objects.name
      and recording.status = 'ready'
      and (
        (select public.current_role_name()) = 'admin'
        or (
          (select public.current_role_name()) = 'calidad'
          and public.org_of_lead(recording.lead_id) = any((select public.current_org_ids())::uuid[])
        )
        or (
          (select public.current_role_name()) = 'supervisor'
          and recording.team_id in (select unnest(public.supervised_team_ids()))
        )
      )
  )
);

-- 5. Pauta Equifax v1 (Rúbrica Pauta Calidad.xlsx, 07-10-2026) ----------------
-- Dos rúbricas: «General» para toda conversación y «No interesa» cuando la
-- llamada se tipificó como rechazo. Pesos en puntos sobre 100.
-- En la planilla, «Lenguaje profesional y claridad» y «Empatía, escucha activa
-- y trato cordial» de la rúbrica General traían por error la definición de
-- otros atributos (fallas de sistema y política comercial); se usa la
-- definición de esos mismos atributos en la rúbrica No interesa.

insert into public.quality_pautas (
  organization_id, key, version, name, campaign_ids, status, rubrics, scale,
  objective, min_seconds, sample_outcomes, daily_sample_per_agent, notes, source_filename
)
select
  organization.id,
  'equifax',
  1,
  'Pauta de calidad Equifax · Infobusiness',
  coalesce(
    (select array_agg(campaign.id order by campaign.name)
     from public.campaigns campaign
     where campaign.organization_id = organization.id
       and campaign.name ilike '%equifax%'),
    '{}'::uuid[]
  ),
  'vigente',
  $rubrics$[
    {
      "key": "general",
      "name": "Rúbrica general",
      "outcomes": ["*"],
      "criteria": [
        {"id": "presentacion_identificacion", "name": "Presentación e identificación", "weight": 8,
         "definition": "Ejecutivo se presenta correctamente indicando nombre, empresa e identificación de Infobusiness como distribuidor autorizado de Equifax. Genera contexto claro y profesional del llamado."},
        {"id": "validacion_interlocutor", "name": "Validación de interlocutor", "weight": 12,
         "definition": "Ejecutivo valida si habla con la persona correcta o identifica al responsable de evaluación comercial, facturación o cobranza cuando corresponde."},
        {"id": "deteccion_necesidad", "name": "Detección de necesidad / diagnóstico", "weight": 15,
         "definition": "Ejecutivo realiza preguntas abiertas para identificar necesidad real del cliente: riesgo de incobrables, evaluación de clientes, cobranza, monitoreo de cartera o necesidad comercial. No realiza discurso genérico sin diagnóstico."},
        {"id": "presentacion_valor", "name": "Presentación de valor del producto", "weight": 12,
         "definition": "Ejecutivo explica beneficios y valor del producto ofertado de forma consultiva, relacionando la solución con la necesidad detectada. Debe ser coherente con Reporte Interactivo, Mora Control o Portfolio Monitor."},
        {"id": "manejo_objeciones", "name": "Manejo de objeciones", "weight": 20,
         "definition": "Escucha la objeción sin interrumpir y responde con argumentos consultivos, claros y alineados al producto, evitando confrontar o presionar de forma agresiva."},
        {"id": "interes_siguiente_paso", "name": "Interés de agenda y siguiente paso", "weight": 10,
         "definition": "Capacidad del ejecutivo para identificar el nivel de interés del cliente, generar compromiso con una acción futura y dejar claramente definido el próximo paso de la gestión, asegurando continuidad en el proceso comercial o de cobranza."},
        {"id": "lenguaje_profesional", "name": "Lenguaje profesional y claridad", "weight": 8,
         "definition": "Utiliza lenguaje claro, profesional y comprensible para cliente Pyme, evitando tecnicismos innecesarios, muletillas, coloquialismos o expresiones que resten credibilidad."},
        {"id": "empatia_escucha", "name": "Empatía, escucha activa y trato cordial", "weight": 12,
         "definition": "Mantiene tono cordial, demuestra disposición de ayuda, escucha activamente y adapta su comunicación al cliente sin sonar plano, apurado o desganado."},
        {"id": "fluidez_silencios", "name": "Fluidez y control de silencios", "weight": 3,
         "definition": "Capacidad del ejecutivo para mantener una conversación natural, clara y continua, evitando pausas prolongadas o silencios innecesarios que puedan generar incertidumbre, incomodidad o una mala experiencia para el cliente."}
      ]
    },
    {
      "key": "no_interesa",
      "name": "Rúbrica no interesa",
      "outcomes": ["not_interested"],
      "criteria": [
        {"id": "presentacion_identificacion", "name": "Presentación e identificación", "weight": 8,
         "definition": "Ejecutivo se presenta correctamente indicando nombre, empresa e identificación de Infobusiness como distribuidor autorizado de Equifax. Genera contexto claro y profesional del llamado."},
        {"id": "validacion_interlocutor", "name": "Validación de interlocutor", "weight": 10,
         "definition": "Ejecutivo valida si habla con la persona correcta o identifica al responsable de evaluación comercial, facturación o cobranza cuando corresponda."},
        {"id": "deteccion_contexto", "name": "Detección de necesidad y contexto actual", "weight": 15,
         "definition": "Ejecutivo realiza preguntas abiertas para identificar la situación actual del cliente, indaga si utiliza servicios similares y comprende el escenario antes de aceptar el rechazo."},
        {"id": "causa_desinteres", "name": "Investigación de la causa del desinterés", "weight": 12,
         "definition": "Ejecutivo pregunta por qué no existe interés. Determina si es por presupuesto, momento, proveedor actual, desconocimiento o falta de necesidad, proceso de quiebra, mala experiencia, etc."},
        {"id": "intento_generar_interes", "name": "Intento de generación de interés", "weight": 25,
         "definition": "Ejecutivo realiza al menos un intento de generar curiosidad o valor, menciona un beneficio relevante según el perfil del cliente y no abandona la gestión ante el primer «no»."},
        {"id": "captura_informacion", "name": "Captura de información relevante", "weight": 8,
         "definition": "Registra el motivo real del rechazo u obtiene información que permita futuras campañas."},
        {"id": "lenguaje_profesional", "name": "Lenguaje profesional y claridad", "weight": 8,
         "definition": "Utiliza lenguaje claro, profesional y comprensible para cliente Pyme, evitando tecnicismos innecesarios, muletillas, coloquialismos o expresiones que resten credibilidad."},
        {"id": "empatia_escucha", "name": "Empatía, escucha activa y trato cordial", "weight": 8,
         "definition": "Mantiene tono cordial, demuestra disposición de ayuda, escucha activamente y adapta su comunicación al cliente sin sonar plano, apurado o desganado."},
        {"id": "fluidez_silencios", "name": "Fluidez y control de silencios", "weight": 6,
         "definition": "No excede silencios prolongados sin interacción con el cliente y mantiene continuidad lógica en la conversación. Evita dejar al cliente sin contexto durante la llamada."}
      ]
    }
  ]$rubrics$::jsonb,
  '{"cumple": 1, "parcial": 0.5, "no_cumple": 0, "no_aplica": 1}'::jsonb,
  95,
  60,
  '{sale,interested,callback,not_interested}',
  3,
  'En la rúbrica General, «Lenguaje profesional y claridad» y «Empatía, escucha activa y trato cordial» venían con la definición de otros atributos; se usa la de la rúbrica No interesa.',
  'Rubrica Pauta Calidad.xlsx'
from public.organizations organization
where organization.name = 'Geimser'
on conflict (organization_id, key, version) do nothing;
