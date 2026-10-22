# Reelindo v2 Phase 2: Smarter Feed

## Implemented

- Added the non-breaking `GET /v2/feed/foryou` endpoint. A stable SHA-256 bucket assigns each user to the v1 baseline or v2 ranking. Set `FEED_V2_PERCENT` to an integer from 0 to 100 (default 20); existing `/posts/feed/foryou` and `/posts/feed/following` routes remain unchanged.
- Added `GET`/`PUT /v2/feed/interests` and a Settings screen for selecting seeded interest topics.
- V2 candidates come from recent trending public posts, accepted follows, followed/private creators with eligible visibility, interest signals, liked creators, liked sounds, liked hashtags, and selected topic names. Posts from blocked or banned accounts and private accounts outside accepted follows are excluded.
- Ranking uses follow affinity, weighted creator/hashtag/sound interests, similar likes, recent popularity, watch completion and duration, view-event frequency, creator follower count, and a new-creator freshness boost. The ordered page applies a two-in-a-row creator diversity rule.
- Added `POST`/`DELETE /v2/feed/:postId/feedback` for “Not interested” and “Show me less like this”. The first excludes the post; the second reduces that creator’s score. The response includes plain-language `recommendationReasons` for “Why am I seeing this?”.
- Added an admin-only `GET /admin/users/:userId/feed-debug` endpoint with scores and reason strings.
- The mobile For You feed uses the versioned endpoint, records sampled watch duration/completion when an active video card stops, and shows the three recommendation actions. Existing Following and legacy feed APIs are unchanged.
- Added `FeedInterestSignal` and `FeedFeedback` tables. View and like activity schedules a deduplicated BullMQ refresh after five minutes. The existing video worker process now also consumes the refresh queue.

## Commands

Set `FEED_V2_PERCENT=0` to disable v2, or increase it gradually after observing the experiment. With a migrated database and installed dependencies, run:

```powershell
pnpm db:generate
pnpm db:migrate:deploy
pnpm --filter @reelindo/api test
pnpm --filter @reelindo/api typecheck
pnpm --filter @reelindo/mobile test
pnpm --filter @reelindo/mobile typecheck
```

Run the API and the existing video worker; the video worker now also consumes `feed-interest-refresh`. Confirm Redis is configured for interest refreshes. Test both `FEED_V2_PERCENT=0` and `100`, verify pagination, check private/blocked account visibility, record watch events, submit each feedback action, and inspect scores as an ADMIN account.

## Migration and known limitations

The migration is additive and cascades new signal/feedback rows when their user or post is deleted. Interest selection reuses the existing `InterestTopic` and `UserInterest` tables. The repository still lacks the original baseline migration, so a fresh database needs that baseline created and reviewed before `migrate deploy` can be used reliably. Existing databases must already have the v1 `User` and `Post` tables. Seed the built-in topics with `pnpm db:seed` so users can select them.

Candidate generation is bounded to a few hundred records per source and reranks that pool on each page; it is a starter ranking pipeline, not a large-scale retrieval system. Signal refresh is triggered by view/like/feedback activity and is delayed by five minutes; it does not run on a global timer for inactive users. Replays are approximated from repeated view events, and creator quality currently uses follower count. Admin scores should only be exposed to authenticated ADMIN users.

## Rollback

Set `FEED_V2_PERCENT=0` to switch all For You requests on the new mobile client to the existing baseline while keeping the new API available. To remove the feature, revert the mobile endpoint and feedback UI, remove `registerFeedV2Routes` and the interest queue calls/worker import, then apply this rollback SQL only after all v2 API and worker instances are stopped:

```sql
DROP TABLE "FeedFeedback";
DROP TABLE "FeedInterestSignal";
```

Do not drop the tables while the v2 endpoint or worker is still deployed.
