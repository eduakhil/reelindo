import { getFeedVideoUrl } from './feed-video';

describe('getFeedVideoUrl', () => {
  const master = 'https://cdn.example/video/master.m3u8';
  it('selects the low-bitrate rendition when data saver is enabled', () => {
    expect(getFeedVideoUrl(master, true)).toBe('https://cdn.example/video/stream_0.m3u8');
  });
  it('keeps adaptive playback when data saver is disabled', () => {
    expect(getFeedVideoUrl(master, false)).toBe(master);
  });
  it('preserves non-HLS sources and missing videos', () => {
    expect(getFeedVideoUrl('https://cdn.example/video.mp4', true)).toBe('https://cdn.example/video.mp4');
    expect(getFeedVideoUrl(null, true)).toBeNull();
  });
});
