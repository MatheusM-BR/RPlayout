export interface ScheduleRuleWindow {
  id?: string
  weekdays: string
  startMinute: number
  endMinute: number
}

/** Retorna se uma nova faixa colide com outra no mesmo canal. */
export function conflictsWithScheduleRule(
  candidate: ScheduleRuleWindow,
  existing: readonly ScheduleRuleWindow[],
  ignoreId?: string,
): boolean {
  return existing.some((rule) => rule.id !== ignoreId &&
    [...candidate.weekdays].some((day) => rule.weekdays.includes(day)) &&
    candidate.startMinute < rule.endMinute && candidate.endMinute > rule.startMinute)
}
