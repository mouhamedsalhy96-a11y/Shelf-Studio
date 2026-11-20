export type GenerationHistoryEntry = {
  id: string;
  status: "creating" | "processing" | "succeeded" | "failed";
  createdAt: string;
  productName: string;
  scene: string;
  ratio: string;
  hasCopy: boolean;
  imageUrl: string | null;
};
export type GenerationHistoryPage = {
  items: GenerationHistoryEntry[];
  nextCursor: string | null;
};
export function mergeGenerationHistory(
  current: GenerationHistoryEntry[],
  incoming: GenerationHistoryEntry[],
) {
  const entries = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) {
    const previous = entries.get(entry.id);
    // A first-page request may finish after polling has already completed a job.
    // Never replace a terminal result with an older in-progress summary.
    if (
      previous &&
      ["succeeded", "failed"].includes(previous.status) &&
      ["creating", "processing"].includes(entry.status)
    )
      continue;
    entries.set(entry.id, entry);
  }
  return [...entries.values()].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
      b.id.localeCompare(a.id),
  );
}
