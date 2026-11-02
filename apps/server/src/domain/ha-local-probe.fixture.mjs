// Synthetic subprocess for runner tests, never a native media validation.
const mode=process.env.HA_LOCAL_PROBE_TEST_CASE
if(mode==='hang')setInterval(()=>{},1000)
else if(mode==='overflow')process.stdout.write('x'.repeat(1024*1024+1))
else if(mode==='nonzero'){process.stderr.write('PRIVATE_NATIVE_PATH');process.exitCode=7}
else if(mode==='invalid')process.stdout.write('{"ok":true}')
else {
  const privateEnvironment=Object.keys(process.env).filter(key=>key.toUpperCase().startsWith('RPLAYOUT_')&&!['RPLAYOUT_ENCODER','RPLAYOUT_OMT_RUNTIME'].includes(key.toUpperCase()))
  process.stdout.write(JSON.stringify({ok:true,durationNs:1_000_000_000,decodedVideoBuffers:process.pid,decodedAudioBuffers:0,video:{width:320,height:180,rateNum:25,rateDen:1,interlaceMode:'progressive'},videoCodec:privateEnvironment.length?'LEAK':'video/x-h264'}))
}
