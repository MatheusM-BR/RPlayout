/** Same canonical viewport used by on-air composition. No native render claim. */
export function fitGraphicViewport(svg:string):string{
  return svg.replace(/<svg\b[^>]*>/i,tag=>{
    const width=/\swidth\s*=\s*["']([0-9]+(?:\.[0-9]+)?)(?:px)?["']/i.exec(tag)
    const height=/\sheight\s*=\s*["']([0-9]+(?:\.[0-9]+)?)(?:px)?["']/i.exec(tag)
    const viewBox=/\bviewBox\s*=/i.test(tag)
    if(!viewBox&&(!width||!height||!Number.isFinite(Number(width[1]))||!Number.isFinite(Number(height[1]))||Number(width[1])<=0||Number(height[1])<=0))return tag
    const selfClosing=/\/\s*>$/.test(tag)
    let fitted=tag.replace(/\s(?:width|height)\s*=\s*["'][^"']*["']/gi,'').replace(/\s*\/?>$/,'')
    if(!viewBox)fitted+=` viewBox="0 0 ${width![1]} ${height![1]}"`
    return fitted+' width="1920" height="1080"'+(selfClosing?'/>':'>')
  })
}
export function graphicProbeComposition(svg:string){
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080" preserveAspectRatio="none"><g opacity="1.000">'+fitGraphicViewport(svg)+'</g></svg>'
}
