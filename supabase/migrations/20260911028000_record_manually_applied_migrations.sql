-- Registra tres migraciones cuyo efecto ya está en la base.
--
-- Las dos primeras se aplicaron a mano porque el entorno de trabajo bloquea la
-- escritura de políticas RLS y de jobs de cron, así que el SQL lo corrió una
-- persona en el editor de Supabase. La tercera venía de antes: su función
-- `can_operate_inbound_campaign` y la política de `inbound_mailboxes` que la
-- usa existen y funcionan, sólo faltaba el registro.
--
-- Verificado objeto por objeto antes de registrar, y se registran sin
-- reejecutar. Es idempotente.

insert into supabase_migrations.schema_migrations (version, name, statements)
values
  ('20260910230000', 'slow_down_workflow_compliance_refresh',
   array['-- aplicada a mano: el cron quedo en */10, verificado en cron.job']),
  ('20260911012000', 'index_friendly_agent_lead_visibility',
   array['-- aplicada a mano: las politicas leads_select y leads_update usan la forma con cast, verificado']),
  ('20260813212510', 'scope_inbound_mailboxes_to_supervised_campaigns',
   array['-- ya estaba aplicada: can_operate_inbound_campaign y la politica inbound_mailboxes_ops_select existen'])
on conflict (version) do nothing;
