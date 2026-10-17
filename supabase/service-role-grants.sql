-- Run once in the Supabase SQL editor.
-- The secret key acts as `service_role`. It bypasses RLS but still needs table privileges,
-- and this project's default privileges do not hand them out — the same gap that made
-- fix-grants.sql necessary for anon/authenticated. The submit Edge Function writes
-- `submissions`; administrator changes go through root-checked database functions.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;

-- So the next table added does not repeat this.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
