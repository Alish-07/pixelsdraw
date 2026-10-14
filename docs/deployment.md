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

Once purchased, add the exact hostname in Vercel's Domains settings and copy the
DNS records it provides into Cloudflare. Preserve unrelated DNS/email records.
Set `NEXT_PUBLIC_SITE_URL` to the final HTTPS origin and redeploy. Keep
`NEXT_PUBLIC_ALLOW_INDEXING=false` until the beta launch checks are complete.

Update Supabase's Site URL and allowed sign-in return URLs for the new domain.
Google's OAuth callback stays on the same Supabase project; do not replace it
with the website hostname. Verify Google/email sign-in and return-to-room flows
on the final origin. Configure production email delivery and publish the operator's
actual support, privacy and community-policy information before a wider launch.

Adding a domain does not move browser-local drafts or sessions. Keep the old origin
available and export important drawings before switching.

## Rollback

Restore a previous READY Vercel deployment or revert a source commit. Do not drop
database tables or rerun earlier migrations as a deployment rollback. Verify
database compatibility before restoring an older frontend.
