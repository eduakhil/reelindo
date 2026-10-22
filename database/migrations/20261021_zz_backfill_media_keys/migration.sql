UPDATE "Post" SET "sourceMediaKey" = substring("videoUrl" FROM '/(uploads/[^?]+)$')
WHERE "type" = 'REEL' AND "sourceMediaKey" IS NULL AND "videoUrl" ~ '/uploads/[^?]+$';

UPDATE "Post" AS post SET "sourceMediaKey" = substring(media."url" FROM '/(uploads/[^?]+)$')
FROM "PostMedia" AS media
WHERE media."postId" = post."id" AND post."sourceMediaKey" IS NULL AND media."url" ~ '/uploads/[^?]+$';

UPDATE "Story" SET "mediaKey" = substring("mediaUrl" FROM '/(uploads/[^?]+)$')
WHERE "mediaKey" IS NULL AND "mediaUrl" ~ '/uploads/[^?]+$';
