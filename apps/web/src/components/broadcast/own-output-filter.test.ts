import { expect, it } from 'vitest'
import { withoutOwnOutputs } from './CanonicalProtocolSelector.js'
const family = (refs: string[]) => ({ available: true, reason: null, sources: refs.map(reference => ({ reference, name: reference.replace(/^\w+:/, '') })) as never })
it('entrada ao vivo não oferece a saída do próprio RPlayout', () => {
  const list = { sdi: family([]), sdiOutputs: family([]), guests: family([]), ndi: family(['ndi:DESKTOP-RP4CK8E (RPLAYOUT_PGM_MASTER)', 'ndi:DESKTOP-RP4CK8E (vMix - Output 1)']), omt: family(['omt:DESKTOP-RP4CK8E (RPLAYOUT_PGM)', 'omt:DESKTOP-RP4CK8E (vMix - Output 1)']) }
  const filtered = withoutOwnOutputs(list)
  expect(filtered.ndi.sources.map(source => source.reference)).toEqual(['ndi:DESKTOP-RP4CK8E (vMix - Output 1)'])
  expect(filtered.omt.sources.map(source => source.reference)).toEqual(['omt:DESKTOP-RP4CK8E (vMix - Output 1)'])
})
