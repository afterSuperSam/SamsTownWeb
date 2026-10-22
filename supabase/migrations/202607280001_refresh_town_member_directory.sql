begin;

-- Replace the production roster atomically. The explicit WHERE keeps this
-- compatible with PostgREST's safe-delete guard used by hosted environments.
delete from public.town_members where id is not null;

insert into public.town_members
  (username, role_zh, role_en, variant, member_group, sort_order)
values
  ('Aresgao', '镇长', 'Mayor', 'leader', 'primary', 0),
  ('FSJhxm', '管理 · 建筑设计大师 · 视频剪辑师', 'Admin · Lead Architect · Video Editor', '', 'primary', 1),
  ('Muc_hun', '管理 · 建筑设计大师', 'Admin · Lead Architect', '', 'primary', 2),
  ('Nani0416', '管理 · 建筑 · 冒险', 'Admin · Builder · Explorer', '', 'primary', 3),
  ('DogSam', '工具人', 'Utility', '', 'primary', 4),
  ('bower_doge_', '元老 · 擅长公共交通建设', 'Veteran · Public Transit', '', 'primary', 5),
  ('Da_niyu', '元老 · 活跃于多个时期', 'Veteran · Multi-season Member', '', 'primary', 6),
  ('Kgmm_TianMing', '元老 · 活跃于多个时期', 'Veteran · Multi-season Member', '', 'primary', 7),
  ('TY_uil', '元老 · 多个时期的前期生电拓荒者', 'Veteran · Technical Pioneer', '', 'primary', 8),
  ('Tabularis', '元老 · 生电', 'Veteran · Tech', '', 'primary', 9),
  ('cyanider', '元老 · 建筑 · 生电', 'Veteran · Builder · Tech', '', 'primary', 10),
  ('Chengbaise', '生电 · 建筑', 'Tech · Builder', '', 'primary', 11),
  ('Ecirpib', '生电 · 生电设计', 'Tech · Technical Designer', '', 'primary', 12),
  ('budongputong', '生电 · CCT 季主力军', 'Tech · CCT Core Member', '', 'primary', 13),
  ('BuYHou', '生电 · TCC 季主力军', 'Tech · TCC Core Member', '', 'primary', 14),
  ('komeiji_xiaohei', '生电 · TCC 季主力军', 'Tech · TCC Core Member', '', 'primary', 15),
  ('tuotuo1', '生电 · TCC 季主力军', 'Tech · TCC Core Member', '', 'primary', 16),
  ('PaoTqTPao', '建筑 · 主城设计建筑师', 'Builder · Town Architect', '', 'primary', 17),
  ('jerryshu', '四人组 · 建筑', 'Four-person Team · Builder', '', 'primary', 18),
  ('Steve1219x', '四人组 · 建筑 · 后勤', 'Four-person Team · Builder · Logistics', '', 'primary', 19),
  ('yizhidayanwo', '建筑', 'Builder', '', 'primary', 20),
  ('AromaWhite', '建筑 · 尤其擅长建机场', 'Builder · Airport Specialist', '', 'primary', 21),
  ('EAwa55', '建筑', 'Builder', '', 'primary', 22),
  ('Echo_Zzz', '建筑', 'Builder', '', 'primary', 23),
  ('wochao416', '建筑', 'Builder', '', 'primary', 24);

insert into public.town_members
  (username, role_zh, role_en, variant, member_group, sort_order)
values
  ('zhui_mie', '曾任镇长', 'Former Mayor', '', 'town', 0),
  ('Gaocaigou', '建筑 · 生电 · 岛主', 'Builder · Tech · Island Owner', '', 'town', 1),
  ('moonfff', '生电 · 建筑', 'Tech · Builder', '', 'town', 2),
  ('Que_jing', '建筑 · 四人组', 'Builder · Four-person Team', '', 'town', 3),
  ('Necrne', '建筑 · 四人组', 'Builder · Four-person Team', '', 'town', 4),
  ('AM_am_AMM', '建筑', 'Builder', '', 'town', 5),
  ('An__hao', '建筑', 'Builder', '', 'town', 6),
  ('Anhao363', '建筑', 'Builder', '', 'town', 7),
  ('Aoliry', '建筑', 'Builder', '', 'town', 8),
  ('BusyMitten', '建筑', 'Builder', '', 'town', 9),
  ('Im_Bingyanyo', '建筑', 'Builder', '', 'town', 10),
  ('MIAONEI50', '建筑', 'Builder', '', 'town', 11),
  ('MoePunch', '建筑', 'Builder', '', 'town', 12),
  ('Mustard_E', '建筑', 'Builder', '', 'town', 13),
  ('pigbrain_', '建筑', 'Builder', '', 'town', 14),
  ('Sakura3697', '建筑', 'Builder', '', 'town', 15),
  ('Silk_Ghost', '建筑', 'Builder', '', 'town', 16),
  ('s_MKN_s', '建筑', 'Builder', '', 'town', 17),
  ('Zinc_10086', '建筑', 'Builder', '', 'town', 18),
  ('MagicYG7889', '生电', 'Tech', '', 'town', 19),
  ('s1mplewxz', '生电', 'Tech', '', 'town', 20),
  ('creep114514', '冒险', 'Explorer', '', 'town', 21),
  ('SigerLonzz', '冒险', 'Explorer', '', 'town', 22),
  ('Riitsu', '音乐', 'Music', '', 'town', 23);

