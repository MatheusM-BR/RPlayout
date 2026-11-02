import type {FastifyInstance} from 'fastify'

/** Explicit happy-path review → confirmation. Race tests keep their old proof. */
export async function reviewedPublish(server:FastifyInstance,rundownId:string) {
  const inspected=await server.inject({url:`/api/rundowns/${rundownId}/operational-simulation`})
  if(inspected.statusCode!==200)throw new Error(inspected.body)
  const {review}=inspected.json()
  return server.inject({method:'POST',url:`/api/rundowns/${rundownId}/operational-publish`,headers:{'if-match':`w/"${review.editorialRevision}"`},payload:{reviewToken:review.token}})
}
export async function reviewedRollback(server:FastifyInstance,rundownId:string,revisionId:string) {
  const {view}=(await server.inject({url:`/api/rundowns/${rundownId}`})).json()
  const header=`w/"${view.editorialRevision}"`
  const inspected=await server.inject({url:`/api/rundowns/${rundownId}/operational-rollback-review?revisionId=${encodeURIComponent(revisionId)}`,headers:{'if-match':header}})
  if(inspected.statusCode!==200)throw new Error(inspected.body)
  return server.inject({method:'POST',url:`/api/rundowns/${rundownId}/operational-rollback`,headers:{'if-match':header},payload:{revisionId,reviewToken:inspected.json().review.token}})
}
