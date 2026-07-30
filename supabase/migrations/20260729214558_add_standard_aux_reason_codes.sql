-- Modelo operativo CTI basado en el patrón Ready / Not Ready + reason code:
-- "Disponible" permite recibir y originar llamadas; todo motivo AUX pausa al
-- agente en Asterisk. El AUX genérico se conserva para no romper el historial,
-- pero deja de ser seleccionable: el ejecutivo debe escoger un motivo concreto.

insert into public.agent_status_reasons
  (code, label, is_pause, sort_order, is_active, is_system)
values
  ('retroalimentacion', 'Retroalimentación', true, 10, true, false),
  ('descanso', 'Descanso', true, 20, true, false),
  ('bano', 'Baño', true, 30, true, false),
  ('capacitacion', 'Capacitación', true, 40, true, false),
  ('almuerzo', 'Almuerzo / colación', true, 50, true, false),
  ('reunion', 'Reunión', true, 60, true, false),
  ('trabajo_administrativo', 'Trabajo administrativo', true, 70, true, false),
  ('soporte_tecnico', 'Soporte técnico', true, 80, true, false)
on conflict (code) do update
set
  label = excluded.label,
  is_pause = excluded.is_pause,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  is_system = excluded.is_system,
  updated_at = now();

update public.agent_status_reasons
set
  label = 'Disponible',
  is_pause = false,
  sort_order = 0,
  is_active = true,
  is_system = false,
  updated_at = now()
where code = 'disponible';

update public.agent_status_reasons
set
  is_pause = true,
  sort_order = 90,
  is_active = false,
  is_system = false,
  updated_at = now()
where code = 'auxiliar';
