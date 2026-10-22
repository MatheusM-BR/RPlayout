import {useEffect,useState,type RefObject} from 'react'
import {containedMediaRect} from '../../domain/contained-media.js'

interface Props {
  container:RefObject<HTMLDivElement>
  getMedia:()=>HTMLVideoElement|HTMLImageElement|null
}
/** Overlay only the displayed picture, not fullscreen/letterbox matte.
 * Recalculate on container size or decoded raster changes, not every frame. */
export function QcSafeAreaOverlay({container,getMedia}:Props){
  const [rect,setRect]=useState<ReturnType<typeof containedMediaRect>>(null)
  useEffect(()=>{
    const frame=container.current,media=getMedia()
    if(!frame||!media){setRect(null);return}
    // clientWidth/clientHeight round to integer CSS pixels. Keep the content
    // box fractional so the overlay cannot protrude into the matte on resize.
    let size=frame.getBoundingClientRect()
    const update=()=>{
      const isVideo=media instanceof HTMLVideoElement
      const next=containedMediaRect(size.width,size.height,isVideo?media.videoWidth:media.naturalWidth,isVideo?media.videoHeight:media.naturalHeight)
      setRect(previous=>previous?.left===next?.left&&previous?.top===next?.top&&previous?.width===next?.width&&previous?.height===next?.height?previous:next)
    }
    update()
    const observer=new ResizeObserver(entries=>{
      const entry=entries.find(candidate=>candidate.target===frame)
      if(entry)size=entry.contentRect
      update()
    });observer.observe(frame)
    for(const event of ['loadedmetadata','loadeddata','resize','load','emptied'])media.addEventListener(event,update)
    return()=>{
      observer.disconnect()
      for(const event of ['loadedmetadata','loadeddata','resize','load','emptied'])media.removeEventListener(event,update)
    }
  },[container,getMedia])
  if(!rect)return null
  return <div data-qc-safe-area="picture" aria-hidden="true" className="absolute pointer-events-none flex items-center justify-center" style={rect}>
    <div className="w-[90%] h-[90%] border border-status-ok/30 relative">
      <span className="absolute top-0.5 left-1 text-[7.5px] font-label-mono text-status-ok/70">ACTION SAFE (90%)</span>
      <div className="absolute inset-[5.5556%] border border-status-ok/40">
        <span className="absolute top-0.5 left-1 text-[7.5px] font-label-mono text-status-ok/80">TITLE SAFE (80%)</span>
      </div>
    </div>
    <div className="absolute w-4 h-px bg-status-ok/40"/>
    <div className="absolute h-4 w-px bg-status-ok/40"/>
  </div>
}
