-- Run and commit before classic-extra.sql (Postgres enum additions need a commit).
alter type public.map_type add value if not exists 'extra';
