-- Stored links remain inert even when a Member bypasses the browser importer.
alter table public.resources
  drop constraint if exists resources_url_http_protocol;
alter table public.resources
  add constraint resources_url_http_protocol
  check (url ~* '^https?://[^[:space:]]+$') not valid;

alter table public.resources
  drop constraint if exists resources_icon_url_https_protocol;
alter table public.resources
  add constraint resources_icon_url_https_protocol
  check (icon_url is null or icon_url ~* '^https://[^[:space:]]+$') not valid;
