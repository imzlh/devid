import type { VideoSourceManager } from "../manager.ts";

export interface ActiveSourceResponse {
  id: string | null;
  name: string | null;
  imageAspectRatio: string;
}

export function buildActiveSourceResponse(
  videoSourceManager: VideoSourceManager,
): ActiveSourceResponse {
  const activeSource = videoSourceManager.getActiveSource();
  return {
    id: activeSource?.getId() || null,
    name: activeSource?.getName() || null,
    imageAspectRatio: activeSource?.getImageAspectRatio() || "16/9",
  };
}
