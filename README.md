# Reelindo

Reelindo is a React Native + Expo social video app. This repository currently contains **Phases 1-11**: project foundation, authentication, mobile shell, feed/uploads, post creation, social/profile/explore, ephemeral stories, chat/notifications, safety/analytics/settings/accessibility, Phase 10 performance and QA, and Phase 11 deployment preparation.

## Requirements

- Node.js 22.13 or newer (SDK 58 minimum)
- pnpm 10 (`corepack enable` then `corepack prepare pnpm@10.18.0 --activate`)
- Docker Desktop with Compose

## Run the complete app locally

Follow these steps from the repository root in PowerShell. You will run PostgreSQL and Redis in Docker, the API and background worker in separate terminals, and the Expo app on a simulator, emulator, or device.

### 1. Install the prerequisites

- Install Node.js 22.13 or newer and Docker Desktop, then start Docker Desktop.
- Enable the repository's pinned pnpm version:

```powershell
corepack enable
corepack prepare pnpm@10.18.0 --activate
node --version
pnpm --version
```

`node --version` should show v22.13 or newer and `pnpm --version` should show 10.18.0.

### 2. Install project packages

In the project root (`C:\Users\amita\myprojects\reelindo`):

```powershell
pnpm install
```

### 3. Configure local environment files

Copy the example file for Docker Compose, then create app-specific files. Do not commit files containing real secrets.

```powershell
Copy-Item .env.example .env
Copy-Item .env.example apps/api/.env
Set-Content apps/mobile/.env 'EXPO_PUBLIC_API_URL=http://10.0.2.2:4000'
```

In `apps/api/.env`, keep the local database and Redis URLs from the example. Replace `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` with different random values of at least 32 characters. For example, generate a value with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

The API and mobile `.env` files are loaded from their own app folders. The root `.env` provides the database and local storage settings to Compose. PostgreSQL uses host port `5433` to avoid conflicts with another local PostgreSQL container; keep the matching URL in `apps/api/.env`. For a physical phone, set `LAN_HOST` in the root `.env` to the computer's Wi-Fi IPv4 address and use that same address for `EXPO_PUBLIC_API_URL` and `S3_ENDPOINT`/`S3_PUBLIC_BASE_URL` in `apps/api/.env`.

### 4. Start PostgreSQL, Redis, media storage, and the video worker

```powershell
docker compose up -d --build
docker compose ps
```

Wait until PostgreSQL, Redis, the media-storage gateway, and the video worker are running. PostgreSQL uses host port 5433, Redis uses 6379, and the S3-compatible SeaweedFS gateway exposes port 9000. The API creates the `reelindo` bucket when the first upload URL is requested. Public media reads are enabled for local development; uploads still require short-lived signed URLs from the authenticated API. The local development credentials in `docker/seaweed-s3.json` must never be reused in production.

### 5. Prepare the database (first run only)

Generate the Prisma client:

```powershell
pnpm db:generate
```

This checkout includes the initial schema migration, feed recommendation changes, story styling/music fields, and post/story upload tracking. Apply all migrations to a fresh local database or an existing development database with:

```powershell
pnpm db:migrate:deploy
```

For schema changes during development, use `pnpm db:migrate` to create and apply a new migration.

If posts or stories fail after an upload, check `/ready`, API logs, the database migration status, S3 endpoint/bucket credentials, and (for Reels) `docker compose logs -f video-worker`. A successfully uploaded file is not a published post/story until the API confirms the database record. The owner profile shows processing/failed Reels and provides retry/delete actions. Deleting a post removes its database row and related records; if object storage is temporarily unavailable, the API reports that media cleanup still needs attention.

### 6. Add sample content (optional)

```powershell
pnpm db:seed
```

This adds development users, posts, hashtags, interests, and sounds for browsing. Create your own account from the app's sign-up screen to test authenticated actions.

### 7. Start the API

Open a terminal at the repository root and run:

