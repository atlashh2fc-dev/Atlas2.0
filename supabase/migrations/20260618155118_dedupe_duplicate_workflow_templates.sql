delete from workflows w
where w.id not in (
  select id from (
    select id, name, row_number() over (partition by name order by created_at desc) as rn
    from workflows
  ) ranked
  where ranked.rn = 1
);;
