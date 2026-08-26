-- Multimedia de WhatsApp: los objetos quedan privados en Storage y cada
-- lectura se autoriza contra el alcance real de la conversación. Las URLs
-- efímeras del proveedor nunca se usan como fuente permanente del CRM.

alter table public.whatsapp_messages
  add column media_storage_bucket text,
  add column media_storage_path text,
  add column media_mime_type text,
  add column media_size_bytes bigint,
  add column media_file_name text,
  add column media_sha256 text,
  add column media_status text
    check (media_status is null or media_status in ('pending', 'ready', 'failed'));

alter table public.whatsapp_messages
  add constraint whatsapp_messages_media_storage_pair
    check (
      (media_storage_bucket is null and media_storage_path is null)
      or (media_storage_bucket is not null and media_storage_path is not null)
    ),
  add constraint whatsapp_messages_media_size_positive
    check (media_size_bytes is null or media_size_bytes > 0);

create unique index whatsapp_messages_media_storage_uidx
  on public.whatsapp_messages(media_storage_bucket, media_storage_path)
  where media_storage_path is not null;

create table public.whatsapp_media_uploads (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  storage_bucket text not null default 'whatsapp-media',
  storage_path text not null unique,
  message_type text not null check (message_type in ('image', 'audio')),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 16777216),
  file_name text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  client_reference uuid not null unique default gen_random_uuid(),
  status text not null default 'prepared'
    check (status in ('prepared', 'sent', 'failed', 'expired')),
  message_id uuid unique references public.whatsapp_messages(id) on delete set null,
  error_message text,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index whatsapp_media_uploads_conversation_idx
  on public.whatsapp_media_uploads(conversation_id, created_at desc);

create trigger whatsapp_media_uploads_set_updated_at
  before update on public.whatsapp_media_uploads
  for each row execute function public.set_updated_at();

alter table public.whatsapp_media_uploads enable row level security;

revoke all on table public.whatsapp_media_uploads from anon, authenticated;
grant all on table public.whatsapp_media_uploads to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'whatsapp-media',
  'whatsapp-media',
  false,
  16777216,
  array[
    'image/jpeg',
    'image/png',
    'audio/aac',
    'audio/mp4',
    'audio/mpeg',
    'audio/amr',
    'audio/ogg',
    'audio/opus'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- No se conceden policies de Storage a authenticated. El navegador solo
-- recibe tokens de carga o lectura breves emitidos por el backend después de
-- comprobar la conversación mediante RLS. service_role conserva la escritura.

comment on table public.whatsapp_media_uploads is
  'Preparaciones efimeras y auditables para adjuntos salientes de WhatsApp.';

comment on column public.whatsapp_messages.media_storage_path is
  'Ruta privada durable del adjunto; no guardar aqui la URL temporal del proveedor.';
