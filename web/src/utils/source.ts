import type { Source, SourceHealth } from "../types/api.ts";

export function sourceIsAvailable(
  source: Source,
  healthMap: Record<string, SourceHealth>,
): boolean {
  const status = healthMap[source.id]?.status ?? source.health?.status ??
    "unknown";
  return source.enabled && status !== "unhealthy";
}

export function chooseAvailableSourceId(
  allSources: Source[],
  activeId: string | null | undefined,
  healthMap: Record<string, SourceHealth>,
): string | null {
  const activeCandidate = activeId
    ? allSources.find((source) =>
      source.id === activeId &&
      sourceIsAvailable(source, healthMap)
    )
    : null;
  const fallback = allSources.find((source) =>
    sourceIsAvailable(source, healthMap)
  );
  return activeCandidate?.id ?? fallback?.id ?? null;
}
