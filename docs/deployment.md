# Reelindo deployment runbook

This runbook prepares the API, FFmpeg worker, and Expo app for a production release. It does not publish to a hosting provider or app store; those actions require your provider accounts, domains, credentials, and store listings.

## 1. Prepare a production database migration

The repository currently has no SQL migration under `database/migrations/`. Create and commit the initial migration before deploying; `prisma migrate deploy` only applies committed migration files.

From the repository root, install dependencies, start the local database, then generate the migration:

```powershell
pnpm install
docker compose up -d postgres
pnpm db:generate
pnpm db:migrate
```

Use a descriptive migration name when Prisma asks, review the generated `database/migrations/<timestamp>_<name>/migration.sql`, and commit it together with `pnpm-lock.yaml`. This repository currently has no pnpm lockfile; generating one is needed for reproducible builds. Do not point `db:migrate` at the production database. Production releases run:

```powershell
pnpm --filter @reelindo/api db:migrate:deploy
```

## 2. Deploy the API and video worker

The same [API Dockerfile](../apps/api/Dockerfile) produces an image with Node.js 22 and FFmpeg. It runs as the non-root `node` user and checks `/ready` for container readiness. Build from the repository root so the Prisma schema and workspace files are in the build context:

```powershell
docker build -f apps/api/Dockerfile -t reelindo-api:latest .
```

Create two long-running services from this image:

| Service | Start command | Purpose |
| --- | --- | --- |
| API | `node --import apps/api/instrument.mjs apps/api/dist/server.js` | REST API, Swagger, Socket.IO |
| Video worker | `node --import apps/api/instrument.mjs apps/api/dist/workers/video-worker.js` | Video transcodes and feed-interest refresh jobs |

The API should listen on the provider's `PORT` or set `API_PORT` to the assigned port. Set `API_HOST=0.0.0.0`. Configure the provider's API health check to `GET /ready` (HTTP 200). `/health` is a liveness check only; `/ready` checks PostgreSQL and configured Redis.

For Railway or Render, create a web service and a separate worker/background service from the same repository and Dockerfile. Set the start commands above. Attach managed PostgreSQL and Redis, then add the production environment variables below to both services. Set the migration command as a pre-deploy/release command if the provider supports one; otherwise run it as a one-off release job before shifting traffic.

For AWS, publish the image to ECR and run the API as an ECS/Fargate service and the worker as a separate ECS service using the worker command. Put both in private subnets with access to managed RDS PostgreSQL, ElastiCache Redis, and the S3/R2 endpoint. Terminate HTTPS at an Application Load Balancer or API Gateway and send `/ready` as the target health check.

## 3. Production environment variables

Set secrets in the hosting provider's secret manager. Do not commit production `.env` files.

| Variable | Production value |
| --- | --- |
| `DATABASE_URL` | Managed PostgreSQL connection string with TLS enabled |
| `REDIS_URL` | Managed Redis connection string; use TLS where supported |
| `PORT` / `API_PORT` | The API defaults to provider `PORT`, or `4000` when unset; `API_PORT` overrides it |
| `API_HOST` | `0.0.0.0` |
| `JWT_ACCESS_SECRET` | Unique cryptographically random secret, at least 32 characters |
| `JWT_REFRESH_SECRET` | A different unique random secret, at least 32 characters |
| `CORS_ORIGINS` | Comma-separated trusted web origins; leave unset only if clients are native-only |
| `S3_ENDPOINT` | S3 endpoint or `https://<account-id>.r2.cloudflarestorage.com` for R2 |
| `S3_REGION` | AWS region, or `auto` for R2 |
| `S3_BUCKET` | Private upload and processed-media bucket |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Dedicated least-privilege bucket credentials |
| `S3_PUBLIC_BASE_URL` | Stable HTTPS CDN/custom domain for public processed media |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` (included in the image) |
| `BANNED_WORDS` | Optional comma-separated additional moderation terms |
| `MODERATION_API_URL` / `MODERATION_API_KEY` | Optional moderation provider endpoint and secret |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` | Optional Sentry project DSN and environment name |
| `FEED_V2_PERCENT` | Integer from 0 to 100 controlling the stable v2 For You experiment cohort; defaults to 20 |

Use independent credentials for development, preview, and production. Restrict S3/R2 credentials to the required bucket and operations. The app uses Socket.IO on the API origin, so allow WebSocket upgrades through the provider proxy and CDN.

Set `CORS_ORIGINS` to the exact comma-separated web origins that should access the API and Socket.IO. With it unset, browser-origin requests are denied while native app requests without an `Origin` header continue to work. Add a web origin before deploying a browser client.

### S3/R2 CORS

