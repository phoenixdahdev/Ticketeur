import type { RouterOutputs } from '@ticketur/api'

// public.contests.bySlug answers with the whole ballot, or null when there is
// no contest the public may see under that slug. Everything the page renders
// is derived from that one shape, so a field added or renamed on the server
// is a type error here rather than an empty space on the page.
export type ContestBySlug = RouterOutputs['public']['contests']['bySlug']
export type PublicContest = NonNullable<ContestBySlug>

export type ContestSummary = PublicContest['contest']
export type ContestEventSummary = PublicContest['event']
export type ContestCategory = PublicContest['categories'][number]
export type ContestEntry = PublicContest['entries'][number]
export type VoteBundle = PublicContest['bundles'][number]
export type VotingAvailability = PublicContest['voting']

export type VoteBalance = NonNullable<
  RouterOutputs['public']['voteBalance']['byEmail']
>

/** A category with the entries that belong to it, ranked. */
export type RankedEntry = ContestEntry & {
  /** Shared by ties (1, 2, 2, 4), or null before anyone has voted. */
  rank: number | null
}

export type ContestSection = {
  id: string
  title: string
  description: string | null
  entries: RankedEntry[]
}

/**
 * Entries grouped under their category and ordered the way the server's own
 * leaderboard orders them: `desc(voteCount), asc(sortOrder), asc(id)`. The
 * tie-breakers matter — without them a page of entries on equal votes would
 * shuffle on every refetch while someone was reading it.
 *
 * Ranks are withheld until somebody has actually voted. "Joint 1st out of
 * twelve, nil votes each" is a true statement and a useless one; the ballot
 * reads better as a plain list until the counts mean something.
 */
export function groupEntries(
  categories: ContestCategory[],
  entries: ContestEntry[]
): ContestSection[] {
  const byCategory = new Map<string, ContestEntry[]>()
  for (const entry of entries) {
    const bucket = byCategory.get(entry.categoryId)
    if (bucket) bucket.push(entry)
    else byCategory.set(entry.categoryId, [entry])
  }

  const sections: ContestSection[] = categories.map((category) => ({
    id: category.id,
    title: category.title,
    description: category.description,
    entries: rank(byCategory.get(category.id) ?? []),
  }))

  // `entries.category_id` is NOT NULL and cascades, so an entry whose
  // category is missing from the list above should be impossible. Collected
  // rather than dropped anyway: an entry that silently vanishes from a public
  // ballot is the one failure nobody would notice until a contestant did.
  const known = new Set(categories.map((c) => c.id))
  const orphans = entries.filter((e) => !known.has(e.categoryId))
  if (orphans.length > 0) {
    sections.push({
      id: '__ungrouped',
      title: 'Other entries',
      description: null,
      entries: rank(orphans),
    })
  }

  return sections
}

function rank(entries: ContestEntry[]): RankedEntry[] {
  const sorted = [...entries].sort(
    (a, b) =>
      b.voteCount - a.voteCount ||
      a.sortOrder - b.sortOrder ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
  const anyVotes = sorted.some((e) => e.voteCount > 0)
  if (!anyVotes) return sorted.map((entry) => ({ ...entry, rank: null }))

  let current = 0
  let previous: number | null = null
  return sorted.map((entry, index) => {
    if (previous === null || entry.voteCount !== previous) {
      current = index + 1
      previous = entry.voteCount
    }
    return { ...entry, rank: current }
  })
}

/** Total votes cast across every entry on the ballot. */
export function totalVotes(entries: ContestEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.voteCount, 0)
}
