CREATE TABLE "FeedInterestSignal" (
    "userId" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "signalKey" VARCHAR(200) NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FeedInterestSignal_pkey" PRIMARY KEY ("userId", "kind", "signalKey")
);

CREATE TABLE "FeedFeedback" (
    "userId" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedFeedback_pkey" PRIMARY KEY ("userId", "postId")
);

CREATE INDEX "FeedInterestSignal_userId_score_idx" ON "FeedInterestSignal"("userId", "score");
CREATE INDEX "FeedFeedback_userId_action_createdAt_idx" ON "FeedFeedback"("userId", "action", "createdAt");

ALTER TABLE "FeedInterestSignal" ADD CONSTRAINT "FeedInterestSignal_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedFeedback" ADD CONSTRAINT "FeedFeedback_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedFeedback" ADD CONSTRAINT "FeedFeedback_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
