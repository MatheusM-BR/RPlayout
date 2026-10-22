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
/** Only a failed, actually requested original JPEG can invalidate file QC.
 * Live WHEP has no JPEG URL: two nulls are not evidence of a failed frame. */
export function qcQualityFrameFailed(live:boolean,qualityFrames:boolean,requestedUrl:string|null,failedUrl:string|null):boolean{
  return !live&&qualityFrames&&Boolean(requestedUrl)&&requestedUrl===failedUrl
}
export function qcInspectionVideoHasPicture(width:number,height:number):boolean{
  return Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0
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
/** Match the finite navigation strip without passing NaN/Infinity to its URL. */
export function qcInspectionFrameAtTime(seconds:number,duration:number,total=24,original=false):number{
  if(!Number.isSafeInteger(total)||total<1)return 0
  if(!Number.isFinite(seconds)||!Number.isFinite(duration)||duration<=0)return 0
  // Native original extraction uses i/(total-1); navigation thumbnails use
  // bin midpoints. Choose the closest original point, not a thumbnail bin.
  const index=original?Math.round(seconds/duration*(total-1)):Math.floor(seconds/duration*total)
  return Math.max(0,Math.min(total-1,index))
}
