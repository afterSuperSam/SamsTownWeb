# Supabase setup

1. Create a Supabase project.
2. Link the project and let the Supabase CLI apply every pending migration in
   filename order. Do not copy individual files into the SQL editor:

```bash
pnpm dlx supabase@2.109.1 db push --linked
pnpm dlx supabase@2.109.1 migration list --linked
pnpm dlx supabase@2.109.1 db lint --linked --level warning
```
3. Create the first user in Supabase Auth with email/password and metadata:

```json
{ "username": "DogSam" }
```

4. Promote that user once in the SQL editor:

```sql
update public.profiles
set role = 'owner'
where username = 'DogSam';
```

5. Copy `.env.example` to `.env.local` and set the project URL and anon key.
6. Put the service-role key only in the API server environment. Never expose it with a `VITE_` prefix.

Apply every migration in this directory in filename order. Use
`supabase migration list --linked` and `supabase db push --linked --dry-run`
to verify the deployed boundary instead of relying on a duplicated filename.
before using account, QQ registration, resource, Storage cleanup, map
management, or forum features in production.

The town map migration adds `town_maps`, `map_claims`, `map_claim_cells`, and
`map_markers`, enables Realtime for those tables, and creates the private
`town-maps` bucket. Map originals and generated WebP tiles are written only by
the trusted Fastify service-role client; authenticated browser clients receive
read access according to their profile role and map visibility.

For the complete Ubuntu deployment and migration workflow, see
[`../docs/DEPLOY_UBUNTU_24.md`](../docs/DEPLOY_UBUNTU_24.md).