```powershell
pnpm dev:api
```

When it starts, check `http://localhost:4000/health` for liveness, `http://localhost:4000/ready` for database/Redis readiness, or `http://localhost:4000/docs` for the API reference.

### 8. Video uploads and processing

The local Compose stack provides SeaweedFS S3-compatible storage and an FFmpeg/ffprobe worker, so no separate S3 account or host FFmpeg installation is needed for local development. Set `S3_ENDPOINT=http://<LAN_HOST>:9000`, `S3_REGION=us-east-1`, `S3_BUCKET=reelindo`, `S3_ACCESS_KEY_ID=reelindo-local`, `S3_SECRET_ACCESS_KEY=reelindo-local-password`, and `S3_PUBLIC_BASE_URL=http://<LAN_HOST>:9000/reelindo` in `apps/api/.env`. The API's S3 endpoint and public media URL must use the Wi-Fi IPv4 address when uploads are from a physical phone. If that address changes, update `LAN_HOST` in the root `.env` and the matching S3 URLs in `apps/api/.env`, then restart Compose and the API. For production, replace SeaweedFS with a private S3/R2 bucket and a stable CDN URL.

Photo posts are saved directly. Reels are stored, queued, and kept in `PROCESSING` until the worker finishes HLS transcoding; worker logs are available with `docker compose logs -f video-worker`. Failed Reels remain in the owner's profile and can be retried there. The original storage key is recorded in the database so retry and deletion do not depend on the processed video URL.

### 9. Start the Expo app

Open a third terminal at the root and run:

```powershell
pnpm dev:mobile
```

Scan the Expo QR code with Expo Go or open the app in an installed simulator/emulator. Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to match the device:

- iOS simulator: `http://localhost:4000`
- Android emulator: `http://10.0.2.2:4000`
- Physical phone: `http://<your-computer-Wi-Fi-IPv4>:4000` (phone and computer must share Wi-Fi; get the IPv4 with `ipconfig`)

The API and Compose services must be running at the same time. Windows Firewall must allow inbound TCP ports 4000 (API) and 9000 (media) for a physical phone. If needed, open PowerShell as Administrator and add rules limited to your Wi-Fi subnet (replace the example subnet with the one shown by `ipconfig`):

```powershell
New-NetFirewallRule -DisplayName "Reelindo local API (Wi-Fi only)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4000 -RemoteAddress 192.168.31.0/24 -Profile Any
New-NetFirewallRule -DisplayName "Reelindo local media (Wi-Fi only)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 9000 -RemoteAddress 192.168.31.0/24 -Profile Any
```

From the phone, open `http://<your-computer-Wi-Fi-IPv4>:4000/health` to test connectivity. Restart Expo after changing this variable. Expo Go is suitable for browsing the UI and early flows; notification registration is intentionally skipped there because Expo Go does not include the native notification modules required by this SDK.

### 10. Stop local services

Press `Ctrl+C` in each terminal running the API, worker, or Expo. Stop the database containers from the repository root with:

```powershell
docker compose down
```

This leaves the named database and media volumes in place, so your accounts and uploaded media remain for the next run.

## Database

Prisma schema, migrations, and seed source are kept together in the top-level `database/` folder. `pnpm db:migrate` creates a local development migration and applies it; `pnpm db:seed` creates 50 demo users, 200 sample posts, starter hashtags, topic interests, and sounds. The media URLs are public sample/placeholder sources and should be replaced with cleared, stable assets before production.

## Project layout

```text
apps/mobile/       Expo Router app
apps/api/          Fastify API and workers
database/          Prisma schema, migrations, and seed data
docker-compose.yml PostgreSQL and Redis for local development
```

## Phase 2 auth routes

