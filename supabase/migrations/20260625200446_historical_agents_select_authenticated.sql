create policy "historical_agents_select" on public.historical_agents
  for select
  to authenticated
  using (true);;
