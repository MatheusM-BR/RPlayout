/** Never fall back to downloading a full-resolution video for a monitor. */
export function lightweightPreviewUrl(asset: {id:string;contentHash:string}): string {
  return `/api/assets/${encodeURIComponent(asset.id)}/media?preview=1&hash=${encodeURIComponent(asset.contentHash)}`
}
/** QC-only opt-in, bound to both the selected edition and channel. */
export function qcQualitySelected(selection:{id:string;hash:string;channelId:string}|null,asset:{id:string;contentHash:string}|null,channelId:string,live:boolean):boolean{
  return !live && Boolean(asset && selection?.id===asset.id && selection.hash===asset.contentHash && selection.channelId===channelId)
}
/** Controls and scopes must describe the same rendition actually mounted. */
export function qcInspectionUsesFrames(playbackUrl:string|null,videoError:boolean):boolean{
  return videoError || !playbackUrl
}
/** Describe the mounted player, not a certification of original color/audio. */
export function qcMonitorLabels(live:boolean,quality:boolean,framesOnly:boolean):{image:string;audio:string}{
  if(live)return quality?{image:'inspeção ao vivo codificada',audio:'PICOS DA INSPEÇÃO'}:{image:'preview ao vivo',audio:'PICOS DO PREVIEW'}
  if(framesOnly)return {image:quality?'quadros JPEG do original':'quadros de navegação',audio:'SEM ESCUTA'}
  return quality?{image:'player do original',audio:'PICOS DO PLAYER'}:{image:'proxy leve',audio:'PICOS DO PROXY'}
}
export function qcOriginalUrl(asset:{id:string;contentHash:string}):string{
  return `/api/assets/${encodeURIComponent(asset.id)}/media?quality=original&hash=${encodeURIComponent(asset.contentHash)}`
}
export function qcQualityFrameUrl(asset:{id:string;contentHash:string},position:number):string{
  return `/api/assets/${encodeURIComponent(asset.id)}/frame/${position}.jpg?total=24&quality=original&hash=${encodeURIComponent(asset.contentHash)}`
}
