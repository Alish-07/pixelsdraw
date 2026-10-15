# PixelsDraw

A pixel-art and sprite editor with layers, animation and shared competitions.
Built with Next.js, React and Supabase.

## Features

- Custom rectangular canvases, zoom, grid and configurable backgrounds
- Pencil, eraser, fill, shapes, selection, dithering and transforms
- Layers with opacity, visibility, locking and drag reordering
- Animation frames, onion skin, playback and adjustable frame rate
- Undo/redo, keyboard shortcuts and automatic browser draft saving
- PNG, sprite-sheet and animated GIF export
- Hosted competitions with room codes, nicknames, admission controls and voting
- Recurring public challenges, audience voting and automatic deadlines
- Private artwork reports and reversible moderator review
- Responsive layout and light/dark appearance
- Animated Pixel Comet branding with a pause control and reduced-motion fallback

## Local development

Use Node.js 22 and npm. Dependencies are pinned in `package-lock.json`.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. The editor works without a Supabase connection;
accounts and competitions require the database setup below.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public browser publishable key |
| `NEXT_PUBLIC_SITE_URL` | Deployed HTTPS origin for metadata |
| `NEXT_PUBLIC_ALLOW_INDEXING` | Leave `false` during beta; explicitly opt in later |

These values are embedded in the browser bundle. Never put service-role keys,
SMTP passwords or OAuth secrets in `NEXT_PUBLIC_*` variables. Keep private
configuration in Supabase or the hosting provider, not in this repository.

## Database

For a **new** Supabase project, apply the SQL files in `supabase/migrations/` in
filename order, then run `supabase/schedule_competition_timers.sql`. For an existing
project, apply only migrations that have not already been installed. Migrations
are not a script to rerun on each deployment. The schedule script manages the
minute-based competition timer job.

Enable Google/email authentication and anonymous sign-ins for nickname-only hosted
rooms. Add the deployed `/events` and room-return URLs to the Supabase redirect
allowlist. Configure production SMTP before inviting users to email sign-in.
The local `/setup` guide provides detailed installation steps and SQL downloads;
it returns 404 in production.

Public challenges require confirmed accounts. Hosted-room participants can use
nicknames. Moderator membership is assigned separately by the database owner;
creating a room does not grant moderation access. Reporting is operational only
after its migration is installed and a reviewer is assigned.

## Checks

```sh
npm run lint
npm test
npm run test:database
npm run build
```

Database tests use disposable in-memory PostgreSQL through PGlite. They do not
need production credentials or change hosted data. GitHub Actions runs these
checks for pull requests and pushes to `main`.

## Deployment

GitHub stores the source and change history. Connect the repository to Vercel
for Next.js hosting, preview deployments and production releases. See
[deployment instructions](docs/deployment.md). The application is not configured
as a static GitHub Pages site.

## Project structure

```text
app/                    Routes, metadata and shared styles
components/             Editor, competition UI and account controls
lib/                    Drawing, storage, validation and competition utilities
supabase/migrations/    Ordered database migrations
tests/                  Helper tests and database regression suite
.github/workflows/      Continuous integration
docs/                   Deployment documentation
```

The standalone editor lives at `/`; competitions live at `/events`.
`components/PixelCanvas.js` manages the drawing document: frames contain layers,
and each layer owns a pixel array. Drawing helpers live in `lib/pixel-document.mjs`
and `lib/editor-lab.mjs`. History snapshots support undo/redo; IndexedDB saves
editable drafts, with localStorage as a fallback.

Drafts and preferences belong to the browser origin, not the signed-in account.
Export important work before clearing browser data or switching domains. Image
exports are flattened artwork, not editable project backups.
