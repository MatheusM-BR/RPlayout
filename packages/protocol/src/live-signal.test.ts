import { describe, expect, it } from 'vitest'
import { assessLiveSignal } from './live-signal.js'

const now = Date.parse('2026-10-06T18:00:00Z')
const sample = { sampledAt: new Date(now).toISOString(), videoPresent: true, audioPresent: true, videoAgeMs: 50, audioAgeMs: 20 }
const input = { mode: 'NATIVE' as const, active: true, lifecycle: 'PVW_READY', sample }

describe('measured live signal independent of operational tally', () => {
  // NOT_RUN in current batch; warning must not become loss/TAKE authorization.
  it('warns on recent unchanged content, not on stale or insufficient samples',()=>{
    const measured={...sample,sampledContentUnchangedMs:2500,contentSampleAgeMs:100,contentSampleFrames:11}
    expect(assessLiveSignal({...input,sample:measured},now)).toMatchObject({status:'UNSTABLE',videoRecent:true,audioRecent:true,contentStall:{unchangedMs:2500,sampledFrames:11}})
    for(const patch of [{contentSampleAgeMs:501},{contentSampleFrames:8},{sampledContentUnchangedMs:NaN},{sampledContentUnchangedMs:1999}])expect(assessLiveSignal({...input,sample:{...measured,...patch}},now).contentStall).toBeUndefined()
    expect(assessLiveSignal({...input,sample:{...measured,audioPresent:false}},now).status).toBe('NO_AUDIO')
    expect(assessLiveSignal({...input,sample:{...measured,videoPresent:false}},now).status).toBe('NO_VIDEO')
  })
  it('channel warning policy adjusts only instability, never freshness or missing audio',()=>{
    const measured={...sample,rateNum:25,rateDen:1,receivedFrames:100,arrivalJitterMs:150}
    const policy={arrivalWarningEnabled:true,warningFrameIntervals:5,minimumReceivedFrames:50}
    expect(assessLiveSignal({...input,sample:measured,policy},now).status).toBe('SIGNAL_OK')
    expect(assessLiveSignal({...input,sample:measured,policy:{...policy,warningFrameIntervals:1}},now).status).toBe('UNSTABLE')
    expect(assessLiveSignal({...input,sample:measured,policy:{...policy,arrivalWarningEnabled:false}},now).status).toBe('SIGNAL_OK')
    expect(assessLiveSignal({...input,sample:{...measured,audioPresent:false},policy:{...policy,arrivalWarningEnabled:false}},now).status).toBe('NO_AUDIO')
    expect(assessLiveSignal({...input,sample:measured,policy:{...policy,arrivalWarningEnabled:false}},now+2100).status).toBe('NO_VIDEO')
    expect(assessLiveSignal({...input,sample:measured,policy:{...policy,warningFrameIntervals:NaN}},now).status).toBe('UNSTABLE')
  })
  it('measured decoder variation warns without rejecting fresh video or changing tally',()=>{
    const jitter={...sample,rateNum:25,rateDen:1,receivedFrames:100,arrivalJitterMs:121}
    expect(assessLiveSignal({...input,sample:jitter},now)).toMatchObject({status:'UNSTABLE',videoRecent:true,audioRecent:true,instability:{arrivalJitterMs:121,thresholdMs:120}})
    expect(assessLiveSignal({...input,sample:{...jitter,audioPresent:false}},now)).toMatchObject({status:'NO_AUDIO',instability:{arrivalJitterMs:121}})
    expect(assessLiveSignal({...input,sample:jitter},now+3000)).toMatchObject({status:'UNKNOWN'})
  })
  it.each([
    {receivedFrames:49},{rateNum:0},{rateDen:null},{arrivalJitterMs:NaN},{arrivalJitterMs:-1},{arrivalJitterMs:120},
  ])('warm-up, missing/invalid metrics and exact boundary do not invent instability (%s)',override=>{
    expect(assessLiveSignal({...input,sample:{...sample,rateNum:25,rateDen:1,receivedFrames:100,arrivalJitterMs:121,...override}},now).status).toBe('SIGNAL_OK')
  })
  it.each(['PVW_READY', 'ON_PGM', 'TAKE_PENDING'])('confirms recent video/audio for %s', lifecycle => {
    expect(assessLiveSignal({ ...input, lifecycle }, now)).toMatchObject({ status: 'SIGNAL_OK', videoRecent: true, audioRecent: true })
  })
  it('no bus is not a missing signal and simulation is not native measurement', () => {
    expect(assessLiveSignal({ ...input, active: false }, now).status).toBe('UNMONITORED')
    expect(assessLiveSignal({ ...input, mode: 'SIMULATED' }, now)).toMatchObject({ status: 'SIMULATED', videoRecent: false })
    expect(assessLiveSignal({ ...input, mode: undefined }, now).status).toBe('UNKNOWN')
  })
  it('an ACK/ready without telemetry never certifies signal', () => {
    expect(assessLiveSignal({ ...input, sample: undefined }, now).status).toBe('UNKNOWN')
    expect(assessLiveSignal({ ...input, sample: undefined, lifecycle: 'CUEING' }, now).status).toBe('CONNECTING')
    expect(assessLiveSignal({ ...input, sample: undefined, lifecycle: 'LOST' }, now).status).toBe('NO_VIDEO')
  })
  it('opening failure takes priority over old positive measurements', () => {
    expect(assessLiveSignal({ ...input, lifecycle: 'FAILED' }, now)).toMatchObject({ status: 'FAILED', videoRecent: false, audioRecent: false })
  })
  it('NO_AUDIO is independent from valid video, not a silence diagnosis', () => {
    expect(assessLiveSignal({ ...input, sample: { ...sample, audioPresent: false } }, now)).toMatchObject({ status: 'NO_AUDIO', videoRecent: true, audioRecent: false })
  })
  it('includes elapsed delivery time and does not hide measured absence behind CONNECTING', () => {
    expect(assessLiveSignal({ ...input, lifecycle: 'TAKE_PENDING', sample: { ...sample, videoAgeMs: 1500 } }, now + 600)).toMatchObject({ status: 'NO_VIDEO', videoRecent: false, audioRecent: true })
  })
  it.each([now + 1, now - 3000])('invalid/stale capture %s is UNKNOWN, not confirmed absence', captured => {
    expect(assessLiveSignal({ ...input, sample: { ...sample, sampledAt: new Date(captured).toISOString() } }, now)).toMatchObject({ status: 'UNKNOWN', videoRecent: false })
  })
})
