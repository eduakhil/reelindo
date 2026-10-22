ALTER TABLE "Post" ADD COLUMN "sourceMediaKey" TEXT;
ALTER TABLE "Post" ADD COLUMN "trimStart" DOUBLE PRECISION;
ALTER TABLE "Post" ADD COLUMN "trimEnd" DOUBLE PRECISION;
CREATE UNIQUE INDEX "Post_sourceMediaKey_key" ON "Post"("sourceMediaKey");
UPDATE "Post" SET "sourceMediaKey" = substring("videoUrl" FROM '/(uploads/[^?]+)$')
WHERE "type" = 'REEL' AND "videoUrl" ~ '/uploads/[^?]+$';
UPDATE "Post" AS post SET "sourceMediaKey" = substring(media."url" FROM '/(uploads/[^?]+)$')
FROM "PostMedia" AS media
WHERE media."postId" = post."id" AND post."sourceMediaKey" IS NULL AND media."url" ~ '/uploads/[^?]+$';

ALTER TABLE "Story" ADD COLUMN "mediaKey" TEXT;
CREATE UNIQUE INDEX "Story_mediaKey_key" ON "Story"("mediaKey");
UPDATE "Story" SET "mediaKey" = substring("mediaUrl" FROM '/(uploads/[^?]+)$')
WHERE "mediaUrl" ~ '/uploads/[^?]+$';
