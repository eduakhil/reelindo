import 'dotenv/config';
import { PrismaClient, PostStatus, PostType, Visibility } from '@prisma/client';

const prisma = new PrismaClient();
const topics = ['Dance', 'Food', 'Travel', 'Comedy', 'Fitness', 'Music', 'Art', 'Technology', 'Fashion', 'Education'];
const tags = ['reelindo', 'india', 'dance', 'food', 'travel', 'dailyvibe', 'creator', 'music', 'learn', 'fitness'];
const sampleVideos = [
  'https://videos.pexels.com/video-files/3129671/3129671-hd_1080_1920_25fps.mp4',
  'https://videos.pexels.com/video-files/3195394/3195394-hd_1080_1920_25fps.mp4',
  'https://videos.pexels.com/video-files/4434247/4434247-hd_1080_1920_25fps.mp4',
  'https://videos.pexels.com/video-files/854982/854982-hd_1080_1920_25fps.mp4',
];

async function main() {
  const topicRows = await Promise.all(topics.map((name) => prisma.interestTopic.upsert({ where: { name }, update: {}, create: { name } })));
  const hashtagRows = await Promise.all(tags.map((name) => prisma.hashtag.upsert({ where: { name }, update: {}, create: { name } })));
  const users = [];
  for (let i = 1; i <= 50; i += 1) {
    const username = `creator${String(i).padStart(2, '0')}`;
    users.push(await prisma.user.upsert({
      where: { username },
      update: {},
      create: {
        username,
        displayName: `Creator ${i}`,
        email: `${username}@example.test`,
        bio: `Sharing a little ${topics[(i - 1) % topics.length]?.toLowerCase()} every day.`,
        avatarUrl: `https://i.pravatar.cc/300?img=${i}`,
        interests: { create: [{ topicId: topicRows[(i - 1) % topicRows.length]!.id }, { topicId: topicRows[i % topicRows.length]!.id }] },
      },
    }));
  }
  const sounds = [];
  for (let i = 1; i <= 8; i += 1) {
    sounds.push(await prisma.sound.create({ data: { title: `Reelindo Original ${i}`, artist: `Creator ${i}`, audioUrl: `https://cdn.example.test/royalty-free/original-${i}.mp3`, coverUrl: `https://picsum.photos/seed/sound${i}/400/400`, duration: 15 + i * 2 } }));
  }
  for (let i = 0; i < 200; i += 1) {
    const user = users[i % users.length]!;
    const post = await prisma.post.create({ data: {
      userId: user.id,
      type: i % 5 === 0 ? PostType.PHOTO : PostType.REEL,
      caption: `A little ${topics[i % topics.length]?.toLowerCase()} moment from today. What do you think? #${tags[i % tags.length]}`,
      videoUrl: sampleVideos[i % sampleVideos.length],
      thumbnailUrl: `https://picsum.photos/seed/reelindo${i}/720/1280`,
      previewUrl: `https://picsum.photos/seed/preview${i}/360/640`,
      duration: 12 + (i % 40), width: 1080, height: 1920,
      soundId: sounds[i % sounds.length]!.id,
      status: PostStatus.READY, visibility: Visibility.PUBLIC,
      hashtags: { create: [{ hashtagId: hashtagRows[i % hashtagRows.length]!.id }, { hashtagId: hashtagRows[(i + 3) % hashtagRows.length]!.id }] },
      ...(i % 5 === 0 ? { media: { create: [{ url: `https://picsum.photos/seed/photo${i}/1080/1350`, order: 0 }] } } : {}),
    } });
    if (i % 3 === 0) await prisma.like.create({ data: { userId: users[(i + 1) % users.length]!.id, postId: post.id } });
  }
  console.log(`Seeded ${users.length} users and 200 posts.`);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
