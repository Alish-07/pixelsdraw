-- Run only AFTER the new frontend is deployed to production and uses
-- pixel_my_ballot. Until then the legacy frontend needs its own-ballot read.
-- No artwork, accounts or ballots are deleted.
revoke select on public.pixel_ballots from anon,authenticated;
notify pgrst,'reload schema';
