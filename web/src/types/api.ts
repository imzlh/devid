export type ContentType = "video" | "series" | "infinite";
export type PageKey = "home" | "search" | "recent" | "downloads" | "sources";

export interface Source {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  imageAspectRatio?: string;
  health?: SourceHealth;
}

export interface SourceHealth {
  status: "healthy" | "unhealthy" | "unknown";
  lastCheck: number;
  consecutiveFailures: number;
  circuitOpen: boolean;
  circuitOpenUntil: number;
  lastError?: string;
}

export interface SourceHealthResponse {
  health: Record<string, SourceHealth>;
  initialized: boolean;
  activeSourceId: string | null;
}

export interface ActiveSource {
  id: string | null;
  name: string | null;
  imageAspectRatio: string;
}

export interface VideoItem {
  id: string;
  title: string;
  thumbnail: string;
  duration?: string;
  views?: string;
  uploadTime?: string;
  url: string;
  source: string;
  contentType?: ContentType;
}

export interface VideoList {
  videos: VideoItem[];
  currentPage: number;
  totalPages: number;
}

export interface Episode {
  id: string;
  seriesId: string;
  title: string;
  episodeNumber: number;
  seasonNumber?: number;
  thumbnail?: string;
  duration?: string;
  url: string;
  description?: string;
  airDate?: string;
}

export interface SeriesDetail {
  id: string;
  seriesId: string;
  title: string;
  originalTitle?: string;
  description?: string;
  thumbnail: string;
  totalEpisodes: number;
  source: string;
  url: string;
  episodes?: Episode[];
  tags?: string[];
  year?: number;
  status?: string;
}

export const URLProxy = {
  NONE: 0,
  LOCAL: 1,
  REMOTE: 2,
} as const;

export type URLProxy = (typeof URLProxy)[keyof typeof URLProxy];

export interface VideoUrl {
  url: string;
  quality: string;
  resolution?: string;
  bandwidth?: number;
  format?: "m3u8" | "h5";
  referrer?: string;
  proxy?: URLProxy;
}

export interface DownloadTask {
  id: string;
  url: string;
  referer?: string;
  title: string;
  outputPath: string;
  fileName: string;
  filePath: string;
  format?: "m3u8" | "h5";
  proxy?: URLProxy;
  status: "pending" | "downloading" | "completed" | "error" | "cancelled";
  progress: number;
  createTime: string;
  startTime?: string;
  endTime?: string;
  error?: string;
  totalSegments?: number;
  retryCount?: number;
  maxRetries?: number;
}

export interface RpcPush<T = unknown> {
  method: string;
  data: T;
}

export interface CaptchaRequest {
  requestId: string;
  captchaPageUrl?: string;
  prompt: string;
  createdAt: number;
}