- `POST /auth/register` — email, username, display name, password, birth date (16+ enforced)
- `POST /auth/login` — email and password
- `POST /auth/refresh` — rotates a 30-day refresh token and issues a 15-minute access token
- `POST /auth/logout` — revokes the supplied refresh token
- `POST /auth/logout-all` — revokes all sessions for the authenticated account
- `POST /auth/forgot` and `POST /auth/reset` — password reset with a one-time, expiring token
- `GET /users/me` — authenticated current-user lookup

OpenAPI docs are served at `/docs`. Password reset requests use a development-only token written to API logs because no email delivery provider has been configured yet. Camera/video native modules are not installed; Expo Go works for the auth UI. Camera, advanced video, and native integrations will require an EAS development build.

## Phase 3 mobile shell

The Expo app now has a first-launch three-slide onboarding flow, a five-tab shell (Home, Explore, Create, Inbox, Profile), theme tokens and a system/light/dark preference selector, plus reusable Button, IconButton, Avatar, Input, Screen, and EmptyState components. Tabs other than Profile are visual navigation shells pending later feature phases.

## Phase 4 feed and uploads

Authenticated API routes now include `POST /posts/upload-url`, `POST /posts`, `GET /posts/feed/foryou`, `GET /posts/feed/following`, `GET /posts/:id`, like/unlike, save/unsave, share link, and view event recording. Feed pages use timestamp cursors and check current privacy, block, and moderation state on each request. The mobile Home tab uses FlashList vertical paging, active video playback, optimistic likes/saves, haptics on double tap, and native share UI.

Configure the R2/S3 values in `.env` and set `S3_PUBLIC_BASE_URL` to a stable bucket CDN origin; publishing is rejected without it because signed URLs expire. Install FFmpeg and ffprobe on the API/worker host. Run the API with `pnpm dev:api` and the transcoder separately with `pnpm --filter @reelindo/api worker:video`. The worker creates 360p/720p HLS, a thumbnail, and a three-second preview. Posts stay in `PROCESSING` until ready. Storage and worker need valid shared S3 credentials and network access to uploaded objects.

## Phase 5 create flow

The Create tab supports camera/gallery import, photo and video capture, preview, a seconds-based trim range, optional custom cover upload, caption, visibility, comments, local draft persistence, upload progress, and retry. The backend create service and validation live in `apps/api/src/modules/create/`; uploads are checked in storage before a post is saved. Photos are ready immediately; videos enter the processing queue and the worker applies the trim before generating HLS, preview, and thumbnail. Database schema, migration history, and seed files are maintained separately under `database/`. Native camera and media permissions require an EAS development build after config changes.

Local drafts keep the selected file URI in SecureStore metadata. Some operating systems may clear temporary camera or picker files after a restart; if that happens, reselect the media and save the draft again. Trim is entered in seconds. A full timeline editor with music, stickers, speed curves, and filters remains future work.

For native camera use, configure the permissions in `apps/mobile/app.json`, then build and install a development client with `eas build --profile development --platform android` or `eas build --profile development --platform ios`. Expo Go is suitable for trying gallery selection and screens, but permission/plugin updates and camera recording should be checked in the development build. The app uploads directly to S3/R2; configure the bucket CORS policy to allow `PUT` from the app origin/device and expose the configured CDN for stable public media URLs.

## Phase 6 social, profiles, and explore

Social API routes are organized in `apps/api/src/modules/social/routes.ts`. They provide profile read/edit, follower/following lists, follow/unfollow with private-account requests, profile posts, nested comments and replies, comment likes, owner comment pinning, delete-own-comment, search across accounts/videos/hashtags/sounds, trending topics, hashtag pages, and sound pages. Post and comment reads honor public/followers/private visibility and block relationships. Caption and comment mentions create mention records and notifications; captions index hashtags. The mobile app now has edit/view profile screens, post grids, comments/reply UI, Explore search and trending rows, hashtag and sound pages, and a working “Use this sound” handoff to Create.

Search currently uses PostgreSQL case-insensitive substring matching. Trigram/full-text indexes and ranking improvements can be added after the initial migrations have been generated for the separate `database/` schema.

