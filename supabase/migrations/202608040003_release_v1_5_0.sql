-- v1.5.0 QQ-verified registration and account binding release --------------

-- This release marker follows the QQ identity and abuse-hardening migrations.
-- Keeping it as a migration gives deployments one authoritative database
-- boundary that matches the application version without rewriting history.
do $$
begin
  null;
end
$$;
