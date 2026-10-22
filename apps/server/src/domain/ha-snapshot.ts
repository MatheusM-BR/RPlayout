import {asc,eq,inArray,or,sql} from 'drizzle-orm'
import type {App} from '../app.js'
import {asRun,channels,liveSources,operationalPlaylistRevisions,outputProfiles,operatorDecisions,secondaryEventRuns,qcDecisions,mediaAssets} from '../db/schema.js'
import {configurationRevision} from '../db/channel-configuration.js'
import {Checkpoints} from './checkpoints.js'
import type {HaSnapshot} from './ha-replication.js'
import {GraphicCommandLedger} from './graphic-command-ledger.js'
import {graphicLayers} from './graphic-composition.js'
import type {HaGraphicRecovery} from './ha-graphic-recovery.js'
import {HA_GRAPHIC_RECEIPT_PREFIX,readHaGraphicComposition} from './ha-graphic-receipts.js'
import {readHaSecondaryRuns} from './ha-secondary-journal.js'

/** Snapshot from a SQLite read transaction + the same JS turn's runtime.
 * Includes active future editions and old editions referenced by execution/
 * contingency. Editorial drafts, accounts/sessions and vault keys never travel.
 * Foreign disk paths are descriptive: the reserve must resolve media by SHA.
 */
export function captureHaSnapshot(app:App):HaSnapshot{
  return app.db.transaction(tx=>{
    const checkpoints=new Checkpoints(app.sqlite)
    const rows=tx.select().from(channels).orderBy(asc(channels.id)).all()
    const history=tx.select().from(asRun).orderBy(asc(asRun.createdAt),asc(asRun.id)).all()
    const views=rows.map(channel=>{
      const checkpoint=checkpoints.read(channel.id),runtime=app.runtimes.get(channel.id)
      const references=[checkpoint?.revisionId,checkpoint?.contingency?.revisionId,checkpoint?.contingency?.loopRevisionId,runtime?.operationalRevision?.id,...history.filter(row=>row.channelId===channel.id).map(row=>row.revisionId)].filter((id):id is string=>Boolean(id))
      const revisions=tx.select().from(operationalPlaylistRevisions).where(or(eq(operationalPlaylistRevisions.active,true),...(references.length?[inArray(operationalPlaylistRevisions.id,references)]:[]))).orderBy(asc(operationalPlaylistRevisions.id)).all().filter(row=>(row.payload as any).rundown?.channelId===channel.id)
      const assetIds=[...new Set(revisions.flatMap(row=>((row.payload as any).assets??[]).map((asset:any)=>String(asset.id))))]
      const mediaFacts=assetIds.length?tx.select().from(mediaAssets).where(inArray(mediaAssets.id,assetIds)).all():[]
      // Preserve decision chronology, including later global revocations.
      // Sorting by UUID/time instead of rowid can reverse effective approval.
      const qc=assetIds.length?tx.select().from(qcDecisions).where(inArray(qcDecisions.assetId,assetIds)).orderBy(asc(sql`rowid`)).all().filter(row=>row.channelId==='@all'||row.channelId===channel.id):[]
      const savedAt=(app.sqlite.prepare('SELECT saved_at FROM channel_checkpoints WHERE channel_id=?').get(channel.id) as {saved_at:string}|undefined)?.saved_at??null
      const graphicLedger=new GraphicCommandLedger(app.db,channel.id),sourceReceiptId=checkpoint?.graphicReceiptId??null
      let graphicRecovery:HaGraphicRecovery={version:1,status:'BLOCKED',sourceReceiptId,display:null,reason:'Composição gráfica não confirmada no espelho.'}
      try{
        if(graphicLedger.hasUnresolved())throw new Error('Comando gráfico/evento secundário sem confirmação durável.')
        if(sourceReceiptId)graphicRecovery={version:1,status:'CONFIRMED',sourceReceiptId,display:sourceReceiptId.startsWith(HA_GRAPHIC_RECEIPT_PREFIX)?readHaGraphicComposition(app.db,channel.id,sourceReceiptId):graphicLedger.confirmedDisplay(sourceReceiptId),reason:null}
        else{
          const display=runtime?.graphics.displaySnapshot()
          if(!display||graphicLedger.latestNativeCompositionId()||display.emergencySvg!==null||graphicLayers.some(key=>display.layers[key].active))throw new Error('Checkpoint sem vínculo para a composição gráfica atual.')
          graphicRecovery={version:1,status:'CLEAR',sourceReceiptId:null,display,reason:null}
        }
      }catch(error){graphicRecovery.reason=(error instanceof Error?error.message:'Composição gráfica incerta.').slice(0,1000)}
      return {channelId:channel.id,configuration:{channel,graphicRecovery,executionRevisionId:runtime?.operationalRevision?.id??null,revision:configurationRevision(tx,channel.id),outputs:tx.select().from(outputProfiles).where(eq(outputProfiles.channelId,channel.id)).orderBy(asc(outputProfiles.id)).all(),sources:tx.select().from(liveSources).where(eq(liveSources.channelId,channel.id)).orderBy(asc(liveSources.id)).all(),mediaFacts,qc},revisions,checkpoint:checkpoint?{value:checkpoint,savedAt}:null,transport:runtime?.transport.state()??null,blockers:{configuration:app.configurationChanges.status(channel.id),interrupted:app.interruptionCommands.blockedReason(channel.id),boundary:runtime?.boundaryStatus()??null,graphics:graphicRecovery.status==='BLOCKED'?graphicRecovery.reason:null}}
    })
    const commands=tx.select().from(operatorDecisions).where(inArray(operatorDecisions.kind,['CHANNEL_CONFIGURATION_SLOT','CHANNEL_CONFIGURATION_OPERATION','INTERRUPTION_COMMAND','INTERRUPTION_COMMAND_SLOT','OPERATIONAL_INSERT_COMMAND','DEVICE_COMMAND','PLAYLIST_BOUNDARY','HA_HISTORY_IMPORT','HA_HISTORY_VARIANT_REVIEW'])).orderBy(asc(operatorDecisions.id)).all()
    return {version:1,capturedAt:new Date().toISOString(),channels:views,asRun:history,journals:[...commands,...tx.select().from(secondaryEventRuns).all(),...readHaSecondaryRuns(app.db)]}
  })
}
