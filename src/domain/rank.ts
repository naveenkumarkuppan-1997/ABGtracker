/**
 * Rank for dropping `activeId` into a list (sorted by rank, may already contain it).
 * `overId` is the item dropped on, or null for the end of the list.
 */
export function dropRank(list: { id: string; rank: number }[], activeId: string, overId: string | null): number {
  const rest = list.filter((x) => x.id !== activeId);
  let index = rest.length;
  if (overId) {
    const overIdx = rest.findIndex((x) => x.id === overId);
    if (overIdx >= 0) {
      const from = list.findIndex((x) => x.id === activeId);
      const to = list.findIndex((x) => x.id === overId);
      index = from >= 0 && from < to ? overIdx + 1 : overIdx; // moving down lands after the target
    }
  }
  return rankBetween(rest[index - 1]?.rank, rest[index]?.rank);
}

/** Fractional ranking: returns a rank strictly between two neighbours. */
export function rankBetween(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return 1000;
  if (before === undefined) return after! - 1000;
  if (after === undefined) return before + 1000;
  return (before + after) / 2;
}
