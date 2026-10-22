import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';

export async function matchesMediaSignature(s3: S3Client, bucket: string, key: string, contentType: string, expected: 'IMAGE' | 'VIDEO') {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=0-11' }));
  if (!response.Body) return false;
  const bytes = await response.Body.transformToByteArray();
  if (expected === 'IMAGE') {
    if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (contentType === 'image/png') return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
    if (contentType === 'image/webp') return bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
    return false;
  }
  return (contentType === 'video/mp4' || contentType === 'video/quicktime') && bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp';
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}
