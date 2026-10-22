/** Missing rows cannot be reviewed; uncertain requests remain consultable. */
export function compensationSelectionState(itemId:string,exists:boolean,pending:boolean,hasOperation:boolean){
  const selected=Boolean(itemId)&&exists
  return {value:selected?itemId:'',canReview:selected&&!pending&&!hasOperation,showReview:selected,clearSelection:Boolean(itemId)&&!exists&&!pending&&!hasOperation}
}
