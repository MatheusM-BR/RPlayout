import type {OperationalSimulation} from '../api.js'

/** The published plan is what goes on air. TAKE of a live that is not in it
 * may publish on its own only when the ONLY pending change is that insertion
 * (plus the order shift it causes). Any other pending edit needs the
 * operator's own review in PROGRAMAÇÃO. */
export function liveOnlyInsertion(differences:OperationalSimulation['differences'],insertedItemId:string):boolean{
  if(differences.added.length!==1||differences.added[0]!==insertedItemId)return false
  if(differences.removed.length)return false
  if(differences.graphicsChanged?.length||differences.timingPolicyChanged)return false
  return differences.changed.every(change=>change.fields.every(field=>field==='order'))
}
