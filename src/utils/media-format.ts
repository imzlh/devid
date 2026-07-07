export type MediaFormat = "m3u8" | "h5";

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

function normalizedMediaType(type: unknown): string {
  return typeof type === "string" ? type.toLowerCase() : "";
}

export function mediaTypeSuggestsM3u8(type?: unknown): boolean {
  const normalized = normalizedMediaType(type);
  return normalized.includes("m3u8") ||
    normalized.includes("mpegurl") ||
    normalized.includes("hls");
}

export function mediaTypeSuggestsH5(type?: unknown): boolean {
  const normalized = normalizedMediaType(type);
  if (normalized === "h5" || normalized === "video") return true;
  return mediaTypeSuggestsDirectH5(type);
}

export function mediaTypeSuggestsDirectH5(type?: unknown): boolean {
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
    const parsed = new URL(url, "https://vdown.invalid");
    if (hasH5Extension(parsed.pathname)) return true;
    for (const key of H5_URL_QUERY_HINTS) {
      const value = parsed.searchParams.get(key);
      if (value && hasH5Extension(value)) return true;
    }
    for (const key of M3U8_QUERY_HINTS) {
      const value = parsed.searchParams.get(key);
      if (mediaTypeSuggestsH5(value ?? undefined)) return true;
    }
    return false;
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
    const parsed = new URL(url, "https://vdown.invalid");
    if (parsed.pathname.toLowerCase().endsWith(".m3u8")) return true;

    for (const key of M3U8_QUERY_HINTS) {
      const value = parsed.searchParams.get(key);
      if (mediaTypeSuggestsM3u8(value ?? undefined)) return true;
    }
    return false;
  } catch {
    const [path, query = ""] = url.split("?", 2);
    if (path.toLowerCase().endsWith(".m3u8")) return true;
    return /(?:^|[&;])(type|format|mime|contenttype|content-type)=[^&;]*(m3u8|mpegurl|hls)/i
      .test(query);
  }
}

export function inferMediaFormat(url: string, typeHint?: unknown): MediaFormat {
  if (looksLikeH5Url(url) || mediaTypeSuggestsDirectH5(typeHint)) return "h5";
  if (looksLikeM3u8Url(url)) return "m3u8";
  if (typeHint === "m3u8" || mediaTypeSuggestsM3u8(typeHint)) return "m3u8";
  if (typeHint === "h5" || mediaTypeSuggestsH5(typeHint)) return "h5";
  return "h5";
}

export function isPlayableMediaUrl(url: string, typeHint?: unknown): boolean {
  return looksLikeH5Url(url) ||
    looksLikeM3u8Url(url) ||
    mediaTypeSuggestsDirectH5(typeHint) ||
    typeHint === "m3u8" ||
    mediaTypeSuggestsM3u8(typeHint);
}
