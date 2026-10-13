-- 仅收紧明确的登录后／后台 RPC；公开地图与论坛读取 RPC 保持匿名可读。
revoke execute on function public.get_page_view_analytics(integer) from anon;
revoke execute on function public.list_map_owners() from anon;
revoke execute on function public.prune_operation_logs() from anon;
revoke execute on function public.queue_own_storage_cleanup(text, text) from anon;
revoke execute on function public.queue_town_image_deletion(uuid) from anon;
revoke execute on function public.replace_town_announcements(jsonb) from anon;
revoke execute on function public.replace_town_history(jsonb) from anon;
revoke execute on function public.update_own_username(text) from anon;
