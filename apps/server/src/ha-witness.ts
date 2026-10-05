import Fastify from 'fastify'
import {HaWitness,WitnessError} from './domain/ha-witness.js'

/** Standalone third-host service: no main DB, media, engine, users or outputs. */
async function main(){
  const file=process.env.RPLAYOUT_WITNESS_DB,clusterId=process.env.RPLAYOUT_WITNESS_CLUSTER,key=process.env.RPLAYOUT_WITNESS_KEY,nodes=(process.env.RPLAYOUT_WITNESS_NODES??'').split(',').map(value=>value.trim())
  if(!file||!clusterId||!key)throw new Error('Configure banco próprio, cluster, dois nós e chave exclusiva da testemunha.')
  const witness=new HaWitness({file,clusterId,key,nodes}),server=Fastify({logger:false,bodyLimit:4096})
  server.get('/health',async()=>witness.health())
  server.post('/lease',async(request,reply)=>{reply.header('Cache-Control','no-store');try{return witness.request(request.body)}catch(error){return reply.code(error instanceof WitnessError?error.status:400).send({error:error instanceof WitnessError?error.message:'Pedido de concessão inválido.'})}})
  let closing=false;const shutdown=async()=>{if(closing)return;closing=true;await server.close();witness.close()}
  process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown())
  try{await server.listen({host:process.env.RPLAYOUT_WITNESS_HOST??'127.0.0.1',port:Number(process.env.RPLAYOUT_WITNESS_PORT??4051)})}catch(error){witness.close();throw error}
}
main().catch(()=>{process.stderr.write('Testemunha HA não iniciada. Confira configuração, identidade, pasta, posse e porta; nenhum PGM foi aberto.\n');process.exitCode=1})
