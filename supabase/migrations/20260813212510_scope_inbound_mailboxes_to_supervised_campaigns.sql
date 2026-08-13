-- La bandeja vive dentro de una campaña. Un supervisor sólo puede leerla si
-- supervisa al menos un ejecutivo asignado a esa campaña; admin conserva la
-- vista global. Esto replica en RLS la jerarquía aplicada por la interfaz.

create or replace function public.can_operate_inbound_campaign(p_campaign_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $function$
  select
    (select public.current_role_name()) = 'admin'
    or (
      (select public.current_role_name()) = 'supervisor'
      and exists (
        select 1
        from public.campaign_agents membership
        join public.profiles agent on agent.id = membership.profile_id
        where membership.campaign_id = p_campaign_id
          and agent.role = 'agente'
          and agent.active
          and agent.team_id = any((select unnest(public.supervised_team_ids())))
      )
    );
$function$;

revoke all on function public.can_operate_inbound_campaign(uuid) from public, anon;
grant execute on function public.can_operate_inbound_campaign(uuid) to authenticated, service_role;

drop policy if exists inbound_mailboxes_ops_select on public.inbound_mailboxes;
create policy inbound_mailboxes_ops_select
on public.inbound_mailboxes
for select
to authenticated
using ((select public.can_operate_inbound_campaign(campaign_id)));

drop policy if exists inbound_emails_ops_select on public.inbound_emails;
create policy inbound_emails_ops_select
on public.inbound_emails
for select
to authenticated
using (
  exists (
    select 1
    from public.inbound_mailboxes mailbox
    where mailbox.id = mailbox_id
      and mailbox.active
      and (select public.can_operate_inbound_campaign(mailbox.campaign_id))
  )
);
