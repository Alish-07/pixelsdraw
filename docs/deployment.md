# Deploy from GitHub

## Current beta address

The beta uses `https://pixelsdraw.alishpandey.com` on the existing Vercel project.
Cloudflare holds a DNS-only CNAME for `pixelsdraw` pointing to the target supplied
by Vercel. The apex `alishpandey.com`, `www`, nameservers and email records are not
changed by this setup. There is no `/pixelsdraw` redirect on the personal-site root.

Production sets `NEXT_PUBLIC_SITE_URL=https://pixelsdraw.alishpandey.com`. Keep the
old Vercel address and its auth allowlist entries while shared links still use it.
Google's existing web client allows the exact new HTTPS origin; Supabase allows
`https://pixelsdraw.alishpandey.com/**` and uses the new origin as Site URL.
The existing Turnstile widget also allows the new hostname. Do not rotate keys
or create another database merely to add a domain.

Browser drafts, saved drawings and sessions are origin-specific: they do not move
from the Vercel address automatically. Export important work from the old address
before clearing browser data. Competition data stays in the existing database.

## Publish the repository

Create an empty GitHub repository named `pixelsdraw`. Start private while reviewing
the beta and repository contents. Do not initialize a second README or commit local
environment files. From the project directory:

```sh
git status
git diff --cached --check
git commit -m "Initial application source"
git remote add origin <YOUR_GITHUB_REPOSITORY_URL>
git push -u origin main
```

Set your Git commit identity if Git asks for it. Use your GitHub-provided noreply
address if you do not want your personal email recorded in commits. Do not paste
access tokens into remote URLs or source files.

## Connect Vercel

In the **existing** Vercel project's Settings → Git, connect this repository.
Use the Next.js framework preset, the repository root, Node.js 22 and `npm run build`.
Keep the default output-directory setting; `next.config.mjs` uses `.next` on Vercel.
Do not create another Supabase database or replace existing project environment
values just to connect GitHub. No Vercel deployment token is needed in the workflow.

Set the public environment variables from `.env.example` in Vercel. Give preview
deployments a separate test Supabase project if they will write data. Forked pull
requests must not receive privileged credentials. Keep deployment protection on.

Push a feature branch and inspect its preview first. The provided GitHub workflow
checks lint, helper tests, database regressions and the production build without
production secrets. GitHub CI does not automatically apply hosted SQL migrations.
Require successful checks before merging; review any unapplied migrations before
the frontend release. Connecting the Git integration does not itself enforce a
CI gate, so configure branch/release protection deliberately.

Pushes/merges to the Vercel production branch (`main`) can update the live site.
Before enabling this, confirm the production database is compatible with the
release. In particular, install the moderation migration and assign an explicitly
approved, confirmed reviewer before exposing a live reporting workflow.

