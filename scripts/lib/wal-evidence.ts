/** Read-only QA evidence, never a WAL repair/replay implementation.
 * Format/checksum: https://www.sqlite.org/fileformat2.html#the_write_ahead_log
 * A concurrent capture can end mid-frame or contain obsolete salts: only the
 * consecutive valid prefix is considered. SQLite recovery is checked separately. */
export function inspectWal(bytes:Buffer,verifyChecksums=true){
  if(bytes.length<32||bytes.length>128*1024*1024)return null
  const magic=bytes.readUInt32BE(0)
  if(![0x377f0682,0x377f0683].includes(magic)||bytes.readUInt32BE(4)!==3007000)return null
  const pageSize=bytes.readUInt32BE(8)
  if(pageSize<512||pageSize>65536||(pageSize&(pageSize-1))!==0)return null
  const word=(at:number)=>magic===0x377f0682?bytes.readUInt32LE(at):bytes.readUInt32BE(at)
  let s0=0,s1=0
  const accumulate=(from:number,to:number)=>{for(let at=from;at<to;at+=8){s0=(s0+word(at)+s1)>>>0;s1=(s1+word(at+4)+s0)>>>0}}
  accumulate(0,24)
  if(s0!==bytes.readUInt32BE(24)||s1!==bytes.readUInt32BE(28))return null
  const salt1=bytes.readUInt32BE(16),salt2=bytes.readUInt32BE(20),frames:Array<{index:number;page:number;commitDbSize:number}>=[]
  let validBytes=32,lastCommit=0
  for(let at=32;at+24+pageSize<=bytes.length;at+=24+pageSize){
    const page=bytes.readUInt32BE(at),commitDbSize=bytes.readUInt32BE(at+4)
    if(!page||bytes.readUInt32BE(at+8)!==salt1||bytes.readUInt32BE(at+12)!==salt2)break
    if(verifyChecksums){
      accumulate(at,at+8);accumulate(at+24,at+24+pageSize)
      if(s0!==bytes.readUInt32BE(at+16)||s1!==bytes.readUInt32BE(at+20))break
    }
    const index=frames.length+1;frames.push({index,page,commitDbSize});if(commitDbSize)lastCommit=index
    validBytes=at+24+pageSize
  }
  return {pageSize,frames,lastCommit,validBytes,checksumValidated:verifyChecksums,salts:[salt1,salt2]}
}
