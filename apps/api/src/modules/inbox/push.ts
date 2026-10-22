import type { PrismaClient } from '@prisma/client';

export async function sendExpoPush(prisma: PrismaClient, userId: string, title: string, body: string, data: Record<string, string>) {
  const preference = await prisma.notificationPreference.findUnique({ where: { userId }, select: { pushEnabled: true } });
  if (preference?.pushEnabled === false) return;
  const devices = await prisma.deviceToken.findMany({ where: { userId }, select: { token: true } });
  if (!devices.length) return;
  const messages = devices.map(({ token }) => ({ to: token, sound: 'default', title, body, data, priority: 'high' }));
  const response = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(messages) }).catch(() => null);
  if (!response?.ok) return;
  const result = await response.json() as { data?: Array<{ status?: string; details?: { error?: string } }> };
  const invalid = result.data?.flatMap((ticket, index) => ticket.details?.error === 'DeviceNotRegistered' ? [devices[index]?.token].filter((token): token is string => Boolean(token)) : []) ?? [];
  if (invalid.length) await prisma.deviceToken.deleteMany({ where: { token: { in: invalid } } });
}