## Phase 7 stories

Stories use the existing `Story` and `StoryView` models, extended with audience and overlay fields, plus a `CloseFriend` relationship. Authenticated endpoints support signed story uploads (100 MB maximum), 24-hour expiry, follower and Close Friends audiences, view tracking, owner viewer lists, and deleting your own stories. The viewer enforces audience, privacy, and block rules. Expired stories are filtered from reads immediately; a database cleanup job can later reclaim expired rows and object storage files. Story files are kept under `uploads/<user-id>/stories/` and require the same S3/R2 bucket plus stable `S3_PUBLIC_BASE_URL` as post uploads.

The Home feed shows the story tray; “Your story” opens the composer or your active story, and creator bubbles open a timed photo/video viewer with pause, swipe navigation, replies, and reactions. Story creation supports gallery or camera capture, editable text, positioned emoji stickers, freehand drawing, warm/cool/dream color treatments, and searchable/trending music. Story audiences can be selected as followers or Close Friends; manage that list in Settings. The additive story audience/overlay migration must be applied with `pnpm db:migrate:deploy` (or `pnpm db:migrate` during development), and the Prisma client regenerated with `pnpm db:generate` before starting the updated API. Native media access should be checked in an EAS development build.

## Phase 8 chat and notifications

The Inbox has Activity and Messages tabs backed by authenticated notification and conversation APIs. One-to-one chats support starting a conversation from a creator profile, text messages, sharing public posts, message read receipts, typing indicators, and authenticated Socket.IO events. Activity covers likes, comments, follows, mentions, and messages. Device tokens register with the API, which sends Expo push notifications for these activity types and removes tokens Expo reports as invalid. Push permission/token registration requires an EAS project and physical device. Image attachments, online presence, and a distributed Socket.IO adapter for multi-instance deployments remain future work.

## Phase 9 safety, analytics, settings, and accessibility

Safety endpoints now accept reports for accounts/posts/comments/stories, let users block or unblock accounts, expose the blocked list, and provide admin-only report triage with dismiss/review, post/comment/story removal, and account bans. Comments use a basic abusive-word filter (`BANNED_WORDS` adds comma-separated terms). Post and story media can use a configurable moderation HTTP endpoint; it receives `POST { "mediaUrl": "..." }` with optional bearer `MODERATION_API_KEY` and must return `{ "safe": true|false }`. If configured moderation is unavailable, publishing fails closed. This is an integration hook, not a built-in image/video classifier.

Creator analytics report 7/28-day views, watch time, completion, likes, comments, and follower gains. Settings include privacy, theme, English/Hindi selection, push preferences, blocked accounts, creator analytics, JSON data export, draft Terms/Privacy/Community pages, and password-confirmed account deletion; deletion also removes uploaded and processed S3/R2 media when storage is configured. Core form controls have accessibility labels and native text scaling remains enabled. The translation dictionary currently covers settings and analytics; broader screen-by-screen localization and a full admin dashboard remain future work.

Phase 9 adds `NotificationPreference` to the Prisma schema. After installing dependencies and starting PostgreSQL, run `pnpm db:generate` and `pnpm db:migrate` before starting the API. Configure `BANNED_WORDS` and, if using a provider, `MODERATION_API_URL` / `MODERATION_API_KEY` in `.env`.

## Phase 10 performance and QA

The Home feed uses an Instagram-style post stream with a story tray, creator headers, image/video media, captions, and like/comment/share/save actions. Feed requests refresh when Home regains focus; the For You candidate pool includes recent public posts as well as popular, followed, and personalized posts. Only ready public posts are eligible for discovery, and private/follower-only visibility still applies. Session and preference restore failures fall back to a usable signed-out/default state rather than leaving the launch route blank. FlashList keeps video players limited to visible cards. Backend moderation and the mobile Screen component have Jest tests. A Maestro flow is in `apps/mobile/.maestro/phase-10-feed-flow.yaml`; it covers sign in, liking the current feed item, opening comments, and posting a comment.

