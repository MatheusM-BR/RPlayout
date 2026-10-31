/** A configured input is selected by its catalogue identity, never by an
 * endpoint shared with another record. The executable reference stays separate. */
export function sourceSelectionKey(source:{configuredId?:string;reference:string}):string{return source.configuredId?`configured:${source.configuredId}`:source.reference}
