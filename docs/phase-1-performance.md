# Reelindo v2 Phase 1: performance and stability

## Implemented in this phase

- Added a persisted **Data saver** preference. For HLS videos it selects the worker-generated lower-bitrate `stream_0.m3u8`; normal mode keeps the adaptive `master.m3u8` playlist.
- Enabled Expo Video source caching and configured the native video LRU cache to 500 MiB before the root app creates feed players.
- Switched avatars from React Native's `Image` to Expo Image with disk caching. Feed thumbnails also explicitly use memory and disk caching.
- Replaced the first-feed spinner with a lightweight skeleton placeholder.
- Added unit coverage for video rendition selection and fallback behavior.

## Existing behavior retained

The feed already uses FlashList, cursor pagination, and only attaches a video source to the active card. Offscreen players are paused and get a null source. Like and save actions already update optimistically. These behaviors remain in place.

## Not completed / follow-up requirements

- **Network-aware preload (3 on Wi-Fi, 1 on cellular):** `expo-network` or equivalent network-state support is not installed. Do not preload blindly on cellular; add the SDK 54-compatible package and test connection transitions on devices first.
- **Offline feed and resumable upload queue:** the mobile app has no SQLite/file-system queue or upload task implementation. The in-memory feed store is not an offline cache. This requires a persistent local schema and upload retry/resume design.
- **iOS HLS video caching:** Expo Video's native caching does not cache HLS streams on iOS. The 500 MiB LRU setting applies where the native cache supports the media source; it does not make HLS available offline on iOS.
- **Mobile Sentry, analytics, and feature flags:** these clients are not installed or configured. No DSN, analytics consent model, or flag service config is present.
- **Backend compression, Redis feed caching, and measured query plans:** no new server dependency was added. Query plans and meaningful feed benchmarks require a seeded running database and representative workload. API requests now use verified user IDs for authenticated rate-limit keys and client IPs for unauthenticated requests; the limiter remains process-local unless a shared store is configured.
- **Before/after performance numbers:** not reported because no physical-device profile, representative dataset, or production-like API/database was available. Collect cold-start, feed frame-time, memory, cache-hit, and API p50/p95 measurements before claiming a performance gain.

## Validation

Run from the repository root after dependencies are installed:

```powershell
pnpm --filter @reelindo/mobile test
pnpm --filter @reelindo/mobile typecheck
```

In this workspace, the standalone rendition-selection check passed for all four cases (low-bitrate HLS, normal adaptive HLS, non-HLS, and missing URL), and Node's TypeScript syntax check passed for the changed helper/store/cache files and API server. Jest and TypeScript project checks could not run because workspace dependencies are not installed (`node_modules` is absent).

For device checks, compare normal and Data saver playback, confirm the lower rendition is served, verify avatar/thumbnail cache behavior, and repeat after app restart. Use a native development build; Expo Go or web is not sufficient to validate native video-cache limits.

## Rollback

To disable this slice, remove the Data saver row and `data_saver` preference, have `getFeedVideoUrl` always return the master URL, remove `useCaching` and the `configureVideoCache()` call, and revert the Expo Image imports/cache props. These changes do not alter server data or require a database migration.

To restore the prior API rate-limit behavior, remove the `keyGenerator` option from the `@fastify/rate-limit` registration in `apps/api/src/server.ts`.
