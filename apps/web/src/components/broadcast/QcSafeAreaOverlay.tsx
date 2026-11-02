import {useEffect,useState,type RefObject} from 'react'
import {containedMediaRect} from '../../domain/contained-media.js'

interface Props {
  container:RefObject<HTMLDivElement>
  getMedia:()=>HTMLVideoElement|HTMLImageElement|null
  /** Área de proteção 4:3 (center cut) para material que também vai a SD 4:3. */
  centerCut?:boolean
}
/** Overlay only the displayed picture, not fullscreen/letterbox matte.
 * Recalculate on container size or decoded raster changes, not every frame. */
/** SMPTE ST 2046-1 / EBU R95 para HD: action safe 93% e graphics (title) safe 90%. */
export const HD_SAFE_AREAS={action:0.93,graphics:0.90} as const
export function QcSafeAreaOverlay({container,getMedia,centerCut=false}:Props){
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
  const cutWidth=centerCut?Math.min(1,rect.height*4/3/rect.width):1
  return <div data-qc-safe-area="picture" aria-hidden="true" className="absolute pointer-events-none flex items-center justify-center" style={rect}>
    <div className="absolute border border-status-ok/45" style={{width:`${HD_SAFE_AREAS.action*100}%`,height:`${HD_SAFE_AREAS.action*100}%`}}>
      <span className="absolute top-0.5 left-1 text-[11px] font-label-mono text-status-ok/80">ACTION SAFE 93%</span>
    </div>
    <div className="absolute border border-status-ok/70" style={{width:`${HD_SAFE_AREAS.graphics*100}%`,height:`${HD_SAFE_AREAS.graphics*100}%`}}>
      <span className="absolute bottom-0.5 left-1 text-[11px] font-label-mono text-status-ok">GRAPHICS SAFE 90%</span>
    </div>
    {centerCut&&cutWidth<1&&<div className="absolute border border-dashed border-armed-amber/80" style={{width:`${cutWidth*100}%`,height:'100%'}}>
      <span className="absolute top-0.5 right-1 text-[11px] font-label-mono text-armed-amber">4:3 CENTER CUT</span>
      <div className="absolute border border-dashed border-armed-amber/50" style={{left:'5%',top:'5%',right:'5%',bottom:'5%'}}/>
    </div>}
    <div className="absolute w-4 h-px bg-status-ok/50"/>
    <div className="absolute h-4 w-px bg-status-ok/50"/>
  </div>
}
