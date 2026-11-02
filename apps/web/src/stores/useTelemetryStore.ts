import { create } from 'zustand'
import type { MeterReading } from '../types.js'

export const SILENCE_METER: MeterReading = {
  peakDbfs: [-60, -60],
  momentaryLufs: -70,
  shortTermLufs: -70,
  integratedLufs: -24,
  rangeLu: 0,
  truePeakDbtp: -60,
  gainReductionDb: 0,
  correlation: 1,
}

interface TelemetryState {
  ntpTime: string
  onAirDurationFrames: number
  elapsedFrames: number
  remainingFrames: number
  progressPercent: number
  countdownToAirFrames: number
  programMeter: MeterReading
  previewMeter: MeterReading

  setNtpTime: (time: string) => void
  setPlayhead: (
    onAirDuration: number,
    elapsed: number,
    countdownToAir?: number
  ) => void
  setMeters: (program?: MeterReading | null, preview?: MeterReading | null) => void
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  ntpTime: '00:00:00:00',
  onAirDurationFrames: 0,
  elapsedFrames: 0,
  remainingFrames: 0,
  progressPercent: 0,
  countdownToAirFrames: 0,
  programMeter: SILENCE_METER,
  previewMeter: SILENCE_METER,

  setNtpTime: (ntpTime) => set({ ntpTime }),

  setPlayhead: (onAirDuration, elapsed, countdownToAir = 0) => {
    const remaining = Math.max(0, onAirDuration - elapsed)
    const progress = onAirDuration > 0
      ? Math.min(100, Math.round((elapsed / onAirDuration) * 100))
      : 0
    set({
      onAirDurationFrames: onAirDuration,
      elapsedFrames: elapsed,
      remainingFrames: remaining,
      progressPercent: progress,
      countdownToAirFrames: countdownToAir,
    })
  },

  setMeters: (program, preview) =>
    set({
      programMeter: program ?? SILENCE_METER,
      previewMeter: preview ?? SILENCE_METER,
    }),
}))
