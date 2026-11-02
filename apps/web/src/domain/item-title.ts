/** Name shown for a grade line. A live input has no MAM asset; its grade
 * title must be shown, never the internal item id. */
export function itemDisplayTitle(entry:{item:{id:string;title?:string|null};asset?:{title?:string|null}|null}|null|undefined,fallback=''):string{
  if(!entry)return fallback
  return entry.asset?.title||entry.item.title||entry.item.id
}
