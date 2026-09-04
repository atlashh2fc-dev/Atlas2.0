create index if not exists leads_operational_queue_order_idx
  on public.leads (next_action_at asc nulls last, updated_at desc)
  where phone is not null and phone <> '';
