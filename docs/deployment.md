# Deployment

## Runtime

Next.js application with Node.js 24 and npm. The production build command is `npm run build`; the framework preset is Next.js. No custom output directory is required.

## Environment

| Variable                               | Scope              | Purpose                                                                                      |
| -------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Browser and server | Supabase project endpoint                                                                    |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser and server | Public project key; ownership policies protect data                                          |
| `SUPABASE_SECRET_KEY`                  | Server only        | Auth verification, generation reservations and private asset persistence                     |
| `OPENAI_API_KEY`                       | Server only        | Structured product copy                                                                      |
| `REPLICATE_API_TOKEN`                  | Server only        | Product image editing                                                                        |
| `AI_GENERATION_ENABLED`                | Server only        | `true` enables new paid attempts; `false` preserves browsing and editing of existing results |

Production values belong in Vercel's project environment settings. `.env.local` is ignored by Git. `.env.example` contains names and non-secret defaults only. Changes to Vercel environment variables take effect on the next deployment.

## Database

Migrations are ordered: `001_projects.sql`, then `002_generations.sql`. Both target the same Supabase project. Existing installations with both migrations applied need no additional SQL for the current release.

The `product-images` bucket is private, accepts JPEG, PNG and WebP, and enforces an 8 MB object limit. Project rows and image folders have ownership policies. The generation ledger permits owner reads and server-only writes.

## Authentication URLs

Supabase Authentication uses the production hostname as its Site URL. The production `/account` URL belongs in the redirect allowlist. Local development uses `http://localhost:3020/account`. Preview hostnames require their own approved redirects when account confirmation is tested there.

## AI operation

`AI_GENERATION_ENABLED=false` disables new paid generations without disabling saved assets. Provider spending controls are independent of application quotas. The application limits attempts, not currency expenditure.

The limits are three attempts per account and 20 shared attempts per UTC day, a 60-second cooldown and one active attempt per account. Failed and uncertain attempts count. OpenAI output is capped at 800 tokens; image predictions have a two-minute deadline. Status checks and history browsing do not create new generations.

## Release verification

The live smoke test covers sign-in and sign-out; private project saving and reopening; image and copy downloads; saved history; account isolation; anonymous API rejection; and desktop/mobile layouts. A live generation test consumes provider credits.

## Retention and public access

Original image versions and uploads from interrupted saves are retained to protect generation snapshots and concurrent edits. Storage cleanup and retention management are not automated. The ledger survives project deletion to preserve usage limits. The current version has no billing or customer credit purchases.

Public self-service use requires stronger signup abuse controls, storage quotas and a retention process. Application generation caps remain in place regardless of signup volume.
