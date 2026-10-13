-- Batch material claims stay atomic while supporting both full-capacity and
-- per-item quantities. A null amounts array means "claim every available item".
drop function if exists public.set_material_claims(uuid[], integer, text);

create or replace function public.set_material_claims(
  p_item_ids uuid[],
  p_amounts integer[],
  p_note text
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_item_id uuid;
  claim_amount integer;
  item_capacity bigint;
  other_reserved bigint;
  changed integer := 0;
begin
  if not private.can_edit_materials() then raise insufficient_privilege; end if;
  if p_item_ids is null or cardinality(p_item_ids) not between 1 and 5000 then
    raise exception 'Invalid batch claim';
  end if;
  if exists (select 1 from unnest(p_item_ids) as source(item_id) where source.item_id is null) then
    raise exception 'Invalid batch claim';
  end if;
  if (
    select count(distinct source.item_id)
    from unnest(p_item_ids) as source(item_id)
  ) <> cardinality(p_item_ids) then
    raise exception 'Invalid batch claim';
  end if;
  if p_amounts is not null and cardinality(p_amounts) <> cardinality(p_item_ids) then
    raise exception 'Invalid batch claim';
  end if;
  if p_amounts is not null and exists (
    select 1 from unnest(p_amounts) as source(amount)
    where source.amount is null or source.amount <= 0
  ) then
    raise exception 'Invalid batch claim';
  end if;

  -- UUID order gives concurrent batches one deterministic lock order.
  for target_item_id in
    select source.item_id
    from unnest(p_item_ids) as source(item_id)
    order by source.item_id
  loop
    if p_amounts is null then
      select greatest(item.source_missing_count - item.initial_available_count, 0)
      into item_capacity
      from public.material_items as item
      where item.id = target_item_id
      for update;
      if not found then raise no_data_found; end if;

      select coalesce(sum(assignment.amount), 0)
      into other_reserved
      from public.material_assignments as assignment
      where assignment.item_id = target_item_id
        and assignment.claimant_id is distinct from actor_id;
      claim_amount := greatest(item_capacity - other_reserved, 0);
    else
      select source.amount
      into claim_amount
      from unnest(p_item_ids, p_amounts) as source(candidate_id, amount)
      where source.candidate_id = target_item_id;
    end if;

    if claim_amount <= 0 then
      raise exception 'error.materialClaimExceeded' using errcode = '22003';
    end if;
    perform private.save_material_claim(actor_id, target_item_id, claim_amount, p_note);
    changed := changed + 1;
  end loop;
  return changed;
end;
$$;

revoke all on function public.set_material_claims(uuid[], integer[], text)
  from public, anon;
grant execute on function public.set_material_claims(uuid[], integer[], text)
  to authenticated, service_role;
