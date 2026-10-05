export type Severity = 'INFO' | 'WARN' | 'CRITICAL'

export function severityOf(component: string, state: string, message: string | null): Severity {
  if (state === 'error' || state === 'stopped' || state === 'retrying' || state === 'failed') return 'CRITICAL'
  if (state === 'connecting' || state === 'degraded' || message) return 'WARN'
  return 'INFO'
}
