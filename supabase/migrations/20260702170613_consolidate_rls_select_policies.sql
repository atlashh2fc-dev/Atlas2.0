-- Avoid duplicate permissive SELECT policies while preserving the same
-- authorization model for admin writes.

drop policy if exists crm_entities_select on public.crm_entities;
create policy crm_entities_select
on public.crm_entities
for select
to authenticated
using (
  (select public.current_role_name()) = 'admin'
  or exists (
    select 1
    from public.leads l
    where l.crm_entity_id = crm_entities.id
  )
);

drop policy if exists crm_entities_write_admin on public.crm_entities;
create policy crm_entities_insert_admin
on public.crm_entities
for insert
to authenticated
with check ((select public.current_role_name()) = 'admin');

create policy crm_entities_update_admin
on public.crm_entities
for update
to authenticated
using ((select public.current_role_name()) = 'admin')
with check ((select public.current_role_name()) = 'admin');

create policy crm_entities_delete_admin
on public.crm_entities
for delete
to authenticated
using ((select public.current_role_name()) = 'admin');

drop policy if exists historical_agents_write on public.historical_agents;
create policy historical_agents_insert_admin
on public.historical_agents
for insert
to authenticated
with check ((select public.current_role_name()) = 'admin');

create policy historical_agents_update_admin
on public.historical_agents
for update
to authenticated
using ((select public.current_role_name()) = 'admin')
with check ((select public.current_role_name()) = 'admin');

create policy historical_agents_delete_admin
on public.historical_agents
for delete
to authenticated
using ((select public.current_role_name()) = 'admin');
