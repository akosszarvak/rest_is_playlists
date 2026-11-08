/** Best readable message from a failed $fetch/useFetch call or any thrown value. */
export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const data = (error as { data?: { message?: unknown } }).data
    if (data && typeof data.message === 'string' && data.message) return data.message
    if ('message' in error && typeof error.message === 'string') return error.message
  }
  return String(error)
}
