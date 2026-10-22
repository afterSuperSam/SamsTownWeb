-- v1.6.0 security, consistency, and interaction hardening release ----------

-- The implementation lives in the preceding security-consistency migration.
-- This marker gives deployment checks one database boundary matching the app.
do $$
begin
  null;
end
$$;
