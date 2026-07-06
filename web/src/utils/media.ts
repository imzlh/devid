import { URLProxy, type VideoUrl } from "../types/api";

export function playbackUrl(video: VideoUrl, referer?: string): string {
  if (video.proxy === URLProxy.LOCAL || video.proxy === URLProxy.REMOTE) {
    const name = video.url.split("/").pop() || "playlist.m3u8";
    const params = new URLSearchParams({
      url: video.url,
      referer: video.referrer ?? referer ?? video.url,
    });
    if (video.proxy === URLProxy.REMOTE) {
      params.set("proxy", "remote");
    }
    return `/api/proxy/${encodeURIComponent(name)}?${params}`;
  }

  return video.url;
}

export function bestQuality(videos: VideoUrl[]): VideoUrl | null {
  if (!videos.length) return null;
  return videos.reduce((best, current) => {
    const bestBandwidth = best.bandwidth ?? 0;
    const currentBandwidth = current.bandwidth ?? 0;
    if (currentBandwidth !== bestBandwidth) {
      return currentBandwidth > bestBandwidth ? current : best;
    }

    const bestResolution = Number(best.resolution?.match(/\d+/)?.[0] ?? 0);
    const currentResolution = Number(
      current.resolution?.match(/\d+/)?.[0] ?? 0,
    );
    return currentResolution > bestResolution ? current : best;
  });
}
