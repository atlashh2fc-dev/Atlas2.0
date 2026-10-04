-- Órbita · cada agente puede llevar un nombre de persona.
--
-- La red se muestra como un equipo de marketing: "Tomás" trabajando como
-- Educador, "Catalina" como CEO. `nombre` sigue siendo el cargo ("Educador")
-- y `persona` es el nombre con que el equipo se presenta en pantalla. Es
-- opcional: un agente sin persona (el Guardián) se ve por su cargo. La
-- pantalla igual dice que es un equipo de IA.
--
-- Idempotente: se puede correr más de una vez.

alter table public.orbita_agentes
  add column if not exists persona text;

alter table public.orbita_agentes
  drop constraint if exists orbita_agentes_persona_not_blank;

alter table public.orbita_agentes
  add constraint orbita_agentes_persona_not_blank check (persona is null or btrim(persona) <> '');

comment on column public.orbita_agentes.persona is
  'Nombre de persona con que el agente se presenta en Órbita ("Tomás"). nombre queda como su cargo. Opcional.';
