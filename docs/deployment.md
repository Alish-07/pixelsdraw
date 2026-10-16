# Deploy from GitHub

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
email-link sign-in available only when separately enabled. No custom Supabase
auth-domain add-on is required.

### Email sign-in delivery

Email sign-in is off by default (`NEXT_PUBLIC_EMAIL_SIGN_IN_ENABLED=false`). The
built-in Supabase mailer is for testing: it is restricted to project-team email
addresses and currently allows only two messages per hour across the project.
Changing the UI resend cooldown does not remove that delivery restriction.

Before enabling public email sign-in:

1. Choose an email provider and verify the sender/domain it requires.
2. Configure its SMTP credentials in Supabase → Authentication → Emails → SMTP
   Settings, not in source code or `NEXT_PUBLIC_` variables.
3. Check Supabase's Auth email rate limits and the provider's own quotas. Keep
   appropriate abuse controls; custom SMTP is not unlimited delivery.
4. Test delivery to a non-team address and complete the link flow, including
   return-to-room URLs, spam-folder placement and disabled link tracking.
5. Set `NEXT_PUBLIC_EMAIL_SIGN_IN_ENABLED=true` for the verified environment and
   rebuild. Until then, the site clearly offers Google rather than a failing form.

See [Supabase's SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp).

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

Restore a previous READY Vercel deployment or revert a source commit. Do not drop
database tables or rerun earlier migrations as a deployment rollback. Verify
database compatibility before restoring an older frontend.
