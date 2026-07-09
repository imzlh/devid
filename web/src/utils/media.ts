import { URLProxy, type VideoUrl } from "../types/api.ts";

const M3U8_QUERY_HINTS = [
  "type",
  "format",
  "mime",
  "contenttype",
  "content-type",
];
const H5_EXTENSIONS = [
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".flv",
  ".wmv",
  ".mpg",
  ".mpeg",
  ".3gp",
];
const DISPOSITION_QUERY_HINTS = [
  "response-content-disposition",
  "content-disposition",
  "filename",
  "download",
];
const H5_URL_QUERY_HINTS = [
  ...DISPOSITION_QUERY_HINTS,
  "url",
  "src",
  "file",
  "video",
  "media",
  "source",
];

export function httpUrlOrEmpty(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}

function normalizedMediaType(type: unknown): string {
  return typeof type === "string" ? type.toLowerCase() : "";
}

function mediaTypeSuggestsM3u8(type?: unknown): boolean {
  const normalized = normalizedMediaType(type);
  return normalized.includes("m3u8") ||
    normalized.includes("mpegurl") ||
    normalized.includes("hls");
}

function mediaTypeSuggestsH5(type?: unknown): boolean {
  const normalized = normalizedMediaType(type);
  if (normalized === "h5" || normalized === "video") return true;
  return mediaTypeSuggestsDirectH5(type);
}

function mediaTypeSuggestsDirectH5(type?: unknown): boolean {
  const normalized = normalizedMediaType(type);
  return normalized.includes("video/mp4") ||
    normalized.includes("video/webm") ||
    normalized.includes("video/quicktime") ||
    normalized.includes("video/x-matroska") ||
    normalized.includes("mp4") ||
    normalized.includes("webm");
}

function hasH5Extension(value: string): boolean {
  const lower = value.toLowerCase();
  return H5_EXTENSIONS.some((extension) =>
    lower.endsWith(extension) || lower.includes(`${extension}?`)
  );
}

export function looksLikeH5Url(url: string): boolean {
  try {
    const parsed = new URL(
      url,
      globalThis.location?.href ?? "http://localhost/",
    );
    if (hasH5Extension(parsed.pathname)) return true;
    if (
      H5_URL_QUERY_HINTS.some((key) => {
        const value = parsed.searchParams.get(key);
        return value ? hasH5Extension(value) : false;
      })
    ) {
      return true;
    }
    return M3U8_QUERY_HINTS.some((key) =>
      mediaTypeSuggestsH5(parsed.searchParams.get(key))
    );
  } catch {
    const [path, query = ""] = url.split("?", 2);
    return hasH5Extension(path) ||
      /(?:^|[&;])(response-content-disposition|content-disposition|filename|download)=[^&;]*\.(mp4|m4v|mov|webm|mkv|avi|flv|wmv|mpg|mpeg|3gp)(?:$|[&;])/i
        .test(query) ||
      /(?:^|[&;])(type|format|mime|contenttype|content-type)=[^&;]*(mp4|webm|quicktime|x-matroska)/i
        .test(query);
  }
}

export function looksLikeM3u8Url(url: string): boolean {
  if (looksLikeH5Url(url)) return false;
  try {
    const parsed = new URL(
      url,
      globalThis.location?.href ?? "http://localhost/",
    );
    if (parsed.pathname.toLowerCase().endsWith(".m3u8")) return true;
    return M3U8_QUERY_HINTS.some((key) =>
      mediaTypeSuggestsM3u8(parsed.searchParams.get(key))
    );
  } catch {
    const [path, query = ""] = url.split("?", 2);
    if (path.toLowerCase().endsWith(".m3u8")) return true;
    return /(?:^|[&;])(type|format|mime|contenttype|content-type)=[^&;]*(m3u8|mpegurl|hls)/i
      .test(query);
  }
}

export function inferMediaFormat(
  url: string,
  typeHint?: unknown,
): "m3u8" | "h5" {
  if (looksLikeH5Url(url) || mediaTypeSuggestsDirectH5(typeHint)) return "h5";
  if (looksLikeM3u8Url(url)) return "m3u8";
  if (typeHint === "m3u8" || mediaTypeSuggestsM3u8(typeHint)) return "m3u8";
  if (typeHint === "h5" || mediaTypeSuggestsH5(typeHint)) return "h5";
  return "h5";
}

function isM3u8Video(video: VideoUrl): boolean {
  return inferMediaFormat(video.url, video.format) === "m3u8";
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function finitePositiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeProxy(value: unknown): VideoUrl["proxy"] {
  return value === URLProxy.NONE || value === URLProxy.LOCAL ||
      value === URLProxy.REMOTE
    ? value
    : undefined;
}

export function normalizePlaybackUrls(value: unknown): VideoUrl[] {
  if (!Array.isArray(value)) return [];
  const videos: VideoUrl[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<VideoUrl>;
    const url = httpUrlOrEmpty(candidate.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const format = inferMediaFormat(url, candidate.format);
    const quality = nonEmptyString(candidate.quality) ||
      nonEmptyString(candidate.resolution) || "默认";
    videos.push({
      url,
      quality,
      resolution: nonEmptyString(candidate.resolution),
      bandwidth: finitePositiveNumber(candidate.bandwidth),
      format,
      referrer: httpUrlOrEmpty(candidate.referrer) || undefined,
      proxy: normalizeProxy(candidate.proxy) ??
        (format === "m3u8" ? URLProxy.LOCAL : undefined),
    });
  }
  return videos;
}

function proxyFileName(video: VideoUrl): string {
  try {
    const url = new URL(video.url);
    const name = url.pathname.split("/").filter(Boolean).pop();
    if (name) return name;
  } catch {
    const name = video.url.split("?")[0].split("/").filter(Boolean).pop();
    if (name) return name;
  }

  return isM3u8Video(video) ? "playlist.m3u8" : "video.mp4";
}

export function playbackUrl(video: VideoUrl, referer?: string): string {
  const mediaUrl = httpUrlOrEmpty(video.url);
  if (!mediaUrl) return "";

  const normalizedVideo = { ...video, url: mediaUrl };
  const useM3u8 = isM3u8Video(normalizedVideo);
  const effectiveFormat = useM3u8 ? "m3u8" : "h5";
  const shouldProxy = video.proxy === URLProxy.LOCAL ||
    video.proxy === URLProxy.REMOTE ||
    (video.proxy == null && useM3u8);

  if (shouldProxy) {
    const name = proxyFileName(normalizedVideo);
    const params = new URLSearchParams({
      url: mediaUrl,
      referer: httpUrlOrEmpty(video.referrer) || httpUrlOrEmpty(referer) ||
        mediaUrl,
    });
    params.set("type", effectiveFormat);
    if (video.proxy === URLProxy.REMOTE) {
      params.set("proxy", "remote");
    }
    return `/api/proxy/${encodeURIComponent(name)}?${params}`;
  }

  return mediaUrl;
}

export function bestQuality(videos: VideoUrl[] | unknown): VideoUrl | null {
  const normalized = normalizePlaybackUrls(videos);
  if (!normalized.length) return null;
  return normalized.reduce((best, current) => {
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
