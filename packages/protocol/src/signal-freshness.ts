/** Native sample ages are measured at capture. The server/browser must add
 * elapsed delivery time; a recent message can still describe an old buffer.
 * Unknown, future or invalid clocks never certify a signal. */
export function signalSampleAge(sampledAt: string, now = Date.now()): number | null {
  const captured = Date.parse(sampledAt)
  const age = now - captured
  return Number.isFinite(captured) && Number.isFinite(age) && age >= 0 && age <= 2500 ? age : null
}

export function signalBufferIsRecent(present: boolean, bufferAge: number | null, sampleAge: number | null): boolean {
  return present && sampleAge !== null && bufferAge !== null && Number.isFinite(bufferAge)
    && bufferAge >= 0 && bufferAge + sampleAge <= 2000
}
