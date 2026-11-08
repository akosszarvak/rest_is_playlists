/** 3725 -> "1h 02m", 2880 -> "48m", null -> "–" */
export function formatDuration(seconds: number | null): string {
  if (seconds == null) return '–'
  const minutes = Math.round(seconds / 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

/** "2026-11-05" -> "5 Nov 2026" */
export function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
  })
}

/** -753 -> "753 BC", 476 -> "AD 476" */
export function formatYear(year: number): string {
  return year < 0 ? `${-year} BC` : `AD ${year}`
}

/** { start: -753, end: 476 } -> "753 BC – AD 476" */
export function formatEra(era: { start: number, end: number } | null): string {
  if (!era) return ''
  return era.start === era.end ? formatYear(era.start) : `${formatYear(era.start)} – ${formatYear(era.end)}`
}

/** ISO timestamp -> "5 Nov 2026, 14:03" in the user's time zone. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}
