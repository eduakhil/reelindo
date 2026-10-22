CREATE TYPE "StoryAudience" AS ENUM ('FOLLOWERS', 'CLOSE_FRIENDS');

ALTER TABLE "Story"
  ADD COLUMN "audience" "StoryAudience" NOT NULL DEFAULT 'FOLLOWERS',
  ADD COLUMN "overlays" JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE "CloseFriend" (
  "ownerId" UUID NOT NULL,
  "friendId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CloseFriend_pkey" PRIMARY KEY ("ownerId", "friendId")
);

CREATE INDEX "CloseFriend_friendId_ownerId_idx" ON "CloseFriend"("friendId", "ownerId");

ALTER TABLE "CloseFriend"
  ADD CONSTRAINT "CloseFriend_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CloseFriend_friendId_fkey"
  FOREIGN KEY ("friendId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
