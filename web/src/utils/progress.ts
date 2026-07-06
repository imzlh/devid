import type { VideoItem } from "../types/api";

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

function readStore(): ProgressStore {
  try {
    return JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "{}",
    ) as ProgressStore;
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
  return Math.max(0, record.time);
}

export function saveProgress(
  video: VideoItem,
  time: number,
  duration: number,
): void {
  if (!video.id || time < 5) return;
  const store = readStore();
  store[keyOf(video)] = {
    time,
    duration,
    updatedAt: Date.now(),
    video,
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
    .map((record) => record.video!);
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