For direct uploads from a web client, configure the bucket with the actual client origin. Replace the example origin before applying:

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["Content-Type", "Authorization", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Use HTTPS on the API and media CDN. Keep the bucket private for source uploads and allow public/CDN reads only for the processed media paths the app serves.

## 4. Database backups and operations

Enable the managed PostgreSQL provider's daily automated backups and point-in-time recovery where available. Set a retention period that meets your business and privacy requirements. Test a restore into a separate database before launch and periodically afterward.

For an additional manual logical backup from a machine with PostgreSQL client tools, set `DATABASE_URL` in that shell and run:

```powershell
pg_dump --format=custom --no-owner --file="reelindo-$(Get-Date -Format yyyyMMdd-HHmm).dump" $env:DATABASE_URL
```

Store backups encrypted outside the app bucket. Restrict access and define deletion/retention. Monitor `/ready`, provider CPU/memory, database connections/storage, Redis memory, worker job failures, and Sentry. Alert on repeated failed jobs and unavailable dependencies. Do not log access tokens, refresh tokens, passwords, or signed upload URLs.

## 5. Configure EAS builds

The app has the bundle identifiers `com.reelindo.app`, scheme `reelindo`, and development/preview/production profiles in `apps/mobile/app.json` and `apps/mobile/eas.json`. The project-specific EAS ID is intentionally not fabricated.

```powershell
npm install --global eas-cli
cd apps/mobile
eas login
eas build:configure
eas init
```

Use the project ID created by `eas init`. Set `EXPO_PUBLIC_API_URL` separately for each EAS environment; it is a public client URL, not a secret:

```powershell
eas env:set --name EXPO_PUBLIC_API_URL --value https://api.example.com --environment production --visibility plaintext
eas env:set --name EXPO_PUBLIC_API_URL --value https://api-preview.example.com --environment preview --visibility plaintext
```

Set the development environment URL to your development API. The EAS build profile selects the matching environment. `apps/mobile/assets/reelindo-mark.svg` is the source brand mark. PNG app, splash, Android adaptive, and 1024x500 Play feature art are already generated in that folder; regenerate them with Python 3 and Pillow (`python -m pip install Pillow`, then `python apps/mobile/tools/render-brand-assets.py`). Capture phone and tablet screenshots from real builds and ensure the screenshots reflect actual app behavior.

Set up Apple APNs and Android FCM credentials with `eas credentials` before testing push delivery. Push registration also needs the EAS project ID and a physical device.

Build, install, and test preview builds before production:

```powershell
eas build --profile development --platform android
eas build --profile preview --platform android
eas build --profile preview --platform ios
```

Production packages and submissions:

```powershell
eas build --profile production --platform android
eas build --profile production --platform ios
eas submit --platform android --profile production
eas submit --platform ios --profile production
```

Before `eas submit`, configure Google Play service-account credentials and the Play app listing, plus App Store Connect app records and Apple credentials. Add Sign in with Apple before offering Google sign-in on iOS; the current app has email/password auth only. For OTA releases, use runtime-version compatibility and publish against the matching EAS environment:

```powershell
eas update --environment production --branch production --message "Describe the update"
```

## 6. Store listing draft

**Google Play title:** Reelindo: Short Video & Social  
**Apple subtitle:** Watch. Create. Vibe.  
**Category:** Social Networking / Social

**Short description**

Watch short videos, share moments, and find creators and friends on Reelindo.

**Full description**

Find your next vibe on Reelindo. Watch a personalized stream of short videos, discover creators and sounds, and share the moments you want people to remember.

- Explore a For You feed and videos from people you follow.
- Share reels, photos, and 24-hour stories.
- Follow creators, like and save posts, and join conversations in comments.
- Search creators, hashtags, and sounds.
- Message friends and share posts in private conversations.
- Customize your profile, privacy, notifications, language, and theme.
- Report content and block accounts from the app.

Reelindo is for people aged 16 and older. Only upload media and sounds you own or have permission to share. Review our Community Guidelines and Privacy Policy before posting.

**Apple keywords:** short video, reels, creator, stories, social, music, explore  
**Review notes:** Provide a working demo account with sample posts, comments, and messages. Explain that uploads and push notifications need a network connection and configured permissions.

Publish final Terms, Privacy Policy, and Community Guidelines at stable public URLs and enter them in both store consoles. The in-app legal pages are drafts and need legal review before release.

## 7. Store approval checklist

- [ ] Commit the initial Prisma migration and verify it on a clean staging database.
- [ ] Use production HTTPS endpoints, strong separate JWT secrets, managed data services, and private media storage.
- [ ] Test account registration age gate, reporting, blocking, content removal, and in-app account deletion on physical devices.
- [ ] Add Sign in with Apple if any third-party sign-in is added to iOS.
- [ ] Publish reviewed Terms, Privacy Policy, Community Guidelines, and deletion/support contact URLs.
- [ ] Complete Google Play Data safety/content rating and Apple privacy nutrition labels truthfully for actual data collection.
- [ ] Verify media/music rights and moderation escalation procedures; do not ship bundled copyrighted music.
- [ ] Set up push credentials, app icons, splash/adaptive icons, store feature art, phone/tablet screenshots, and store metadata.
- [ ] Run internal/closed testing on Google Play and TestFlight on iOS; resolve crash, login, upload, moderation, and deletion issues before production rollout.
- [ ] Confirm backups, restore procedure, alerts, incident contact, and rollback plan.
