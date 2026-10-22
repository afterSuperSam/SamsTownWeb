-- 仅运行在隔离数据库；验证公开项目读取、所有权、区块完整性及改密门禁。
begin;
insert into auth.users (id,email,raw_user_meta_data,raw_app_meta_data) values
  ('00000000-0000-4000-8000-000000000001','map-member@example.test','{"username":"MapMember"}','{"yingwu_trusted_provisioning":true}'),
  ('00000000-0000-4000-8000-000000000002','other-member@example.test','{"username":"OtherMember"}','{"yingwu_trusted_provisioning":true}');
update public.profiles set must_change_password=false
where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
insert into public.town_maps (id,name,image_width,image_height,max_level,original_path,storage_prefix,created_by,is_visible) values
  ('00000000-0000-4000-8000-000000000010','Public map',4096,4096,12,'fixture/public/original.png','fixture/public','00000000-0000-4000-8000-000000000001',true),
  ('00000000-0000-4000-8000-000000000020','Other map',4096,4096,12,'fixture/other/original.png','fixture/other','00000000-0000-4000-8000-000000000001',true),
  ('00000000-0000-4000-8000-000000000030','Hidden map',4096,4096,12,'fixture/hidden/original.png','fixture/hidden','00000000-0000-4000-8000-000000000001',false);
insert into public.map_claims (id,map_id,owner_id,project_name,minecraft_username,color)
select md5('fixture-project-' || item)::uuid,'00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000001','Project ' || item,'MapMember','#d38d42'
from generate_series(0,1030) item;
insert into public.map_claim_cells (claim_id,map_id,chunk_column,chunk_row)
select md5('fixture-project-' || item)::uuid,'00000000-0000-4000-8000-000000000010',item % 64,item / 64
from generate_series(0,1030) item;

set local role anon;
do $$
declare result jsonb;
begin
  result := public.list_map_claim_summaries('00000000-0000-4000-8000-000000000010');
  if (result->>'total')::integer <> 1031 or jsonb_array_length(result->'items') <> 30 then raise exception 'Public summary pagination failed'; end if;
  result := public.list_map_claim_summaries('00000000-0000-4000-8000-000000000010',p_offset=>1020);
  if jsonb_array_length(result->'items') <> 11 then raise exception 'Final summary page failed'; end if;
  result := public.list_map_claim_summaries('00000000-0000-4000-8000-000000000010',p_query=>'Project 1030');
  if (result->>'total')::integer <> 1 then raise exception 'Project name search failed'; end if;
  result := public.list_map_claim_summaries('00000000-0000-4000-8000-000000000010',p_query=>'MapMember');
  if (result->>'total')::integer <> 0 then raise exception 'Search must match names only'; end if;
  result := public.get_map_claim_detail('00000000-0000-4000-8000-000000000010',md5('fixture-project-0')::uuid);
  if result ? 'status' or result ? 'visibility' or jsonb_array_length(result->'cells') <> 1 then raise exception 'Unexpected project shape'; end if;
  begin
    perform public.list_map_claim_summaries('00000000-0000-4000-8000-000000000030');
    raise exception 'Guest accessed hidden map';
  exception when insufficient_privilege then null; end;
  if has_function_privilege('anon','public.save_map_claim(uuid,uuid,text,text,text,text,jsonb,uuid)','EXECUTE')
    then raise exception 'Guest can write projects'; end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
do $$
declare result jsonb; own_id uuid; changed integer;
begin
  update public.map_claims set project_name='stolen' where id=md5('fixture-project-0')::uuid;
  get diagnostics changed=row_count;
  if changed <> 0 then raise exception 'Member edited another project'; end if;
  delete from public.map_claims where id=md5('fixture-project-0')::uuid;
  get diagnostics changed=row_count;
  if changed <> 0 then raise exception 'Member deleted another project'; end if;
  begin
    perform public.save_map_claim(md5('fixture-project-0')::uuid,'00000000-0000-4000-8000-000000000010',
      'Stolen','OtherMember','','#d38d42','[{"column":0,"row":0}]');
    raise exception 'Member hijacked another project through RPC';
  exception when insufficient_privilege or no_data_found then null; end;
  result := public.save_map_claim(null,'00000000-0000-4000-8000-000000000010','Own project','OtherMember','','#d38d42',
    '[{"column":0,"row":0},{"column":200,"row":200}]','00000000-0000-4000-8000-000000000001');
  own_id := (result->>'claimId')::uuid;
  if jsonb_array_length(result->'conflicts') <> 1 then raise exception 'Overlap was not reported'; end if;
  if not exists (select 1 from public.map_claims where id=own_id and owner_id=auth.uid()) then raise exception 'Member spoofed project owner'; end if;
  if (select count(*) from public.map_claim_cells where claim_id=own_id) <> 1 then raise exception 'Overlap was saved'; end if;
  begin
    update public.map_claims set owner_id='00000000-0000-4000-8000-000000000001' where id=own_id;
    raise exception 'Member transferred project';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.map_claim_cells (claim_id,map_id,chunk_column,chunk_row)
    values (own_id,'00000000-0000-4000-8000-000000000010',256,0);
    raise exception 'Out-of-bounds cell accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.map_claim_cells (claim_id,map_id,chunk_column,chunk_row)
    values (own_id,'00000000-0000-4000-8000-000000000020',1,1);
    raise exception 'Cross-map cell accepted';
  exception when insufficient_privilege or foreign_key_violation then null; end;
  perform public.save_map_claim(own_id,'00000000-0000-4000-8000-000000000010','Updated project','OtherMember','','#d38d42',
    '[{"column":200,"row":200}]');
  delete from public.map_claims where id=own_id;
  if exists (select 1 from public.map_claim_cells where claim_id=own_id) then raise exception 'Project cells survived deletion'; end if;
  begin perform public.list_map_owners(); raise exception 'Member accessed account directory';
  exception when insufficient_privilege then null; end;
end;
$$;

reset role;
update public.profiles set must_change_password=true where id='00000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
do $$ begin
  begin
    perform public.save_map_claim(null,'00000000-0000-4000-8000-000000000010','Gated','MapMember','','#d38d42','[{"column":201,"row":201}]');
    raise exception 'Temporary-password account wrote project';
  exception when insufficient_privilege then null; end;
end; $$;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000099';
do $$ begin
  perform public.save_map_claim(md5('fixture-project-0')::uuid,'00000000-0000-4000-8000-000000000010',
    'Managed project','MapMember','','#d38d42','[{"column":0,"row":0}]','00000000-0000-4000-8000-000000000002');
  if not exists (select 1 from public.map_claims where id=md5('fixture-project-0')::uuid and owner_id='00000000-0000-4000-8000-000000000002')
    then raise exception 'Owner could not transfer project'; end if;
  perform public.list_map_claim_summaries('00000000-0000-4000-8000-000000000030');
  perform public.list_map_owners();
  delete from public.map_claims where id=md5('fixture-project-0')::uuid;
end; $$;
rollback;
