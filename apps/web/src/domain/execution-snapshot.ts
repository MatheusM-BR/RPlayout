/** Absence means an older server. Explicit null means operational execution
 * is blocked; it must never be replaced by the editable editorial grade. */
export function executionFromSnapshot<T>(snapshot:{view:T;executionView?:T|null}):T|null{
  return snapshot.executionView===undefined ? snapshot.view : snapshot.executionView
}
