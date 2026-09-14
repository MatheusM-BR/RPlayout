export interface HorizonRule {
  weekdays: string
  startMinute: number
  endMinute: number
}

/** Decide se o preenchimento contínuo deve agir neste instante. */
export function shouldFillHorizon(now: number, end: number, lead = 5): boolean {
  return end - now <= lead
}

/** Escolhe a faixa da pauta vigente para o minuto local, se existir. */
export function activeHorizonRule(rules: readonly HorizonRule[], nowMinute: number, weekday: number): HorizonRule | null {
  return rules.find((rule) => rule.weekdays.includes(String(weekday)) && nowMinute >= rule.startMinute && nowMinute < rule.endMinute) ?? null
}
