import {createApp,type App} from '../app.js'
import {assertHaExecutionAdmission,type HaExecutionAdmission} from './ha-execution-admission.js'
/** Backend handoff only: no ordinary start fallback, no unarchive/TAKE,
 * MediaMTX, inherited root import, discovery or output synchronization. */
export async function createStagedHaApp(admission:HaExecutionAdmission):Promise<App>{
  assertHaExecutionAdmission(admission);admission.assertHeld()
  await admission.hostFence.freshProof();admission.assertHeld()
  return createApp(admission.copy.file,{haExecutionAdmission:admission})
}
