create or replace function public.mark_order_ready(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.' using errcode = '22023';
  end if;

  if not (
    public.is_super_admin()
    or public.is_kitchen_of(v_order.restaurant_id)
    or public.is_owner_or_admin_of(v_order.restaurant_id)
  ) then
    raise exception 'Only Kitchen, an admin, or the owner may mark this order ready.'
      using errcode = '42501';
  end if;

  if v_order.status <> 'preparing' then
    raise exception 'Order must be preparing before it can be marked ready (current status: %).', v_order.status
      using errcode = '22023';
  end if;

  update public.orders
     set status = 'ready',
         updated_at = now()
   where id = p_order_id
   returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.mark_order_ready(uuid) from public;
grant execute on function public.mark_order_ready(uuid) to authenticated;
