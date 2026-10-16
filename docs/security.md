# Security and beta capacity controls

Reviewed October 16, 2026. This is a scoped code/configuration review, not a
penetration-test certification or a promise that denial-of-service is impossible.

## Rollout status

The security migration is applied to the hosted database. Live low-volume checks
confirm raw room reads are denied, GET RPCs return 405, and normal catalog/delta
POST requests still succeed. The account guard and API hook were also verified
in database catalogs. Vercel Bot Protection is published in Challenge mode, and a
published rule limits `/events*` or `/drawings*` requests to 120/minute/IP. Static
editor assets are excluded. Supabase auth email sending is set to 10/hour, with
the existing 60-second interval per recipient retained.

The frontend changes remain on the feature branch, not `main`. Final raw-ballot
revocation waits for that production frontend deployment. Turnstile token handling
covers Google, password login, signup, reset, resend and anonymous guest creation.
The Managed widget is restricted to the production and feature-preview hostnames;
its secret is stored only in Supabase and its public site key is configured in
Vercel. Enforcement remains off until the production frontend cutover. No
paid provider upgrade was purchased and no destructive data purge was performed.

Local widget checks used Cloudflare's official passing/failing test site keys:
concurrent Google/email widgets load, mode changes reset the widget, and failures
keep submission locked with a retry action. No real Auth requests were submitted
with test tokens. Test keys were removed from the temporary development config.
Supabase's Usage page still shows Free Plan, no quota exceeded, and no overage
billing (restrictions may apply instead). Vercel remains on Hobby with no payment
method or AI-credit auto-reload. Paid spending budgets and anomaly alerts are
unavailable on this plan; no paid upgrade was made to enable them. Existing email
and web notifications are enabled. These are verified settings, not a guarantee
that attacks cannot exhaust free allowances or interrupt service.

## Public repository and browser configuration

The Supabase project URL, publishable key and Google client ID are public client
configuration, not administrative credentials. Database authorization must remain
enforced by grants, RLS and checked RPC functions. Never publish an SMTP password,
OAuth client secret, Supabase secret/service-role key or database password.

The initial scan covered 214 historical Git blobs across all published branches;
no high-confidence secret signatures were found. `npm run test:secrets` scans
tracked files and available history in CI without printing credential values.
The scanner cannot prove that no unknown-format secret exists. Enable GitHub
secret scanning/push protection too. Local `.env*`, outputs and deployment/editor
configuration are ignored. Only `.env.example` is intentionally tracked.

## Deployment order

1. Apply `202610160001_security_budgets.sql` after the existing migrations. It
   stops raw room enumeration, adds quotas, restricts legacy RPC grants, and
   installs the PostgREST request hook. Existing hook configuration causes the
   migration to stop for review rather than overwrite another hook.
2. Deploy the frontend that uses `pixel_event_snapshot_delta` and
   `pixel_my_ballot`. Check voting, guest admission, Google/password login,
   hidden artwork and moderation. The preview uses the production database;
   it is not an isolated staging backend.
3. After the production frontend is updated, run
   `supabase/finish_security_cutover.sql` to revoke raw own-ballot reads. This is
   deliberately separate so the still-running old frontend is not broken first.
4. Check the live permission and budget tests, Security Advisor, CAPTCHA and
   provider-level spending/protection settings before a broad launch.

### Remaining release gate

Follow the Turnstile checklist in `docs/deployment.md` before merging this release.
Keep the server CAPTCHA switch off until the matching frontend has been deployed
and verified. Finish the real-widget check, deploy the matching frontend, enable
enforcement and verify token rejection/acceptance. Then finish the raw-ballot
permission cutover. Real signup/confirmation and device passkey enrollment need
owner testing; passkeys remain disabled for this release.

No migration deletes accounts, drawings, ballots or history. Existing large
artwork is preserved. New online competitions are capped at a 256-pixel side and
65,536 pixels across all frames. The personal editor's larger limits do not change.

## Server-side beta ceilings

Values are held in `pixel_private.pixel_security_limits`, accessible only to the
database owner. Changes require capacity review, not a browser toggle.

| Control | Initial ceiling |
| --- | --- |
| Room creation per account | 5/hour, 20/day, 10 unfinished rooms |
| Hosted room creation across the project | 100/day, 1,000 total |
| Scheduler-owned public round history | 10,000 rounds, then owner capacity review |
| New identities, including anonymous guests | 100/day, 1,000 total accounts |
| User-editable account metadata | 8 KiB when created/changed |
| Competition artwork | 65,536 pixels/entry, 1 MiB JSON/entry, 8 MiB/room |
| Total competition artwork | 128 MiB estimated uncompressed JSON |
| Participant / ballot / report rows | 20,000 / 20,000 / 5,000 |
| Competition RPC requests | 3,000/minute, 50,000/day project-wide |
| Competition RPCs per account / IP bucket | 120 / 1,200 per minute |
| Gallery/catalog/host-list transfer reservations | 128 MiB/day project-wide; 16 MiB/reader bucket/minute |

Counters use bounded hash slots and fixed windows, not one permanent row for
every attacker-supplied IP. Collisions can conservatively share a bucket. These
are safety ceilings: a determined attacker can exhaust a shared allowance and
temporarily block legitimate users. Raw forwarded IP headers are not trusted as
the only defense; project-wide and authenticated-identity checks remain in place.
Normal clients stop polling hidden tabs, back off after throttling, and reuse
unchanged artwork. Client behavior is an optimization, not an access control.

## What these limits do not solve

Every rejected request still reaches infrastructure and may consume some CPU,
connection time or response bandwidth. Database counters do not protect the Auth
HTTP service, Vercel traffic, non-PostgREST products or the network itself. Transfer
reservations are conservative artwork estimates, not a provider billing meter.
Moderation is available only to explicitly assigned moderators; it is not public.

Keep Supabase Auth rate limits enabled. With Brevo's daily allowance, use a
conservative project-wide email limit; registration and recovery can still be
targeted to exhaust it. Enable CAPTCHA with frontend token support before broad
anonymous/public signup. Do not enable the server CAPTCHA switch alone, which
would break the existing forms and nickname-only joining.

Vercel provides network DDoS protection, but it cannot protect the browser's
direct calls to `*.supabase.co`. Review Vercel Firewall and spending notifications,
keep production deployment protection settings appropriate, and monitor Supabase
database size/egress/MAU plus Brevo usage. A Cloudflare-registered domain by itself
does not proxy or protect either service. Free-plan ceilings can mean suspension
or unavailability rather than an unexpected charge; do not promise unlimited use.

The new frontend's CSP prevents framing, plugins and base-tag changes. It is not a full
nonce-based script CSP. Auth sessions and local artwork are stored by the browser;
another person with access to that browser/profile is not a separate security
boundary. Use separate browser profiles on shared computers.

## Recovery

If a legitimate beta reaches a ceiling, inspect usage before raising the specific
owner-only value. Do not disable RLS, re-grant raw tables, publish a service key,
or disable email verification. To recover an incompatible request-hook deployment,
restore the previously recorded `pgrst.db_pre_request` setting and notify PostgREST
to reload configuration; retain the table grants and data. Use source reverts or
Vercel rollback for frontend recovery, not destructive database resets.