Install workspace dependencies, then run `pnpm --filter @reelindo/api test`, `pnpm --filter @reelindo/mobile test`, and `pnpm typecheck`. For the device flow, create an Android/iOS development build, start the API and mobile app, ensure the test account has at least one feed post with comments enabled, set `REELINDO_TEST_EMAIL` and `REELINDO_TEST_PASSWORD`, then run `maestro test apps/mobile/.maestro/phase-10-feed-flow.yaml`. The first-run onboarding screen can be completed by the optional prompts in the flow. The Maestro flow requires an emulator or device and a reachable API.

Install the new mobile and API dependencies with `pnpm install`, then run `pnpm db:generate`, `pnpm db:migrate`, `pnpm typecheck`, `pnpm dev:api`, and `pnpm dev:mobile`. To enable device push, run `eas init` from `apps/mobile`, set the generated EAS project ID under `expo.extra.eas.projectId` in `app.json`, then make an EAS development build. Local web/Expo Go sessions can use the API inbox and socket chat; the native notification module is loaded only in native builds, and push requires a development build.

### Create post API

1. `POST /posts/upload-url` with `{ "fileName": "clip.mp4", "contentType": "video/mp4", "fileSize": 1024000 }` returns an `uploadUrl`, `key`, `assetUrl`, and required headers.
2. `PUT` the raw file bytes to `uploadUrl` using the returned `Content-Type` header.
3. `POST /posts` with `{ "type": "REEL", "caption": "A day out", "mediaKey": "uploads/<user-id>/<generated-name>.mp4", "mediaUrl": "<assetUrl>", "visibility": "PUBLIC", "allowComments": true }` creates the post. Reels are queued for HLS processing; photos become ready immediately.

Public accounts always publish new posts and videos with `PUBLIC` visibility so they can appear in For You, Explore, and the creator's profile for all users. The API enforces this even if a client submits `FOLLOWERS` or `PRIVATE`; private accounts retain the per-post audience choices. Existing posts are not changed automatically when account privacy changes.

## Commands

- `pnpm dev:api` — start the API
- `pnpm dev:mobile` — start Expo
- `pnpm db:generate` — generate Prisma client
- `pnpm db:migrate` — apply local schema migration
- `pnpm db:seed` — insert development seed data
- `pnpm typecheck` — check TypeScript packages

## Phase 11 deployment

The API Docker image includes FFmpeg, runs as a non-root user, and exposes `/health` for liveness and `/ready` for database/Redis readiness. Deploy separate API and video-worker services from the same image. Sentry can be enabled with `SENTRY_DSN`; production origins can be restricted with `CORS_ORIGINS`. The mobile app has EAS development, preview, and production profiles plus app/adaptive icons, splash art, and a Play feature graphic. Original artwork sources and renderer are under `apps/mobile/assets/` and `apps/mobile/tools/`.

Follow [the deployment runbook](docs/deployment.md) for migration preparation, Railway/Render/AWS setup, secrets, R2/S3 CORS, EAS builds/submission, backup operations, store listing copy, and release checklist. The initial Prisma SQL migration must be generated and committed before `db:migrate:deploy`; the EAS project ID, provider credentials, production API URL, legal-policy URLs, store accounts, and signing credentials must be supplied from your accounts.

## Reelindo v2 Phase 2: smarter feed

The additive `/v2/feed/foryou` route provides a stable v1/v2 experiment, personalized candidate ranking, creator diversity, recommendation feedback, and an admin scoring inspector. Set `FEED_V2_PERCENT` to control the v2 cohort. Feed-interest signals are refreshed by the existing video worker through BullMQ. See [the Phase 2 guide](docs/phase-2-smart-feed.md) for migration, testing, rollback, and current limits.