[Vercel's GitHub integration](https://vercel.com/docs/git/vercel-for-github)
describes repository connection, previews and production-branch deployments.

## Domain and authentication

### Direct Google sign-in

The account panels use Google Identity Services' official button in popup mode,
then exchange its ID token with `supabase.auth.signInWithIdToken`. Supabase still
verifies identities and manages sessions; database ownership and RLS are unchanged.
Keep the existing Google web client registered with the existing Supabase provider.
Do not generate a replacement client or disable nonce verification.

Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in the deployment environment before building.
It is a public OAuth client ID, not a client secret. The Google client secret must
remain in Supabase, never in a `NEXT_PUBLIC_` variable or application source.
In Google Cloud → Google Auth Platform → Clients, add the exact website origin to
Authorized JavaScript origins (no paths or wildcards). Local testing uses
`http://localhost:3000`; production uses the deployed HTTPS origin. A future domain
needs its own exact origin. Preserve the existing Supabase redirect URI for other
OAuth clients/flows. Google's brand verification and browser UI determine the
displayed application name or domain; the app cannot set the account chooser text.

Test an existing Google account, a guest-to-Google switch, a cancelled popup,
blocked Google scripts, and return to `/events?host=1` before release. Without the
client ID or Google script, the app offers a clear unavailable state and keeps
email/password login available. No custom Supabase auth-domain add-on is required.

### Email sign-in delivery

Email signup, confirmation resends and password recovery are off by default
(`NEXT_PUBLIC_EMAIL_SIGN_IN_ENABLED=false`). Existing password accounts can still
log in without sending email. The
built-in Supabase mailer is for testing: it is restricted to project-team email
addresses and currently allows only two messages per hour across the project.
Changing the UI resend cooldown does not remove that delivery restriction.

Before enabling public email sign-in:

1. Choose an email provider and verify the sender/domain it requires.
2. Configure its SMTP credentials in Supabase → Authentication → Emails → SMTP
   Settings, not in source code or `NEXT_PUBLIC_` variables.
3. Check Supabase's Auth email rate limits and the provider's own quotas. Keep
   appropriate abuse controls; custom SMTP is not unlimited delivery.
4. Leave Confirm email enabled in the Supabase email provider settings. Test
   registration, confirmation, password login, confirmation resends and reset
   delivery to a non-team address. The reset destination is
   `/account/reset-password`; preserve its safe `next` room destination. Existing
   allowed-origin `/**` entries cover this path. Check spam placement and disable
   link tracking. Never log passwords, tokens or emailed link URLs.
5. Set `NEXT_PUBLIC_EMAIL_SIGN_IN_ENABLED=true` for the verified environment and
   rebuild. Until then, Google and existing password logins work, while email
   signup/recovery actions are visibly unavailable. This UI flag is a rollout
   switch, not a substitute for server-side abuse protection or rate limits.

The frontend requests at least 12 characters for new passwords. Configure matching
password strength rules in Supabase before public signup; backend rules remain
authoritative. Never disable email confirmation to make a delivery test pass.
Credential creation and password-change tests must be completed by the user; do
not fill real passwords on their behalf. Mock tests exercise SDK requests without
creating accounts or sending live email.

See [Supabase's SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp).

### CAPTCHA rollout (Cloudflare Turnstile)

Supabase validates Turnstile tokens server-side; a widget alone does not protect
its public Auth API. Follow this order to avoid breaking sign-in and guest joins:

1. In Cloudflare Turnstile, create a Managed widget restricted to the exact
   production and feature-preview hostnames. Add `localhost` only if testing there.
   The domain does not need to be proxied through Cloudflare. The account owner
   should handle the new secret key directly, not paste it in chat or source.
2. Put the **public site key** in `NEXT_PUBLIC_TURNSTILE_SITE_KEY` for Preview and
   Production. Never put the secret in a public environment variable. Set the
   matching secret directly in Supabase's CAPTCHA settings, initially leaving
   enforcement off. Deploy the feature preview with its site key.
3. Check widget loading, expiry, retry, blocked-script messaging, and switching
   email forms. Tokens are single-use: the form remounts its widget after each
   attempt. Google ID-token sign-in and guest account creation also pass tokens.
   Existing anonymous sessions can join another room without creating an account.
4. Deploy the prepared frontend to Production before enabling Supabase CAPTCHA
   enforcement. The production database is shared with preview: enabling it while
   the old frontend is live would break old sign-in forms. Coordinate this short
   cutover, then test Google, password login, new signup/confirmation, reset/resend
   and a signed-out nickname-only join. The user completes real credentials and
   any challenge personally. Never use Cloudflare test keys in production.
5. Confirm direct Auth requests without valid tokens fail. Retain Auth rate limits
   and database budgets: CAPTCHA is additional friction, not a DDoS guarantee.
   If the cutover fails, disable CAPTCHA enforcement before rolling back to a
   frontend that does not send tokens.

See [Supabase CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha) and
[Turnstile rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/).

### Usage and spending review

Before release, check the current plan and billing/usage pages in Vercel and
Supabase and verify notification recipients. Enable supported spending/usage
alerts and retain any free-plan/spend caps; do not upgrade or remove caps just
to enable an alert. Check database size, egress, active users and function/edge
traffic, plus Brevo's daily email usage. Document controls that the current plan
does not offer instead of claiming a guaranteed billing ceiling. Database request
budgets and the WAF do not meter every provider product or rejected request.

### Passkey preparation and testing

Passkeys use the pinned SDK's `auth.signInWithPasskey`, `auth.registerPasskey` and
`auth.passkey` management methods. Supabase currently documents this support as
experimental. Keep Google available as a backup and retain the existing backend
authorization rules. No private keys, PINs or biometric data are stored by this app.

The UI is off by default (`NEXT_PUBLIC_PASSKEYS_ENABLED=false`). To test it:

1. In Supabase Authentication → Passkeys, configure the display name `PixelsDraw`,
   a stable RP ID and exact HTTPS origins. Do not use `vercel.app` as an RP ID.
   Testing on the current site uses `pixel-art-studio-alpha-one.vercel.app` as the
   RP ID and `https://pixel-art-studio-alpha-one.vercel.app` as its origin.
2. Set `NEXT_PUBLIC_PASSKEY_RP_ID` to that same RP ID and enable
   `NEXT_PUBLIC_PASSKEYS_ENABLED=true` only on the environment being tested.
   Localhost needs an isolated backend configured with RP ID `localhost`; do not
   change the production project's RP ID just to make a localhost test pass.
3. Sign in to an existing confirmed account with Google. The user must personally
   choose Add a passkey and complete their device/password-manager prompt. Test
   cancellation, a successful login, sign out and a second passkey login. Never
   create, export, or delete the user's real credentials through automation.
4. Test another browser/device and unsupported-browser messages. Removing a
   passkey requires an explicit in-app confirmation and a remaining backup method.

Passkeys are domain-bound. Moving to the eventual custom domain requires new
enrollments; Vercel test credentials cannot silently migrate. Keep enrollment
limited to testing until that domain decision is final. A general release requires
the real device ceremony and backend configuration checks, not only mock tests.

See [Supabase's passkey guide](https://supabase.com/docs/guides/auth/passkeys).

### Competition lobby and six-hour schedule release

Apply `supabase/migrations/202610150001_six_hour_challenges.sql` to the test database
first. It changes the long-form lane to six hours of drawing plus 30 minutes of
voting. The stable `daily` database key is retained for existing links and history.
Already-running daily rounds finish on their original deadlines before the new
schedule takes over; no artwork or ballots are deleted.

Before merging this release to `main`, apply the reviewed migration to the hosted
database and verify a new long-form round's stored durations are 21600 and 1800
seconds. Exercise `/events` → Host competition → Google/email sign-in → room setup
→ dashboard on a configured test deployment. Sign-in must return to
`/events?host=1`. Check the admin-only Moderation section with a confirmed reviewer
and verify regular accounts cannot read the report queue. A preview without
Supabase variables can verify layout but cannot complete these account/room checks.

### Custom hostname

Once purchased, add the exact hostname in Vercel's Domains settings and copy the
DNS records it provides into Cloudflare. Preserve unrelated DNS/email records.
Set `NEXT_PUBLIC_SITE_URL` to the final HTTPS origin and redeploy. Keep
`NEXT_PUBLIC_ALLOW_INDEXING=false` until the beta launch checks are complete.

Update Supabase's Site URL and allowed sign-in return URLs for the new domain.
Add the new website origin to Google's Authorized JavaScript origins. Preserve
the existing Supabase OAuth callback rather than replacing it with the website
hostname. Verify Google/email sign-in and return-to-room flows
on the final origin. Configure production email delivery and publish the operator's
actual support, privacy and community-policy information before a wider launch.

Adding a domain does not move browser-local drafts or sessions. Keep the old origin
available and export important drawings before switching.

## Rollback

For the October 16 security release, follow [the security rollout order](security.md)
before merging: database budgets first, new frontend second, raw-ballot grant
cutover last. The old production frontend still needs its own-ballot table read.

Restore a previous READY Vercel deployment or revert a source commit. Do not drop
database tables or rerun earlier migrations as a deployment rollback. Verify
database compatibility before restoring an older frontend.
