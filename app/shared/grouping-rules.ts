// The grouping rules from SPEC section 3. Every prompt (manual copy/paste and the AI
// adapters) includes this text, and the pre-made grouping follows the same rules.

export const GROUPING_RULES = `
1. Prefer few, broad playlists. The listener does not want to maintain many small playlists.
   Before creating a playlist, decide whether the topic deserves its own playlist or is an
   integral part of a broader one. Example: the Punic Wars and Hannibal belong in "Ancient Rome".
   Constantinople and Byzantium are a different subject.
2. Overlap is allowed and intended. A large multi-part series (e.g. the Hundred Years' War) may
   get its own playlist of kind "series" AND appear in full inside its broad parent playlist,
   so listening to the broad playlist covers the smaller one. Set the series' "parent" to the
   broad playlist's id, and list every episode of the series in the parent too.
3. Keep context together. Episodes that lead up to an event belong in the same playlist as that
   event, so back-references are not missed. Example: the run-up to the Hundred Years' War sits
   with the Joan of Arc episodes.
4. One-off episodes go into broad era or theme buckets (e.g. "Medieval Europe", "20th Century",
   "Modern Britain"), not into their own playlists.
5. Exclude: members-only / "Rest Is History Club" episodes (reason "club"), trailers (reason
   "trailer"), and "From the archive" re-releases whose original episode is also in the list
   (reason "archive-duplicate"). A re-release whose original is missing from the list is kept.
6. Ordering inside a playlist: series and one-offs are ordered by the historical period they
   cover (e.g. Rome 753 BC, then the Punic Wars, then the Empire, then the fall of the West).
   Parts of a multi-part series always stay in their release order, even if a later part covers
   an earlier period. Episodes with no clear date fall back to release order.
`.trim()
