-- Hosted Supabase only: run AFTER all migrations, as the database owner.
-- No network requests, secret keys, extra users, or artwork deletion.
create extension if not exists pg_cron;
select cron.schedule('pixel-competition-timers', '* * * * *', 'select public.pixel_tick_due_events();');
-- A named job is updated rather than duplicated when this setup is rerun.
select jobname, schedule, active from cron.job where jobname = 'pixel-competition-timers';
