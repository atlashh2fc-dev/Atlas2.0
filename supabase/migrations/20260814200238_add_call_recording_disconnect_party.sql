-- Conserva la señal autoritativa de app_queue sobre quién terminó la llamada.
-- AgentComplete.Reason distingue caller, agent y transfer; Hangup Cause=16 no.

alter table public.call_recordings
  add column disconnect_party text,
  add column queue_talk_seconds integer;

alter table public.call_recordings
  add constraint call_recordings_disconnect_party_check
  check (disconnect_party is null or disconnect_party in ('caller', 'agent', 'transfer')),
  add constraint call_recordings_queue_talk_seconds_check
  check (queue_talk_seconds is null or queue_talk_seconds >= 0);

comment on column public.call_recordings.disconnect_party is
  'Origen del término informado por Asterisk AgentComplete.Reason: caller, agent o transfer.';
comment on column public.call_recordings.queue_talk_seconds is
  'Duración del tramo atendido informada por Asterisk AgentComplete.TalkTime; permite detectar audio truncado.';

-- call_recordings usa grants de columna para authenticated; RLS conserva el
-- alcance de Calidad por rol/equipo y service_role ya posee UPDATE de tabla.
grant select (disconnect_party, queue_talk_seconds) on public.call_recordings to authenticated;
