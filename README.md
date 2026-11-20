# Shelf Studio

Product photography and copy, organised in one workspace.

Shelf Studio helps small sellers turn a product photo and verified details into a new visual setting, a product description and a social caption. Original photos, generated assets and edited copy remain attached to the project.

## Features

- Three scene directions and square, portrait or landscape image formats.
- Private account projects alongside browser-only drafts.
- Original and generated image comparison.
- Editable product descriptions and social captions, with asset downloads.
- Saved generation history with dates, status and pagination.
- Responsive layouts for desktop, tablet and mobile.

## Stack

| Layer             | Technology                                          |
| ----------------- | --------------------------------------------------- |
| Application       | Next.js 16, React 19, TypeScript                    |
| Accounts and data | Supabase Auth, PostgreSQL, private Supabase Storage |
| Product copy      | OpenAI Responses API with structured output         |
| Image editing     | Replicate FLUX Kontext Pro                          |
| Styling           | CSS, DM Sans, Instrument Serif, Lucide icons        |
| Hosting           | Vercel                                              |

## Data and usage controls

Account projects and image folders enforce ownership independently. AI requests require a confirmed account and reserve usage in PostgreSQL before contacting either provider. The quota is three attempts per account and 20 across the studio per UTC day. Duplicate request keys reuse an existing attempt, and paid requests are not automatically retried.

Each generation uses a snapshot of the saved brief. Its original photo and result remain available after later project edits. Device drafts stay in the browser until explicitly saved to an account. Product facts are sent to OpenAI and source photos to Replicate only when generation is requested.

Generated product details and claims require review before publication. This is a portfolio application with controlled AI usage; it does not process payments.

## Project structure

- `src/app` — account screens and authenticated API routes.
- `src/components` — product workspace, asset editing and history.
- `src/lib` — project storage, provider clients and usage controls.
- `supabase` — database migrations and ownership policies.
- `tests` — isolated storage and generation contract tests.

## Validation

| Command                | Purpose                                          |
| ---------------------- | ------------------------------------------------ |
| `npm test`             | Storage, ownership, generation and history tests |
| `npm run lint`         | ESLint checks                                    |
| `npm run format:check` | Source formatting                                |
| `npm run build`        | Production build                                 |

Tests use mocked provider responses and do not spend API credits. Deployment configuration and operational limits are documented in [Deployment](docs/deployment.md).

## Credits

Reference scene photography: Unsplash. Reference images are labelled in the interface and are separate from generated results.
