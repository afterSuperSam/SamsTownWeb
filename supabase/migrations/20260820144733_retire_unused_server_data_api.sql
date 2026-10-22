-- The public MCC/server dashboard was removed. Keep the historical tables for
-- a future trusted Folia integration, but remove their unused Data API surface.
revoke all on table public.game_servers from anon, authenticated;
revoke all on table public.player_profiles from anon, authenticated;
revoke all on table public.server_metrics from anon, authenticated;
revoke all on table public.server_commands from anon, authenticated;
