/** A late result (success, error or finally) cannot commit after a newer
 * request or screen teardown. Invalidation does not abort network activity. */
export function latestRequestGate(){
  let generation=0
  return {
    begin(){const request=++generation;return ()=>request===generation},
    invalidate(){generation++},
  }
}