-- Plain citizens share one role, so an ordered array keeps this migration
-- reviewable without repeating identical columns 88 times.
insert into public.town_members
  (username, role_zh, role_en, variant, member_group, sort_order)
select username, '镇民', 'Citizen', '', 'town', 23 + ordinality::integer
from unnest(array[
  '7jqn', 'An___hao', 'Aoshewn', 'awamao', 'bad_xinxin', 'baimei233',
  'Beginning buddha', 'Blessing_you', 'Cabbage Fani', 'Carrd_', 'ChalerXia',
  'Chen_vin', 'Cooner_beta_', 'cx9766', 'CY233466', 'DeepBreath',
  'Desert_robot', 'DT90', 'FengerCRK', 'Firework_133', 'fume_shroomm',
  'gan123426', 'Goerpore', 'Gravitation', 'greyraven_', 'gura117',
  'handhanslordloss', 'happybreadXD', 'HeiRokuSen', 'hsszl', 'ICE_LuoChen',
  'imyinthe', 'ioubouk', 'JMjunmumu', 'Kamikilodd', 'Kazzuha_', 'LANCHEYA',
  'Lantern7', 'Legendary_CR', 'littlekan123', 'Loyeve_Yseagz', 'LV100Player_',
  'lyzx_zg', 'M9AS_EDD', 'MasQ', 'menghaoran', 'MinYunTL', 'Minnouki',
  'Mo_XuCang', 'MoFa_ovo', 'MrSakamoto', 'NanoTurtle', 'Novscorpio_115',
  'Nz_wdnmd', 'OwlForest_', 'Oym_mahiro', 'pandemik3', 'Sakura_Dream',
  'shakdi_if0307', 'shu_hei', 'Sn0r1axx', 'SoaploveMOMO', 'steamedgreysha...',
  'StreacBuc', 'Sulcee', 'Sunshine', 'Sugarcane', 'SUZULAN521', 'TACMAX',
  'Tg4h', 'TheCrosszZhe', 'thurs', 'touchfeeling', 'traisficsion', 'Tur1n_-',
  'XGMTS', 'XiaTianIN', 'XiaoX1un', 'xihao', 'XinMengTian', 'xitianya',
  'xzfdx', 'XuYanZ', 'YANG0203LL', 'yoyo_XiaoKa', 'Zdyyjx2333',
  'ZHANGWW64', 'Zhoukaile'
]) with ordinality as citizens(username, ordinality);

insert into public.town_members
  (username, role_zh, role_en, variant, member_group, sort_order)
values
  ('Jangyi_gniklaw', '极光镇镇长', 'Aurora Town Mayor', 'friend', 'friend', 0),
  ('Metalkey', '极光镇 · 万物共产创始人', 'Aurora Town · Commons Founder', 'friend', 'friend', 1),
  ('AnnieMIRU', '极光镇酒吧老板', 'Aurora Town Bar Owner', 'friend', 'friend', 2),
  ('233_WUHU', '极光镇好友', 'Aurora Town Friend', 'friend', 'friend', 3),
  ('BeiTree106', '极光镇好友', 'Aurora Town Friend', 'friend', 'friend', 4),
  ('CrisTiAmo', '极光镇好友', 'Aurora Town Friend', 'friend', 'friend', 5),
  ('dixieluixing', '极光镇好友 · 假期解放中', 'Aurora Town Friend · On Holiday', 'friend', 'friend', 6),
  ('embmaster_', '极光镇好友', 'Aurora Town Friend', 'friend', 'friend', 7),
  ('ICEEEEECREAM01', '极光镇好友', 'Aurora Town Friend', 'friend', 'friend', 8),
  ('jian_dan_mao', '极光镇好友', 'Aurora Town Friend', 'friend', 'friend', 9),
  ('KanadeRuby', '极光镇好友', 'Aurora Town Friend', 'friend', 'friend', 10),
  ('Mu_xii', '极光镇好友', 'Aurora Town Friend', 'friend', 'friend', 11),
  ('nabeack', '极光镇好友', 'Aurora Town Friend', 'friend', 'friend', 12),
  ('Potatolized', '极光镇好友', 'Aurora Town Friend', 'friend', 'friend', 13),
  ('TheZeroFour', '极光镇好友', 'Aurora Town Friend', 'friend', 'friend', 14),
  ('Zero_IVX', '极光镇好友', 'Aurora Town Friend', 'friend', 'friend', 15),
  ('Acksugar', '桃镇好友', 'Peach Town Friend', 'friend', 'friend', 16),
  ('Arthur', '桃镇好友', 'Peach Town Friend', 'friend', 'friend', 17),
  ('fishGeax', '桃镇好友', 'Peach Town Friend', 'friend', 'friend', 18),
  ('DevilCloudVN', '怀民亦未寝', 'Huaimin Community', 'friend', 'friend', 19),
  ('K5_sama', '怀民亦未寝', 'Huaimin Community', 'friend', 'friend', 20),
  ('HuaweiZZZ', '霍格沃兹', 'Hogwarts', 'friend', 'friend', 21);

do $$
begin
  if (select count(*) from public.town_members) <> 159 then
    raise exception 'Town member roster count mismatch';
  end if;
  if exists (select 1 from public.town_members where role_zh like '%红石%') then
    raise exception 'Legacy redstone label remains in town member roster';
  end if;
end;
$$;

commit;
