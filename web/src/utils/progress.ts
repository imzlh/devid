import type { VideoItem } from "../types/api.ts";
import { httpUrlOrEmpty } from "./media.ts";

const STORAGE_KEY = "vdown:web:progress";

interface ProgressRecord {
  time: number;
  duration: number;
  updatedAt: number;
  video?: VideoItem;
}

type ProgressStore = Record<string, ProgressRecord>;

function keyOf(video: VideoItem | string): string {
  if (typeof video === "string") return video;
  return `${video.source}:${video.id}`;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isVideoItem(value: unknown): value is VideoItem {
  if (!value || typeof value !== "object") return false;
  const video = value as Partial<VideoItem>;
  return typeof video.id === "string" && video.id.trim().length > 0 &&
    typeof video.source === "string" && video.source.trim().length > 0 &&
    typeof video.title === "string" && video.title.trim().length > 0 &&
    typeof video.url === "string" && video.url.trim().length > 0;
}

function normalizeContentType(
  value: unknown,
): VideoItem["contentType"] | undefined {
  return value === "video" || value === "series" || value === "infinite"
    ? value
    : undefined;
}

function normalizeVideoItem(value: unknown): VideoItem | undefined {
  if (!isVideoItem(value)) return undefined;
  const url = httpUrlOrEmpty(value.url);
  if (!url) return undefined;
  return {
    id: value.id.trim(),
    source: value.source.trim(),
    title: value.title.trim(),
    url,
    thumbnail: httpUrlOrEmpty(value.thumbnail),
    duration: typeof value.duration === "string" ? value.duration : undefined,
    views: typeof value.views === "string" ? value.views : undefined,
    uploadTime: typeof value.uploadTime === "string"
      ? value.uploadTime
      : undefined,
    contentType: normalizeContentType(value.contentType),
  };
}

function normalizeRecord(value: unknown): ProgressRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<ProgressRecord>;
  const updatedAt = finiteNumber(record.updatedAt);
  if (updatedAt <= 0) return null;
  return {
    time: finiteNumber(record.time),
    duration: finiteNumber(record.duration),
    updatedAt,
    video: normalizeVideoItem(record.video),
  };
}

function readStore(): ProgressStore {
  try {
    const raw = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "{}",
    ) as Record<string, unknown>;
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(
      Object.entries(raw)
        .map(([key, value]) => [key, normalizeRecord(value)] as const)
        .filter((entry): entry is [string, ProgressRecord] =>
          entry[1] !== null
        ),
    );
  } catch {
    return {};
  }
}

function writeStore(store: ProgressStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage failures; playback should continue without local history.
  }
}

export function getProgress(video: VideoItem | string): number {
  const store = readStore();
  const record = store[keyOf(video)] ??
    (typeof video === "string" ? undefined : store[video.id]);
  if (!record) return 0;

  const maxAgeMs = 30 * 24 * 60 * 60 * 1000;
  if (Date.now() - record.updatedAt > maxAgeMs) return 0;
  if (record.duration > 0 && record.time > record.duration - 20) return 0;
  return Math.max(0, finiteNumber(record.time));
}

export function saveProgress(
  video: VideoItem,
  time: number,
  duration: number,
): void {
  const storedVideo = normalizeVideoItem(video);
  if (
    !storedVideo ||
    !Number.isFinite(time) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    time < 5
  ) return;
  const store = readStore();
  store[keyOf(storedVideo)] = {
    time,
    duration,
    updatedAt: Date.now(),
    video: storedVideo,
  };
  writeStore(store);
}

export function getRecentVideos(): VideoItem[] {
  const maxAgeMs = 30 * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  return Object.values(readStore())
    .filter((record) =>
      record.video && Date.now() - record.updatedAt <= maxAgeMs
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((record) => {
      if (!record.video) return false;
      if (record.duration > 0 && record.time > record.duration - 20) {
        return false;
      }
      const key = keyOf(record.video);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30)
    .flatMap((record) => record.video ? [record.video] : []);
}

export function clearRecentVideos(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures; the next read will keep the current in-memory view.
  }
}

export function removeRecentVideo(video: VideoItem): void {
  const store = readStore();
  delete store[keyOf(video)];
  delete store[video.id];
  writeStore(store);
}

export function getProgressPercent(video: VideoItem | string): number {
  const store = readStore();
  const record = store[keyOf(video)] ??
    (typeof video === "string" ? undefined : store[video.id]);
  if (!record || record.duration <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, Math.round((record.time / record.duration) * 100)),
  );
}
