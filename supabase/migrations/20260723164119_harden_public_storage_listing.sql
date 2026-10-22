-- Public buckets serve known object URLs without a broad SELECT policy.
-- Removing these policies prevents anonymous clients from listing all files.
drop policy if exists "public downloads site images" on storage.objects;
drop policy if exists "public downloads schematics" on storage.objects;;
