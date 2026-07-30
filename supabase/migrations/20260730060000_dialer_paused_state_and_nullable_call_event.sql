-- 1) Una pausa de cola no es un cierre de llamada. El motor la mapeaba a
--    'wrap_up' y la guarda que impide sacar a alguien de wrap-up dejaba al
--    ejecutivo atrapado: al volver de AUX se quedaba sin llamadas y con el
--    selector de estado bloqueado hasta que tipificara cualquier gestión.
alter table public.dialer_agent_sessions drop constraint if exists dialer_agent_sessions_status_check;
alter table public.dialer_agent_sessions
  add constraint dialer_agent_sessions_status_check
  check (status = any (array['offline', 'available', 'ringing', 'on_call', 'wrap_up', 'paused']));

comment on column public.dialer_agent_sessions.status is 'offline | available | ringing | on_call | wrap_up (cierre de llamada, bloquea capacidad) | paused (AUX, el ejecutivo salió de la cola por su cuenta).';

-- 2) `call_events.call_id` era NOT NULL, así que todo evento anterior a que
--    exista la llamada (originando, timbrando, screen-pop del discador) fallaba
--    con 23502 y se perdía en un log.
alter table public.call_events alter column call_id drop not null;

comment on column public.call_events.call_id is 'Nulo mientras el evento ocurre antes de que exista la gestión (originando, timbrando, screen-pop).';
