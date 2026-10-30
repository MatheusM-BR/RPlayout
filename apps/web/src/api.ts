import {projectRestoreRequest} from './domain/project-review.js'
export interface GraphicCommandReceipt {id:string;state:'ACCEPTED'|'SENDING'|'CONFIRMED'|'SIMULATED'|'REJECTED'|'UNCERTAIN'|'REVIEWED';replayed:boolean;physicalOutputValidated:false}
export interface HaControlRequest {requestId:string;channelId:string;promotionId:string;revisionId:string|null;action:'CUE'|'TAKE';itemId:string}
export interface HaStopRequest {requestId:string;channelId:string;promotionId:string;reviewToken:string;confirmStop:true}
export interface HaExportRequest {requestId:string;channelId:string;promotionId:string;stopRequestId:string}
export interface HaReturnSendRequest {requestId:string;channelId:string;promotionId:string;exportId:string}
export interface HaReturnReviewRequest {reviewId:string;transferId:string;channelId:string;rekeyId?:string}
export interface HaReturnReviewReport {quotaBytes?:number}
export interface HaReturnSelectionRequest {planId:string;reviewId:string;rekeyId:string;transferId:string;channelId:string;editionInventoryMac:string;checkpointMac:string|null;revisionIds:string[];executionRevisionId:string;cursorPolicy:'STOPPED'|'RECEIVED_LAST_CONFIRMED';reason:string}
export interface HaReturnCandidateRequest {candidateId:string;planId:string;channelId:string}
export interface HaReturnCandidateReport {version:1;request:HaReturnCandidateRequest;phase:'ACCEPTED'|'MATERIALIZING'|'STAGED'|'FAILED';quotaBytes:number;updatedAt:string;ownedHere:boolean;confirmationIsHistorical:true;operationalReady:false;result:null|{sourceDatabaseHash:string;databaseHash:string;databaseBytes:number;vaultFingerprint:string;selectedRevisions:number;channelArchived:true;cursorStopped:true;bindingsResolved:false;nativePrepared:false;publicationAuthorized:false;authorityTransferred:false}}
export interface HaReturnSelectionReport {version:1;request:HaReturnSelectionRequest;actor:string;recordedAt:string;reviewDatabaseHash:string;phase:'SELECTION_RECORDED';source:'RETURNED_REKEYED_COPY';historyReconciled:false;mediaValidated:false;nativePrepared:false;authorityTransferred:false;publicationAuthorized:false;ownedHere:boolean;confirmationIsHistorical:true;operationalReady:false}
export interface HaReturnContentComparison {selectionBasis?:{candidates:Array<{id:string;rundownId:string;active:boolean}>;candidatesTruncated:boolean;checkpoint:{revisionId:string|null;rundownId:string|null;itemId:string|null;contingencyRevisionIds:string[]}}}
export interface HaReturnContentComparison {mediaRequirements?:{checked:number;blocked:number;liveBindingsRequired:number;details:Array<{revisionId:string;itemId:string;errors:string[];warnings:string[]}>;detailsTruncated:boolean;localBytesValidated:false;localDecodeValidated:false;bindingsSelected:false}}
export interface HaReturnContentComparison {version:1;comparison:'LOCAL_KEYED_CANONICAL_PAYLOADS';editions:{primaryCount:number;receivedCount:number;matched:number;changed:number;receivedOnly:number;primaryOnly:number;details:Array<{id:string;kind:'RECEIVED_ONLY'|'PRIMARY_ONLY'|'CHANGED';changedFields:string[]}>;detailsTruncated:boolean;inventoryMac:string;payloadsApproved:false};checkpoint:{receivedPresent:boolean;primaryPresent:boolean;comparable:true;equal:boolean;receivedMac:string|null;primaryMac:string|null;referencedEditionPresent:boolean;referencedItemPresent:boolean;cursorSelected:false;foreignOwnershipAccepted:false};contentApproved:false;publicationAuthorized:false;authorityTransferred:false}
export interface HaReturnReceipt {hasProtectedBridge?:boolean;rekeyRequestId?:string|null}
export interface HaReturnRekeyRequest {rekeyId:string;transferId:string;channelId:string}
export interface HaOwnershipEvidence {version:1;runs:number;slots:number;asRunLinks:number;inventoryHash:string;lifecycleEvidence?:{rows:number;inventoryHash:string;coverage:'DISTRIBUTION_SERVER_STORAGE_RESTORE_ACTIVATION'};sourceVaultFingerprint:string;validation:'SOURCE_SIGNATURES_CHECKED';authorityTransferred:false}
export interface HaReturnRekeyReport {version:1;request:HaReturnRekeyRequest;phase:'ACCEPTED'|'REKEYING'|'REKEYED_STAGED'|'FAILED';quotaBytes:number;updatedAt:string;ownedHere:boolean;confirmationIsHistorical:true;operationalReady:false;operationalApproved:false;publicationAuthorized:false;result:null|{sourceDatabaseHash:string;databaseHash:string;databaseBytes:number;entries:number;vaultFingerprint:string;ownershipEvidence?:HaOwnershipEvidence;installationKeyCopied:false;operationalApproved:false;publicationAuthorized:false}}
export interface HaHistoryImportRequest {importId:string;reviewId:string;transferId:string;channelId:string;records:Array<{id:string;receivedHash:string}>}
export interface HaHistoryVariantRequest {decisionId:string;reviewId:string;transferId:string;channelId:string;records:Array<{id:string;primaryHash:string;receivedHash:string|null;policy:'KEEP_PRIMARY_WITH_VARIANT';reason:string}>}
export interface HaHistoryVariantReport {decisionId:string;channelId:string;phase:'PROCESSING'|'CONFIRMED'|'NOT_REGISTERED'|'INTERRUPTED'|'COMMIT_UNCERTAIN'|'FAILED';publicationAuthorized:false;receipt:null|{version:1;request:HaHistoryVariantRequest;preserved:number;asRunModified:false;nativeUncertaintyResolved:false;historyFullyReconciled:false;publicationAuthorized:false;authorityTransferred:false;committedAt:string}}
export interface HaHistoryImportReport {importId:string;channelId:string;phase:'PROCESSING'|'CONFIRMED'|'NOT_REGISTERED'|'INTERRUPTED'|'COMMIT_UNCERTAIN'|'FAILED';publicationAuthorized:false;receipt:null|{version:1;request:HaHistoryImportRequest;imported:number;historyFullyReconciled:false;primaryApproved:false;publicationAuthorized:false;authorityTransferred:false;committedAt:string}}
export interface HaReturnReviewReport {version:1;request:HaReturnReviewRequest;phase:'ACCEPTED'|'REVIEWING'|'REVIEWED'|'FAILED';updatedAt:string;ownerRecorded:boolean;ownedHere:boolean;confirmationIsHistorical:true;operationalReady:false;baselineHash:string|null;primaryApproved:false;publicationAuthorized:false;report:null|{version:1;channelId:string;transferId:string;databaseHash:string;sourceKind?:'RECEIVED_EVIDENCE'|'REKEYED_DERIVATIVE';rekeyId?:string|null;receivedDatabaseHash?:string;protectedFields?:null|{fields:number;encodingValidated:true;contentApproved:false;contentComparison?:HaReturnContentComparison|null;vaultFingerprint:string;foreignOwnership:null|{inventoryMatched:true;sourceSignaturesAttested:true;localExecutionAuthorized:false;authorityTransferred:false};localExecutionAuthorized:false};integrity:'ok';foreignKeys:'ok';baselineChanged:boolean;schema:{current:boolean;applied:number;supportedThrough:number};history:{receivedOnly:number;changed:number;primaryOnly:number;receivedOpen:number;detailsTruncated:boolean;merged:false};blockers:string[];primaryApproved:false;publicationAuthorized:false;historyMerged:false;authorityTransferred:false;confirmationIsHistorical:true}}
export interface HaReturnSendReport {canResume:boolean;reviewToken:string|null}
export interface HaReturnResumeRequest {resumeId:string;requestId:string;channelId:string;reviewToken:string;expectedOffset:number}
export interface HaReturnResumeReport {resume:{version:1;request:HaReturnResumeRequest;actor:string;phase:'ACCEPTED'|'SENDING'|'RECEIVED_QUARANTINE'|'UNCERTAIN';updatedAt:string;restartsFromZero:false};transfer:HaReturnSendReport}
export interface HaReturnSendReport {version:1;request:HaReturnSendRequest;phase:'ACCEPTED'|'SENDING'|'RECEIVED_QUARANTINE'|'FAILED'|'UNCERTAIN';updatedAt:string;receipt:Omit<HaReturnReceipt,'confirmationIsHistorical'|'ownedHere'>|null;primaryApproved:false;publicationAuthorized:false;authorityTransferred:false;automaticRestart:false}
export interface HaReturnReceipt {version:1;transferId:string;exportId:string;promotionId:string;channelId:string;stopRequestId:string;manifestHash:string;databaseHash:string;databaseBytes:number;offset:number;phase:'ALLOCATING'|'RECEIVING'|'RECEIVED_QUARANTINE';checkedAt:string;primaryApproved:false;publicationAuthorized:false;authorityTransferred:false;physicalOutputValidated:false;confirmationIsHistorical:true;ownedHere:boolean}
export interface HaExportReport {version:1;request:HaExportRequest;phase:'ACCEPTED'|'COPYING'|'SEALED'|'FAILED';updatedAt:string;partialEvidenceRetained:true;databaseHash:string|null;databaseBytes:number|null;manifestHash:string|null;reverseSyncConfirmed:false;primaryApproved:false;publicationAuthorized:false}
export interface HaReturnPlan {stopRequestId:string|null;exportSealed:boolean;exportRequestId:string|null;canExport:boolean}
export interface HaReturnPlan {channelId:string;promotionId:string;fromNodeId:string;targetNodeId:string;stopConfirmed:boolean;assignmentRevision:number;expectedTerm:number;engineLeaseActive:boolean;unresolvedControls:number;blockers:string[];transferReady:false;publicationAuthorized:false;automaticRestart:false;reverseSyncConfirmed:false;physicalOutputValidated:false;checkedAt:string}
export interface HaStopReport {version:1;request:HaStopRequest;phase:'ACCEPTED'|'STOPPING'|'CONFIRMED'|'UNCERTAIN';actor:string;updatedAt:string;ownedResourcesStopped:boolean;storageReleased:boolean;originalControlOutcomesUnchanged:true;authorityReturnedToPrimary:false;automaticRestart:false;physicalOutputValidated:false}
export interface HaStopReview {promotionId:string;channelId:string;canStop:boolean;reviewToken:string|null;prior:HaStopReport|null;willInterruptProgram:true;authorityReturnedToPrimary:false}
export interface HaControlReport {canReconcile?:boolean;reviewToken?:string|null;reconciledFrom?:'ACCEPTED'|'SENDING'|'UNCERTAIN'}
export interface HaExecutionObservation {controls?:{revisionId:string|null;cuedItemId:string|null;items:Array<{id:string;title:string}>}|null}
export interface HaControlReport {version:1;request:HaControlRequest;phase:'ACCEPTED'|'SENDING'|'CONFIRMED'|'REFUSED'|'UNCERTAIN';actor:string;updatedAt:string;confirmationIsHistorical:true;physicalOutputValidated:false;proof?:{itemId:string;ownerId:string;term:number;programChanged:false;signalConfirmed:false}|{itemId:string;decoderId:number;ownerId:string;term:number;elapsed:number;nativeConfirmed:true}}
export interface HaMonitorRequest {requestId:string;channelId:string;promotionId:string;bus:'pvw'|'mon';on:boolean;supersedesRequestId?:string;reviewToken?:string}
export interface HaMonitorReport {version:1;request:HaMonitorRequest;phase:'ACCEPTED'|'SENDING'|'CONFIRMED'|'REFUSED'|'UNCERTAIN';actor:string;updatedAt:string;confirmationIsHistorical:true;physicalOutputValidated:false;resolvedBy:string|null;canReconcile:boolean;reviewToken:string|null;oldDeliveryConfirmed:false}
export interface HaExecutionObservation {requestId:string;channelId:string;phase:'CHECKING'|'PREPARING'|'TRANSFERRING'|'ACTIVATING'|'CONFIRMED'|'REFUSED'|'UNCERTAIN';updatedAt:string;confirmationIsHistorical:true;nativeConfirmedHistorically:boolean;localObservation:'NOT_OWNED_HERE'|'NO_TRACKED_ENGINE'|'RUNNING_LOCAL'|'NOT_READY_LOCAL';matchesHistoricalGeneration:boolean;programOutputsHeld:boolean|null;currentItemId:string|null;currentDecoderId:number|null;currentFrames:number|null;browserMonitor?:{preview:string|null;monitor:string|null;port:number}|null;mediaState?:'RUNNING'|'NOT_READY'|'STOPPED'|'FAILED'|'NOT_CONFIGURED'|'NOT_OWNED_HERE';authorityCheckedNow:false;physicalOutputValidated:false;observedAt:string}
export interface ReviewedGraphicCommand extends GraphicCommandReceipt {createdAt:string;actor:string|null;reviewToken:string}
export function graphicCommandKey():string{
  const bytes=new Uint8Array(16)
  if(!globalThis.crypto?.getRandomValues)throw new Error('Este navegador não consegue gerar uma chave segura para o comando.')
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('')
}
import {liveSourceHeaders} from './domain/live-source-review.js'
import {multiviewHeaders} from './domain/multiview-review.js'
import {scheduleRuleHeaders} from './domain/schedule-rule-review.js'
import {graphicsHeaders} from './domain/graphics-review.js'
export interface OverlaySlotState { slot: number; templateId: string; name: string; values: Record<string, string>; animated: boolean; onAir: boolean; changedAt: string; changedBy: string | null }
import {accountCatalogHeaders,accountHeaders,accountSessionHeaders} from './domain/account-review.js'
import {assetMetadataHeaders} from './domain/asset-metadata-review.js'
import {assetRemovalHeaders,removalSelection} from './domain/asset-removal-review.js'
import {rootCatalogETag,rootAddETag,type RootCatalogReview,type RootAddReview} from '@rplayout/protocol'
import {scanETag,type ScanReview,type ScanCommandResult} from '@rplayout/protocol'
import type {
  AudioLevel,
  IncidentContext,
  AudioRouting,
  AudioMixAnalysisView,
  Anchor,
  EditScope,
  EditScopeReview,
  OperationalReview,
  GraphicTemplate,
  GraphicsReview,
  AccountCatalogReview,
  AccountSessionsReview,
  ItemGraphic,
  Trim,
  ScheduleEventType,
  TimingFlags,
  LiveSourceConfig,
  ManagedLiveSource,
  LiveSourceReview,
  MultiviewReview,
  ScheduleRuleReview,
  MultiviewLayout,
  MultiviewCell,
  SrtTelemetry,
} from '@rplayout/protocol'
export interface HaPreparationRequest {requestId:string;channelId:string;sequence:number;bindingPlanId:string}
export interface UpgradeBackupReport {requestId:string;phase:'CHECKING'|'READY'|'REFUSED'|'UNCERTAIN';createdAt:string;file?:string;bytes?:number;sha256?:string;vaultFingerprint?:string;automaticTake:false;promotionReady:false;previousBackupsRemoved:false;reason:string}
export interface HaPreparationReport {
  requestId:string;channelId:string;sequence:number;bindingPlanId?:string;snapshotSequence?:number
  phase:'CHECKING'|'RESTORED'|'REFUSED';reason:string;restoredRevisions:number;verifiedMedia:number;qcBlocked:number
  localProbeRequired:boolean;promotionReady:false;automaticTake:false
  localMounts?:{checked:number;blocked:number;livePending:number;selectedMixPending:number;externalAutomationBlocked:number;graphicPending?:number;issues?:Array<{itemId:string;revisionId?:string;title?:string;errors:string[];warnings:string[];livePending:boolean}>;issuesTruncated?:boolean}
}
export interface HaBindingReview {
  channelId:string;sequence:number;basePlanId:string|null;reviewToken:string
  inputs:Array<{sourceKey:string;family:string;reference:string;items:Array<{revisionId:string;itemId:string;title:string}>}>
  outputs:Array<{outputId:string;name:string;kind:string;reference:string}>
  localInputs:Array<{key:string;label:string;family:string}>
  localSdiOutputs:Array<{key:string;label:string;family:string}>
  saved:{id:string;createdAt:string;actor:string|null;stale:boolean;inputs:Array<{sourceKey:string;localKey:string}>;outputs:Array<{outputId:string;kind:string;target:string|null;reason:string|null}>}|null
  automaticTake:false;promotionReady:false;physicalSignalValidated:false;mediaAndQcRequired:true;trimMixReviewRequired:true
}
export interface HaReturnBindingPlan {id:string;channelId:string;createdAt:string;actor:string|null;sequence:number;current:boolean;stale:boolean;inputs:Array<{sourceKey:string;localKey:string}>;outputs:Array<{outputId:string;kind:string;target:string|null;reason:string|null}>;confirmationIsHistorical:true;operationalReady:false}
export interface HaReturnBindingReport {candidate:HaReturnCandidateRequest;review:HaBindingReview;requestPlan:HaReturnBindingPlan|null;bindingsResolved:false;publicationAuthorized:false;operationalReady:false}
export interface HaReturnBindingRequest {channelId:string;candidate:HaReturnCandidateRequest;binding:{requestId:string;channelId:string;sequence:number;basePlanId:string|null;reviewToken:string;inputs:Array<{sourceKey:string;localKey:string}>;outputs:Array<{outputId:string;disposition:'LOCAL'|'DISABLED';localTarget?:string;reason?:string}>}}
export interface HaReturnApplicationRequest {applicationId:string;channelId:string;candidate:HaReturnCandidateRequest;bindingPlanId:string}
export type HaReturnRecoverableJobKind='HISTORY_IMPORT'|'HISTORY_VARIANT'|'DATABASE_REVIEW'|'REKEY'|'CANDIDATE'|'BINDING_APPLICATION'|'MEDIA_REVIEW'|'MEDIA_APPLICATION'|'POSTGAIN_REVIEW'|'BUS_REVIEW'
export interface HaReturnPendingJobs {version:1;channelId:string;kind:HaReturnRecoverableJobKind;afterId:string|null;rows:Array<{id:string;kind:HaReturnRecoverableJobKind;channelId:string;phase:'COMMITTING'|'ACCEPTED'|'EXTRACTING'|'REVIEWING'|'REKEYING'|'MATERIALIZING'|'CHECKING'|'APPLYING'|'MEASURING';updatedAt:string;ownerRecorded:boolean;ownedHere:boolean}>;scanned:number;nextCursor:string|null;snapshot:false;processStoppedProven:false;operationalReady:false;publicationAuthorized:false}
export interface HaReturnJobRecoveryRequest {recoveryId:string;kind:HaReturnRecoverableJobKind;targetId:string;channelId:string;expectedUpdatedAt:string;expectedPhase:'ACCEPTED'|'EXTRACTING'|'REVIEWING'|'REKEYING'|'MATERIALIZING'|'CHECKING'|'APPLYING'|'MEASURING';reason:string}
export interface HaReturnHistoryJobObservation {version:1;kind:'HISTORY_IMPORT'|'HISTORY_VARIANT';request:{channelId:string;importId?:string;decisionId?:string};phase:'ACCEPTED'|'EXTRACTING'|'COMMITTING'|'CONFIRMED'|'FAILED';updatedAt:string;ownedHere:boolean;ownerRecorded:true;confirmationIsHistorical:true;operationalReady:false;publicationAuthorized:false;result:null|{commitConfirmed:true}}
export interface HaReturnJobRecoveryReport {version:1;request:HaReturnJobRecoveryRequest;actor:string;recordedAt:string;phase:'INTERRUPTED_JOB_CLOSED';previousResultPreserved:true;partialFilesPreserved:true;quotaRetained:true;operationReplayed:false;publicationAuthorized:false;ownedHere:boolean;confirmationIsHistorical:true;operationalReady:false}
export interface HaReturnAutoDecisionRequest {decisionId:string;mediaReviewId:string;channelId:string;evidenceMac:string;mountKeys:string[];reason:string}
export interface HaReturnAutoOptions {version:1;mediaReviewId:string;channelId:string;evidenceMac:string;options:Array<{mountKey:string;revisionId:string;itemId:string;integratedLufs:number;lra:number;truePeakDbtp:number}>;contingencySupported:false;qcApproved:false;publicationAuthorized:false}
export interface HaReturnAutoDecisionReport {version:1;request:HaReturnAutoDecisionRequest;actor:string;recordedAt:string;reviewDatabaseHash:string;selectedMounts:number;phase:'AUTO_DECISION_RECORDED';ownedHere:boolean;confirmationIsHistorical:true;operationalReady:false;publicationAuthorized:false;qcApproved:false;postGainQualified:false;busQualified:false}
export interface HaReturnMediaReviewRequest {mediaReviewId:string;applicationId:string;channelId:string;inventoryMac?:string;mediaChoices?:Array<{contentHash:string;localAssetId:string}>}
export interface HaReturnMediaApplicationRequest {mediaApplicationId:string;mediaReviewId:string;channelId:string;autoDecisionId?:string}
export interface HaReturnPostGainReviewRequest {postGainReviewId:string;mediaApplicationId:string;channelId:string}
export interface HaReturnBusReviewRequest {busReviewId:string;mediaApplicationId:string;channelId:string}
export interface HaReturnBusReviewReport {version:1;request:HaReturnBusReviewRequest;capture:{mediaReviewId:string;mediaDatabaseHash:string;evidenceMac:string;profile:{channelId:string;targetLufs:number;ceilingDbtp:number;audioChannels:2|8|16;rate:{num:number;den:number}};profileFingerprint:string;autoDecisionId:string|null;policy?:{channelId:string;configurationRevision:number;audioChannels:2|8|16;pairs:Array<{outputPair:number;loudness:{minLufs:number;maxLufs:number}|null;maxTruePeakDbtp:number}>}|null};actor:string;phase:'ACCEPTED'|'MEASURING'|'REVIEWED'|'FAILED';quotaBytes:number;updatedAt:string;ownedHere:boolean;confirmationIsHistorical:true;operationalReady:false;publicationAuthorized:false;result:null|{runtimeHash:string;checkedAt:string;evidenceMac:string;assessment?:{required:number;withinProfile:number;failed:number;planBlocked:number;isolatedAssessmentComplete:boolean;policyFingerprint:string;configurationRevision:number}|null;summary:{required:number;measured:number;failed:number;planBlocked:number;avQualified:false;busQualified:false;transitionQualified:false;editorialApproved:false;publicationAuthorized:false}}}
export interface HaReturnPostGainReviewReport {version:1;request:HaReturnPostGainReviewRequest;capture:{mediaReviewId:string;mediaDatabaseHash:string;evidenceMac:string;profile:{channelId:string;targetLufs:number;ceilingDbtp:number;audioChannels:2|8|16;rate:{num:number;den:number}};profileFingerprint:string;autoDecisionId:string|null};actor:string;phase:'ACCEPTED'|'MEASURING'|'REVIEWED'|'FAILED';quotaBytes:number;updatedAt:string;ownedHere:boolean;confirmationIsHistorical:true;operationalReady:false;publicationAuthorized:false;result:null|{runtimeHash:string;checkedAt:string;evidenceMac:string;summary:{required:number;measured:number;failed:number;planBlocked:number;postGainQualified:false;busQualified:false;transitionQualified:false;editorialApproved:false;publicationAuthorized:false}}}
export interface HaReturnMediaApplicationReport {version:1;request:HaReturnMediaApplicationRequest;phase:'ACCEPTED'|'APPLYING'|'STAGED'|'FAILED';quotaBytes:number;updatedAt:string;ownedHere:boolean;confirmationIsHistorical:true;operationalReady:false;result:null|{applicationId:string;sourceDatabaseHash:string;databaseHash:string;databaseBytes:number;vaultFingerprint:string;bindingPlanId:string;bindingDigest:string;evidenceMac:string;selectedRevisions:number;checkedMounts:number;blockedMounts:number;livePending:number;mixPending:number;graphicPending:number;graphics?:{required:number;rendered:number;failed:number;unavailable:number;blocked:number;visualApprovalPending:number;publicationAuthorized:false};graphicRenderEvidenceApplied?:true;audio?:{required:number;measured:number;failed:number;unavailable:number;planBlocked:number;shortCuts:number;postGainQualified:false;busQualified:false;publicationAuthorized:false};audioEvidenceApplied?:true;mediaEvidenceApplied:true;outputsApplied:false;nativePrepared:false;authorityTransferred:false;publicationAuthorized:false}}
export interface HaReturnMediaOptions {version:1;applicationId:string;channelId:string;applicationDatabaseHash:string;inventoryMac:string;media:Array<{contentHash:string;kind:'VIDEO'|'AUDIO'|'STILL';titles:string[];candidates:Array<{id:string;title:string;kind:'VIDEO'|'AUDIO'|'STILL';qcStatus:string|null;ignored:boolean}>}>;physicalBytesValidated:false;operationalReady:false}
export interface HaReturnMediaReviewReport {version:1;request:HaReturnMediaReviewRequest;phase:'ACCEPTED'|'CHECKING'|'REVIEWED'|'FAILED';quotaBytes:number;updatedAt:string;ownedHere:boolean;confirmationIsHistorical:true;operationalReady:false;result:null|{applicationDatabaseHash:string;evidenceMac:string;runtimeHash:string;checkedAt:string;requiredHashes:number;verifiedHashes:number;bytesAndDecodeComplete:boolean;checkedMounts:number;blockedMounts:number;livePending:number;mixPending:number;audio?:{required:number;measured:number;failed:number;unavailable:number;planBlocked:number;shortCuts:number;postGainQualified:false;busQualified:false;publicationAuthorized:false};graphics?:{required:number;rendered:number;failed:number;unavailable:number;blocked:number;visualApprovalPending:number;publicationAuthorized:false};issues:Array<{revisionId:string;itemId:string;title?:string;errors:string[];warnings:string[];livePending:boolean}>;issuesTruncated:boolean;publicationAuthorized:false;operationalReady:false}}
export interface HaReturnApplicationReport {version:1;request:HaReturnApplicationRequest;phase:'ACCEPTED'|'APPLYING'|'STAGED'|'FAILED';quotaBytes:number;updatedAt:string;ownedHere:boolean;confirmationIsHistorical:true;operationalReady:false;result:null|{sourceDatabaseHash:string;databaseHash:string;databaseBytes:number;vaultFingerprint:string;bindingDigest:string;selectedRevisions:number;inputBindingsApplied:true;outputsApplied:false;mediaValidated:false;nativePrepared:false;authorityTransferred:false;publicationAuthorized:false}}
export interface NextPlaylistPlan {
  sourceRevisionId:string;targetRevisionId:string;sourceName:string;targetName:string;targetDate:string;firstItemTitle:string;notBeforeMs:number
}
export interface OperationalInsertionInput {requestId:string;mode:'NEXT'|'NOW';mediaId?:string;sourceId?:string;durationFrames?:number}
export interface OperationalInsertionReview {reviewToken:string;input:OperationalInsertionInput;item:{id:string;title:string};sourceRevisionId:string;conflicts:Array<{message:string;frames:number;severity:string}>;nativeEngine:boolean;estimatedTiming:true;notice:string}
export interface OperationalInsertionResult {ok:boolean;deduplicated?:boolean;run:{requestId:string;phase:string;mode:'NEXT'|'NOW';nativeProgramConfirmed:boolean;physicalOutputValidated:false};message?:string}
export interface HaMediaStatus {enabled:boolean;required:number;verified:number;ready:false;note:string;mbit:number;error:string|null;bytesReserved?:number;quotaBytes?:number}
export type HaAuthorityStatus={configured:false;nativeFencingRequired:false;physicalOutputValidated:false}|{configured:true;nativeFencingRequired:true;physicalOutputValidated:false;nodeAdmissionRequired?:boolean;explicitTransferConfigured?:boolean;leases:Array<{channelId:string;term:number;confirmedAt:string|null;error:string|null}>}
export type HaReplicationStatus={configured:false;failoverReady:false;automaticTake:false;reason:string}|{configured:true;role:'PRIMARY'|'STANDBY';nodeId:string;peerNodeId:string;clusterId:string;sequence:number;confirmedAt:string|null;checkedAt:string|null;pending:boolean;error:string|null;mirroredChannels:number;mirroredAsRun:number;capturedAt:string|null;media:HaMediaStatus;authority?:HaAuthorityStatus;automaticTake:false;failoverReady:false;reason:string}
export interface PublishedContinuityStatus {channelId:string;version:number;state:'ENABLED'|'DISABLED'|'SUSPENDED';workerState:'OFF'|'CURRENT_SERVER'|'WAITING_RECOVERY'|'OTHER_OR_UNKNOWN_SERVER';mode:'PUBLISHED_ONLY';maxLateMinutes:number;message:string;sourceRevisionId:string|null;nativeEngine:boolean;canConfigure:boolean}
export interface PublishedContinuityReview {channelId:string;version:number;sourceRevisionId:string;sourceRundownId:string;maxLateMinutes:number;nextName:string;nextRevisionId:string;token:string}
export interface SchedulePublicationStatus {channelId:string;version:number;state:'ENABLED'|'DISABLED'|'SUSPENDED';mode:'OWNED_EMPTY_DAYS';daysAhead:number;maxItems:number;workerAvailable:boolean;canConfigure:boolean;message:string;jobs:Array<{id:string;date:string;state:'RUNNING'|'READY'|'FAILED';message:string;revisionId?:string;itemCount?:number;workerState:string}>}
export interface SchedulePublicationReview {channelId:string;version:number;daysAhead:number;maxItems:number;dates:string[];occupied:Array<{id:string;date:string;name:string;owned:boolean}>;token:string}
export interface NextPlaylistRun {id:string;state:'QUEUED'|'PREPARING'|'SWITCHING'|'CONFIRMED'|'FAILED'|'CANCELLED'|'UNCERTAIN';plan:NextPlaylistPlan;message?:string;updatedAt:string;createdAt:string}
export interface NextPlaylistReview extends NextPlaylistPlan {token:string;channelId:string;firstItemId:string;sourceRundownId:string;targetRundownId:string}
export interface NextPlaylistStatus {channelId:string;nativeEngine:boolean;sourceRevisionId:string|null;current:NextPlaylistRun|null;history:NextPlaylistRun[];canConfigure:boolean;canReconcile:boolean;automaticPolicy:'ONE_REVIEWED_EOS';options:Array<{revisionId:string;revision:number;name:string;date:string}>}
import type { Channel, MediaAsset, Rundown, RundownItem, ResolveResult } from '@rplayout/protocol'
import type {
  AsRunEntry,
  Distribution,
  FillPlan,
  ScheduleRule,
  LibraryFolder,
  MediaRoot,
  OutputProfile,
  ConfigurationOperation,
  TransmissionPreset,
  Categoria,
  PlaylistEntryView,
  PlaylistFile,
  RundownView,
  ScanStatus,
  Snapshot,
  SourceList,
} from './types.js'
import {requestResult} from './domain/json-request.js'
import {editorialHeaders} from './domain/editorial-revision.js'
import {configurationHeaders} from './domain/channel-configuration.js'
import {qcDecisionHeaders,qcAssetHeaders} from './domain/qc-review.js'

/**
 * O motivo da falha, em texto que serve para alguém agir.
 *
 * O servidor responde de duas formas: `error`, que é nossa e já vem escrita
 * para gente, e `message`, que é o que o Fastify põe quando algo estourou
 * antes de chegar na rota -- é onde mora, por exemplo, a queixa do banco de
 * dados. Ler só a primeira deixava o operador com "Falha em /api/…", que não
 * diz nada e não dá para me mandar.
 *
 * Detalhe de validação vem como objeto; virar "[object Object]" na tela seria
 * pior que não mostrar, então ele é serializado.
 */
export interface OperationalRevisionSummary {
  id: string
  revision: number
  state: string
  active: boolean
  publishedBy: string | null
  publishedAt: string
  activatedAt: string | null
}

export interface ManualExternalRun {
  requestId: string
  state: 'FIRING' | 'EXECUTED' | 'FAILED' | 'CLOSED_UNCERTAIN'
  command: { deviceId: string; action: string; source?: number; destination?: number }
  result?: import('@rplayout/protocol').ExternalControlResult
  createdAt: string
  actor: string | null
  acknowledgement?: string
}

export interface CutMark { id: string; assetId: string; contentHash: string; fromMs: number; toMs: number; label: string | null; createdBy: string | null; createdAt: string; kind: 'HEAD' | 'TAIL' | 'MIDDLE'; savesMs: number; current: boolean }
export type AlignmentAction = { kind: 'INSERT'; mediaId: string } | { kind: 'DROP'; itemId: string } | { kind: 'CUT'; itemId: string; markId: string }
export interface AlignmentReview { reviewToken: string; sourceRevisionId: string; focusItemId: string; focusTitle: string; beforeStart: number | null; afterStart: number | null; deltaFrames: number; conflicts: number; beforeArrival: number | null; afterArrival: number | null; arrivalDeltaFrames: number; lines: Array<{ kind: AlignmentAction['kind']; title: string; frames: number }> }
export interface ChannelMirror { targetChannelId: string; sourceChannelId: string; createdBy: string | null; createdAt: string; lastSyncAt: string | null; lastSyncError: string | null; unlockedBy?: string | null; unlockedAt?: string | null; unlockReason?: string | null; unlockExpiresAt?: string | null }
export interface MirrorResult { channelId: string; ok: boolean; loaded?: boolean; rundownId?: string; items?: number; skippedGraphics?: number; unboundLive?: number; error?: string }

export interface HostMetricSample {
  operations?:OperationalMetricFrame
  generatedAt: string
  sampleIntervalSeconds: number
  cpu: { percent: number | null; cores: number }
  memory: { totalBytes: number; usedBytes: number; freeBytes: number; percent: number | null }
  process: { rssBytes: number; heapUsedBytes: number }
  gpu: { utilizationPercent: number | null; memoryUsedMiB: number | null; memoryTotalMiB: number | null; temperatureC: number | null; name: string | null; error: string | null }
  disk: { path: string; totalBytes: number | null; freeBytes: number | null; percentUsed: number | null; error: string | null }
  network: { receivedBytesPerSecond: number | null; sentBytesPerSecond: number | null; source: string | null; error: string | null }
}

export interface OperationalMetricFrame {
  version:1;capturedAt:string;available:boolean;channelsTruncated:boolean
  channels:Array<{
    channelId:string;rundownId:string|null;revisionId:string|null;executionId:string|null;itemId:string|null;itemName?:string|null;elapsedFrames:number|null;mode:string|null
    engine:{pid:number|null;ready:boolean;restarts:number;deaths:number;stalls:number;hasError:boolean;cpuTimeMs:number|null;memoryBytes:number|null}
    sources:Array<{sourceId:string;sourceName?:string|null;nameAmbiguous?:boolean;itemId:string;state:string;busItemIds:Partial<Record<'pgm'|'pvw',string|null>>|null;busSignals:Partial<Record<'pgm'|'pvw',import('@rplayout/protocol').LiveSignalAssessment>>|null;busCatalog?:Partial<Record<'pgm'|'pvw',{configuredSourceId:string;sourceName:string|null;identityBasis:'PUBLISHED_ITEM'|'NATIVE_DECODER'}>>}>
    outputs:Array<{outputId:string;outputName?:string|null;nameAmbiguous?:boolean;identityType?:'PROFILE'|'ENDPOINT';state:string;attempts:number;delivered:number;hasError:boolean}>
    sourcesTruncated:boolean;outputsTruncated:boolean
  }>
}
export interface OperationalMetricHistory {
  channelId:string;since:string;until?:string;nextBefore?:string|null;retainedDays:number;totalSamples:number;truncated:boolean
  samples:Array<{sampledAt:string;operations:OperationalMetricFrame|null}>
}
export interface HostMetricHistory {
  since:string;until?:string;nextBefore?:string|null;retainedDays:number;limit?:number;totalSamples:number;truncated:boolean
  samples:HostMetricSample[]
}

export interface ItemAutomationState {
  itemId:string;rundownId:string;channelId:string;editorialRevision:number
  rate:import('@rplayout/protocol').Rate;requiresPublication:boolean
  templates:GraphicTemplate[];cues:ItemGraphic[];events:import('@rplayout/protocol').SecondaryEvent[]
}
export interface OperationalSimulation {
  review:OperationalReview
  simulated: { rundown: Rundown; items: RundownItem[]; schedule: ResolveResult }
  activeRevision: number | null
  differences: { added: string[]; removed: string[]; changed: Array<{ itemId: string; fields: string[] }>; graphicsChanged?: string[]; timingPolicyChanged?: boolean }
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  return (await requestResult<T>(path,init)).body
}

const post = <T>(path: string, body: unknown): Promise<T> =>
  send<T>(path, { method: 'POST', body: JSON.stringify(body) })

export interface LiveReplacementView {
  transactionId:string;targetSourceId?:string;receipt:{phase:string}|null;prepareSent?:boolean;commitSent?:boolean;cancelSent?:boolean;closed?:boolean
  nativeProgramConfirmed:boolean;physicalOutputValidated:false;replayed?:boolean;error?:string;outcomeUnknown?:boolean
}
const liveReplacementPath=(channelId:string,suffix='')=>`/api/channels/${encodeURIComponent(channelId)}/live-replacement${suffix}`
export const api = {
  /** PREPARE: 409 bodies are returned (not thrown) so the screen can show outcome flags. */
  liveReplacementPrepare:(channelId:string,targetSourceId:string,idempotencyKey:string)=>requestResult<LiveReplacementView>(liveReplacementPath(channelId),{method:'POST',headers:{'idempotency-key':idempotencyKey},body:JSON.stringify({targetSourceId})},{acceptedStatuses:[409]}),
  liveReplacementCommand:(channelId:string,transactionId:string,operation:'commit'|'cancel'|'status')=>requestResult<LiveReplacementView>(liveReplacementPath(channelId,`/${encodeURIComponent(transactionId)}/${operation}`),{method:'POST',body:JSON.stringify(operation==='status'?{}:{confirm:true})},{acceptedStatuses:[409]}),
  executionOwnership:(id:string)=>send<import('@rplayout/protocol').OwnershipStatusView>(`/api/channels/${encodeURIComponent(id)}/execution-ownership`),
  distributionOwnership:()=>send<import('@rplayout/protocol').OwnershipStatusView>('/api/distribution/execution-ownership'),
  cadencePreview: (id:string, rate:import('@rplayout/protocol').Rate,format:Partial<Pick<Channel,'name'|'width'|'height'|'scan'|'fieldOrder'|'targetLufs'|'ceilingDbtp'>>,revision:number|undefined) => send<{report:import('@rplayout/protocol').CadenceConversionReport}>(`/api/channels/${encodeURIComponent(id)}/cadence-preview`,{method:'POST',headers:configurationHeaders(id,revision),body:JSON.stringify({rateNum:rate.num,rateDen:rate.den,format})}),
  cadenceConvert: (id:string, rate:import('@rplayout/protocol').Rate, fingerprint:string, format:Partial<Pick<Channel,'name'|'width'|'height'|'scan'|'fieldOrder'|'targetLufs'|'ceilingDbtp'>>,revision:number|undefined) => send<{applied:true;engineError:string|null;report:import('@rplayout/protocol').CadenceConversionReport}>(`/api/channels/${encodeURIComponent(id)}/cadence-convert`,{method:'POST',headers:configurationHeaders(id,revision),body:JSON.stringify({rateNum:rate.num,rateDen:rate.den,fingerprint,format,confirm:true})}),
  auditExported: (rows: number) => post<unknown>('/api/audit/exported', { rows }).catch(() => undefined),
  audit: (signal?:AbortSignal) => send<{entries:Array<{id:string;actorUsername:string|null;kind:string;itemId:string|null;createdAt:string;payload:Record<string,unknown>}>}>('/api/audit?limit=1000',{signal}),
  pgmProbeStatus: (channelId: string) =>
    send<{
      alerts: import('@rplayout/protocol').PgmProbeAlert[]
      activeAlerts: import('@rplayout/protocol').PgmProbeAlert[]
      automaticActionsEnabled: boolean
      emergencySlateActive: boolean
      lastIncidentAt?: string
      lastSampleAt?: string
      contingency?: { active: boolean; loopRevisionId: string; loopRundownId: string; rundownId: string | null; revisionId: string | null; itemId: string | null; elapsed: number; activatedAt: string } | null
      metrics: { blackDurationMs: number; freezeDurationMs: number; silenceDurationMs: number; audioDbfs: number | null }
      thresholds: { blackThresholdMs: number; silenceThresholdMs: number; freezeThresholdMs: number; silenceDbfs: number; defaultAutoAction: import('@rplayout/protocol').PgmProbeAutoAction }
    }>(`/api/v1/engineering/pgm-probe/status?channelId=${encodeURIComponent(channelId)}`),
  setPgmEmergencySlate: (channelId: string, action: 'TRIGGER' | 'RESET',key=graphicCommandKey()) =>
    send<{ ok: boolean; emergencySlateActive: boolean;graphicCommand:GraphicCommandReceipt }>('/api/v1/engineering/pgm-probe/emergency-slate',{method:'POST',headers:{'idempotency-key':key},body:JSON.stringify({channelId,action})}),
  setPgmProbePolicy: (channelId: string, automaticActions: boolean, defaultAutoAction?: import('@rplayout/protocol').PgmProbeAutoAction) => post<{ ok: boolean }>('/api/v1/engineering/pgm-probe/policy', { channelId, automaticActions, ...(defaultAutoAction ? { thresholds: { defaultAutoAction } } : {}) }),
  contingencyLoop: (channelId: string) => send<{ loopRevisionId: string | null; origin: { active: boolean; rundownId: string | null; itemId: string | null; elapsed: number } | null; nativeEngine: boolean; options: Array<{ revisionId: string; revision: number; rundownId: string; name: string; date: string }> }>(`/api/v1/engineering/pgm-probe/contingency-loop?channelId=${encodeURIComponent(channelId)}`),
  setContingencyLoop: (channelId: string, action: 'CONFIGURE' | 'ENTER' | 'RETURN', revisionId?: string | null) => post<{ ok: true }>('/api/v1/engineering/pgm-probe/contingency-loop', { channelId, action, ...(revisionId !== undefined ? { revisionId } : {}) }),
  session: (signal?:AbortSignal) => send<{ role: string; label: string; authenticated: boolean; required: boolean }>('/api/session',{signal}),
  logout: () => post<{ ok: true }>('/api/auth/logout', {}),
  users: (signal?:AbortSignal) => send<AccountCatalogReview>('/api/users/review',{signal}),
  addUser: (body: { username: string; password: string; role: string },review:AccountCatalogReview) => send<AccountCatalogReview&{applied:true;requiresLogin:boolean}>('/api/users', {method:'POST',headers:accountCatalogHeaders(review),body:JSON.stringify(body)}),
  patchUser: (id: string, body: Record<string, unknown>,review:AccountCatalogReview) => send<AccountCatalogReview&{applied:true;requiresLogin:boolean}>(`/api/users/${encodeURIComponent(id)}`, { method: 'PATCH',headers:accountHeaders(review,id), body: JSON.stringify(body) }),
  userSessions: (id:string,signal?:AbortSignal)=>send<AccountSessionsReview>(`/api/users/${encodeURIComponent(id)}/sessions`,{signal}),
  revokeUserSessions: (id: string,review:AccountSessionsReview) => send<AccountSessionsReview&{applied:true;requiresLogin:boolean;revokedCount:number}>(`/api/users/${encodeURIComponent(id)}/sessions`, { method: 'DELETE',headers:accountSessionHeaders(review,id) }),
  userAccess: (id: string, body: { channelIds: string[] | null; stationIps: string[] | null },review:AccountCatalogReview) => send<AccountCatalogReview&{applied:true;requiresLogin:boolean}>(`/api/users/${encodeURIComponent(id)}/access`, { method: 'PUT',headers:accountHeaders(review,id), body: JSON.stringify(body) }),
  integrations: (channelId?: string,signal?:AbortSignal) => send<{ integrations: Array<{ id: string; name: string; url: string; events: string[]; enabled: boolean; channelId: string | null }> }>(`/api/integrations${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ''}`,{signal}),
  integrationCatalogReview:(channelId:string|null,signal?:AbortSignal)=>send<IntegrationCatalogReview>(`/api/integrations/review${channelId?`?channelId=${encodeURIComponent(channelId)}`:''}`,{signal}),
  integrationReview:(id:string,signal?:AbortSignal)=>send<IntegrationReview>(`/api/integrations/${encodeURIComponent(id)}/review`,{signal}),
  integrationDeliveryReview:(id:string,signal?:AbortSignal)=>send<IntegrationDeliveryReview>(`/api/integration-deliveries/${encodeURIComponent(id)}/review`,{signal}),
  addIntegration: (body: { channelId: string | null; name: string; url: string; events: string[] },review:IntegrationCatalogReview) => send<{applied:true}>('/api/integrations',{method:'POST',headers:{'if-match':integrationCatalogETag(review)},body:JSON.stringify(body)}),
  patchIntegration: (id: string, body: Record<string, unknown>,review:IntegrationReview) => send<IntegrationReview&{applied:true}>(`/api/integrations/${encodeURIComponent(id)}`, { method: 'PATCH',headers:{'if-match':review.id===id?integrationETag(review):'invalid'}, body: JSON.stringify(body) }),
  testIntegration: (id: string,review:IntegrationReview,requestId:string) => send<{queued:true;deliveryId:string;state:string;deduplicated:boolean}>(`/api/integrations/${encodeURIComponent(id)}/test`,{method:'POST',headers:{'if-match':review.id===id?integrationETag(review):'invalid'},body:JSON.stringify({requestId})}),
  integrationDeliveries: (channelId: string,signal?:AbortSignal) => send<{ deliveries: import('@rplayout/protocol').IntegrationDeliverySummary[];limit:number;deliverySemantics:string }>(`/api/integration-deliveries?channelId=${encodeURIComponent(channelId)}`,{signal}),
  retryIntegrationDelivery: (id: string,review:IntegrationDeliveryReview,confirmedPreviousStopped=false) => send<{queued:true;applied:true}>(`/api/integration-deliveries/${encodeURIComponent(id)}/retry`,{method:'POST',headers:{'if-match':review.id===id?integrationDeliveryETag(review):'invalid'},body:JSON.stringify({confirmedPreviousStopped})}),
  state: (signal?:AbortSignal) => send<{ channels: Channel[]; rundowns: Rundown[] }>('/api/state',{signal}),
  patchChannel: (
    id: string,
    body: {
      name?: string
      width?: number
      height?: number
      rateNum?: number
      rateDen?: number
      scan?: string
      fieldOrder?: string
      targetLufs?: number
      ceilingDbtp?: number
      audioChannels?:2|8|16
      expectedAudioChannels?:2|8|16
    },
    revision:number|undefined,
  ) =>
    send<{ ok: boolean; restarted?: boolean; formatChanged: boolean;engineError:string|null;configurationRevision:number }>(`/api/channels/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers:configurationHeaders(id,revision),
      body: JSON.stringify(body),
    }),
  channelConfiguration:(id:string)=>send<{channel:Channel}>(`/api/channels/${encodeURIComponent(id)}/configuration`),
  addChannel: (name: string) =>
    post<{ channelId: string; rundownId: string }>('/api/channels', { name }),
  assets: () => send<{ assets: MediaAsset[] }>('/api/assets'),
  qcAssessment: (id: string, channelId: string) => send<{ contentHash: string; review:import('@rplayout/protocol').QcReview;profile: import('@rplayout/protocol').QcProfile; checks: ReturnType<typeof import('@rplayout/protocol').assessQc>; decisions: Array<{ channelId:string;status: string; notes: string | null; createdAt: string }> }>(`/api/assets/${encodeURIComponent(id)}/qc?channelId=${encodeURIComponent(channelId)}`),
  qcDecision: (id: string, body: { channelId: string; contentHash: string; status: 'PENDING' | 'ANALYSIS' | 'APPROVED' | 'APPROVED_WITH_NOTES' | 'REJECTED' | 'BLOCKED'; notes?: string },review:import('@rplayout/protocol').QcReview|undefined) => send<{ok:true;refreshError:string|null}>(`/api/assets/${encodeURIComponent(id)}/qc`,{method:'POST',headers:qcDecisionHeaders(id,body.channelId,body.contentHash,review),body:JSON.stringify(body)}),
  qcProfile: (channelId: string) => send<{ profile: import('@rplayout/protocol').QcProfile;configurationRevision:number }>(`/api/channels/${encodeURIComponent(channelId)}/qc-profile`),
  setQcProfile: (channelId: string, profile: import('@rplayout/protocol').QcProfile,revision:number|undefined) => send<{ message: string;configurationRevision:number;refreshError:string|null }>(`/api/channels/${encodeURIComponent(channelId)}/qc-profile`, { method: 'PUT',headers:configurationHeaders(channelId,revision), body: JSON.stringify(profile) }),
  interruptions: (channelId: string) => send<{ items: Array<{ id: string; item_id: string; title: string; frames: number; state: string; revision_id: string | null;reviewToken:string;canReconcile:boolean;operation:{requestId:string;phase:string;message:string|null}|null }> }>(`/api/channels/${encodeURIComponent(channelId)}/interruptions`),
  resolveInterruption: (channelId: string, id: string, action: 'RESUME' | 'DISCARD',requestId:string,reviewToken:string) => post<{ok:true;run:{phase:string;nativeProgramConfirmed:boolean;message:string|null};deduplicated:boolean}>(`/api/channels/${encodeURIComponent(channelId)}/interruptions/${encodeURIComponent(id)}`, { action,requestId,reviewToken }),
  acknowledgeInterruption:(channelId:string,id:string,requestId:string,reviewToken:string)=>post(`/api/channels/${encodeURIComponent(channelId)}/interruptions/${encodeURIComponent(id)}/acknowledge`,{requestId,reviewToken,confirm:true}),
  reviewLiveDuration:(channelId:string,input:{itemId:string;expectedFrames:number;deltaSeconds:number})=>send<{reviewToken:string;input:typeof input}>(`/api/channels/${encodeURIComponent(channelId)}/live-duration-review?${new URLSearchParams({itemId:input.itemId,expectedFrames:String(input.expectedFrames),deltaSeconds:String(input.deltaSeconds)})}`),
  reviewOperationalCompensation:(channelId:string,input:import('@rplayout/protocol').OperationalCompensationInput)=>post<import('@rplayout/protocol').OperationalCompensationReview>(`/api/channels/${encodeURIComponent(channelId)}/compensation-review`,input),
  operationalCompensationReceipt:(channelId:string,requestId:string)=>send<{state:'RECORDED'|'NOT_RECORDED';requestId:string;revision?:number;currentExecutionObserved:false}>(`/api/channels/${encodeURIComponent(channelId)}/compensation/${encodeURIComponent(requestId)}`),
  applyOperationalCompensation:(channelId:string,body:{input:import('@rplayout/protocol').OperationalCompensationInput;requestId:string;reviewToken:string})=>post<{revision:number;deduplicated:boolean;applied:true;refreshError:string|null}>(`/api/channels/${encodeURIComponent(channelId)}/compensation`,body),
  adjustLiveDuration:(channelId:string,body:{input:{itemId:string;expectedFrames:number;deltaSeconds:number};requestId:string;reviewToken:string})=>post<{revision:number;deduplicated:boolean;applied:true;refreshError:string|null}>(`/api/channels/${encodeURIComponent(channelId)}/live-duration`,body),
  mediaWorkflow: (id: string, hash?:string,signal?:AbortSignal) => send<{ previewReady: boolean; previewUrl: string | null; versions: Array<{ id: string; revision: number; content_hash: string; jobs: Array<{ id: string; kind: string; state: string; error: string | null;retryRequiresConfirmation:boolean;ownershipMessage:string|null }> }> }>(`/api/assets/${encodeURIComponent(id)}/workflow${hash===undefined?'':`?hash=${encodeURIComponent(hash)}`}`,{signal}),
  retryMediaJob: (id: string,confirmedPreviousStopped=false) => post<{ ok: boolean }>(`/api/media/jobs/${encodeURIComponent(id)}/retry`, {confirmedPreviousStopped}),
  library: (channelId?: string,signal?:AbortSignal) => send<{ folders: LibraryFolder[]; roots: MediaRoot[] }>(`/api/library${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ''}`,{signal}),
  pickMediaRoot: async () => {
    const {status,body}=await requestResult<{root:MediaRoot;scanning:boolean}>('/api/library/roots/pick',{method:'POST'})
    if(status===204)return null
    return body
  },
  recordingTarget: (folder: string, filename: string) => post<{ path: string }>('/api/files/target', { folder, filename }),

  assetMetadataReview:(id:string,signal?:AbortSignal)=>send<import('@rplayout/protocol').AssetMetadataReview>(`/api/assets/${encodeURIComponent(id)}/metadata-review`,{signal}),
  patchAssetMetadata:(id:string,body:{title?:string;categoryId?:string|null},review:import('@rplayout/protocol').AssetMetadataReview)=>
    send<import('@rplayout/protocol').AssetMetadataReview&{applied:true;automaticTake:false;refreshError:string|null}>(`/api/assets/${encodeURIComponent(id)}/metadata`,{method:'PATCH',headers:assetMetadataHeaders(id,review),body:JSON.stringify(body)}),
  patchAsset: (id: string, body: { title?: string; categoryId?: string | null; ignored?: boolean; qcStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'FAILED'; qcNotes?: string | null },qcRevision?:number) => {
    const metadata=body.title!==undefined||body.categoryId!==undefined,qc=body.qcStatus!==undefined||body.ignored!==undefined||body.qcNotes!==undefined
    if(metadata&&qc)throw new Error('Salve metadados e decisão QC separadamente, cada um com sua conferência.')
    return send<{ ok?: true;applied?:true;refreshError:string|null }>(`/api/assets/${encodeURIComponent(id)}`, { method: 'PATCH',headers:metadata?assetMetadataHeaders(id,{assetId:id,revision:qcRevision!}):qc?qcAssetHeaders(id,qcRevision):undefined, body: JSON.stringify(body) })
  },
  /**
   * Tira do acervo. Arquivo em uso responde conflito em vez de sair calado --
   * a grade que aponta para ele perderia a referência.
   */
  assetRemovalReview:(id:string|null,signal?:AbortSignal)=>send<import('@rplayout/protocol').AssetRemovalReview>(id===null?'/api/assets/prune-review':`/api/assets/${encodeURIComponent(id)}/removal-review`,{signal}),
  removeAssets:(id:string|null,review:import('@rplayout/protocol').AssetRemovalReview,ids:string[],acknowledged:boolean)=>
    send<{applied:true;removed:number;removedItems:number;clearedFallbacks:number;filesPreserved:true;historyPreserved:true;automaticTake:false;refreshError:string|null}>(id===null?'/api/assets/prune':`/api/assets/${encodeURIComponent(id)}`,{method:id===null?'POST':'DELETE',headers:assetRemovalHeaders(id,review),body:JSON.stringify(removalSelection(review,ids,acknowledged))}),
  /** Levanta o canal de novo, para os perfis de saída de agora valerem. */
  restartChannel: (id: string) => post<{ ok: true }>(`/api/channels/${id}/restart`, {}),
  channelProgramming:(id:string)=>send<{mirror:ChannelMirror|null;mirrorsFrom:ChannelMirror[];canShare:boolean}>(`/api/channels/${encodeURIComponent(id)}/programming`),
  copyRundownToChannel:(id:string,body:{copyFromRundownId:string;date?:string;name?:string})=>post<{rundownId:string;items:number;skippedGraphics:number;liveItems:number;unboundLive:number}>(`/api/channels/${encodeURIComponent(id)}/copy-rundown`,body),
  cutMarks:(assetId:string)=>send<{marks:CutMark[]}>(`/api/assets/${encodeURIComponent(assetId)}/cut-marks`),
  cutMarksFor:(assetIds:readonly string[])=>send<{marks:CutMark[]}>(`/api/cut-marks?assetIds=${assetIds.map(encodeURIComponent).join(',')}`),
  addCutMark:(assetId:string,body:{channelId:string;contentHash:string;fromMs:number;toMs:number;label?:string|null})=>send<{mark:CutMark}>(`/api/assets/${encodeURIComponent(assetId)}/cut-marks`,{method:'POST',body:JSON.stringify(body)}),
  removeCutMark:(assetId:string,markId:string,channelId:string)=>send<{ok:true}>(`/api/assets/${encodeURIComponent(assetId)}/cut-marks/${encodeURIComponent(markId)}`,{method:'DELETE',body:JSON.stringify({channelId})}),
  alignmentReview:(channelId:string,input:{focusItemId:string;actions:AlignmentAction[]})=>send<AlignmentReview>(`/api/channels/${encodeURIComponent(channelId)}/alignment-review`,{method:'POST',body:JSON.stringify(input)}),
  applyAlignment:(channelId:string,input:{focusItemId:string;actions:AlignmentAction[]},requestId:string,reviewToken:string)=>send<{revision:number;deduplicated:boolean;deltaFrames:number;applied:boolean;refreshError:string|null}>(`/api/channels/${encodeURIComponent(channelId)}/alignment`,{method:'POST',body:JSON.stringify({input,requestId,reviewToken})}),
  unlockChannelMirror:(id:string,reason:string,duration:'1h'|'4h'|'manual'='4h')=>send<{mirror:ChannelMirror}>(`/api/channels/${encodeURIComponent(id)}/mirror/unlock`,{method:'POST',body:JSON.stringify({reason,duration})}),
  lockChannelMirror:(id:string)=>send<{mirror:ChannelMirror;onMirror:boolean}>(`/api/channels/${encodeURIComponent(id)}/mirror/lock`,{method:'POST',body:'{}'}),
  setChannelMirror:(id:string,sourceChannelId:string|null)=>send<{mirror:ChannelMirror|null;initial:MirrorResult|null}>(`/api/channels/${encodeURIComponent(id)}/mirror`,{method:'PUT',body:JSON.stringify({sourceChannelId})}),
  warmContinuityCache: (channelId?: string) => post<{ ok: boolean; cached48h: number; missing48h: number }>(`/api/v1/continuity/cache/warm${channelId ? '?channelId=' + encodeURIComponent(channelId) : ''}`, {}),
  continuityCacheStatus: (channelId?: string) => send<import('@rplayout/protocol').ContinuityCacheStatus>(`/api/v1/continuity/cache/status${channelId ? '?channelId=' + encodeURIComponent(channelId) : ''}`),
  removeChannel: (id: string) =>
    send<{ ok: true; archived: true; historyPreserved: true }>(`/api/channels/${id}`, { method: 'DELETE' }),
  archivedChannels: () => send<{channels:Channel[]}>('/api/channels/archived'),
  reactivateChannel: (id:string) => post<{ok:true;archived:false;automaticTake:false}>(`/api/channels/${encodeURIComponent(id)}/reactivate`,{}),
  channelProjects: (channelId: string) =>
    send<{ projects: Array<{ id: string; label: string; createdAt: string }> }>(`/api/channels/${encodeURIComponent(channelId)}/projects`),
  saveChannelProject: (channelId: string, label: string) =>
    post<{ project: { id: string; label: string; createdAt: string }; projects: Array<{ id: string; label: string; createdAt: string }> }>(`/api/channels/${encodeURIComponent(channelId)}/projects`, { label }),
  reviewChannelProject:(channelId:string,projectId:string)=>send<{review:import('@rplayout/protocol').ProjectRestoreReview}>(`/api/channels/${encodeURIComponent(channelId)}/projects/${encodeURIComponent(projectId)}/restore-review`),
  restoreChannelProject: (channelId: string, projectId: string,review:import('@rplayout/protocol').ProjectRestoreReview) =>
    send<{ ok: true; applied:true; engineError?:string; configurationUncertain?:boolean; restored: { label: string; createdAt: string; rundowns: number } }>(`/api/channels/${encodeURIComponent(channelId)}/projects/${encodeURIComponent(projectId)}/restore`, {method:'POST',...projectRestoreRequest(channelId,projectId,review)}),
  scanStatus: (signal?:AbortSignal) => send<ScanStatus>('/api/library/scan',{signal}),
  mediaRoots: () => send<{ roots: MediaRoot[] }>('/api/library/roots'),
  rootCatalogReview:(signal?:AbortSignal)=>send<RootCatalogReview>('/api/library/roots/review',{signal}),
  rootAddReview:(path:string,signal?:AbortSignal)=>send<RootAddReview>(`/api/library/roots/add-review?path=${encodeURIComponent(path)}`,{signal}),
  browseMediaRoot: (path?: string,signal?:AbortSignal) =>
    send<import('./types.js').ServerFolderBrowser>(`/api/library/roots/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`,{signal}),
  /**
   * Lê uma lista arrastada para a janela.
   *
   * Vai o conteúdo, não o caminho: o navegador não entrega o caminho de um
   * arquivo arrastado, e é por isso que este caminho existe separado do que
   * lê as listas que moram na pasta do acervo.
   */
  readPlaylist: (name: string, text: string) =>
    post<{ name: string; date: string | null; entries: PlaylistEntryView[]; missing: number }>(
      '/api/playlists/read',
      { name, text },
    ),
  addMediaRoot: (path:string,label:string|undefined,review:RootAddReview) =>
    send<{root:MediaRoot;scanning:boolean;scanRequired:boolean;scanBatchId:string|null;scanState:string|null;scanError?:string;applied:true;review:RootCatalogReview}>('/api/library/roots',{method:'POST',headers:{'if-match':rootAddETag(review)},body:JSON.stringify({path,label})}),
  removeMediaRoot: (id:string,review:RootCatalogReview) =>
    send<{ok:true;applied:true;review:RootCatalogReview}>(`/api/library/roots/${encodeURIComponent(id)}`, {method:'DELETE',headers:{'if-match':rootCatalogETag(review)}}),
  outputs: (channelId: string,signal?:AbortSignal) =>
    send<{ outputs: OutputProfile[];configurationRevision:number;configurationOperation:ConfigurationOperation }>(`/api/channels/${encodeURIComponent(channelId)}/outputs`,{signal}),
  reconcileConfiguration:(channelId:string,runId:string,revision:number|undefined)=>send<{ok:true;reconciled:true;automaticTake:false}>(`/api/channels/${encodeURIComponent(channelId)}/configuration-operation/reconcile`,{method:'POST',headers:configurationHeaders(channelId,revision),body:JSON.stringify({runId,confirm:true})}),
  addOutput: (channelId: string, body: { name: string; kind: string; target: string;bitrateKbps?:number|null;enabled?:boolean },revision:number|undefined) =>
    send<{ restartRequired: boolean;configurationRevision:number;engineError?:string|null;configurationUncertain?:boolean }>(`/api/channels/${encodeURIComponent(channelId)}/outputs`,{method:'POST',headers:configurationHeaders(channelId,revision),body:JSON.stringify(body)}),
  patchOutput: (id: string, body: Record<string, unknown>,channelId:string,revision:number|undefined) =>
    send<{ ok: boolean;restartRequired:boolean;configurationRevision:number;engineError?:string|null;configurationUncertain?:boolean }>(`/api/outputs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers:configurationHeaders(channelId,revision),
      body: JSON.stringify(body),
    }),
  removeOutput: (id: string,channelId:string,revision:number|undefined) => send<{ ok: boolean;engineError?:string|null;configurationRevision:number }>(`/api/outputs/${encodeURIComponent(id)}`, { method: 'DELETE',headers:configurationHeaders(channelId,revision) }),
  transmissionPresets: (channelId: string) =>
    send<{ presets: TransmissionPreset[];configurationRevision:number }>(`/api/channels/${encodeURIComponent(channelId)}/transmission-presets`),
  addTransmissionPreset: (channelId: string, body: { name: string; kind: 'SRT' | 'RTMP'; target: string },revision:number|undefined) =>
    send<{ preset: TransmissionPreset;configurationRevision:number;applied:true }>(`/api/channels/${encodeURIComponent(channelId)}/transmission-presets`,{method:'POST',headers:configurationHeaders(channelId,revision),body:JSON.stringify(body)}),
  applyTransmissionPreset: (channelId: string, presetId: string,revision:number|undefined) =>
    send<{ restartRequired: boolean;configurationRevision:number;applied:true;engineError:string|null }>(`/api/channels/${encodeURIComponent(channelId)}/transmission-presets/${encodeURIComponent(presetId)}/apply`,{method:'POST',headers:configurationHeaders(channelId,revision),body:JSON.stringify({})}),
  removeTransmissionPreset: (channelId: string, presetId: string,revision:number|undefined) =>
    send<{ ok: true;configurationRevision:number;applied:true }>(`/api/channels/${encodeURIComponent(channelId)}/transmission-presets/${encodeURIComponent(presetId)}`, { method: 'DELETE',headers:configurationHeaders(channelId,revision) }),
  /** `measure` desligado lê muito mais rápido e deixa a loudness para depois. */
  scanReview:(signal?:AbortSignal)=>send<ScanReview>('/api/library/scan/review',{signal}),
  recoverScan:(batchId:string,review:ScanReview)=>send<ScanCommandResult>('/api/library/scan/recover',{method:'POST',headers:{'if-match':scanETag(review)},body:JSON.stringify({batchId,requestId:review.operationId})}),
  scan: (measure:boolean,review:ScanReview,root?:string) =>
    send<ScanCommandResult>('/api/library/scan', {
      method: 'POST',
      headers:{'if-match':scanETag(review)},
      body: JSON.stringify({measure,requestId:review.operationId,root}),
    }),
  /** `refresh` força uma varredura nova em vez de usar o resultado guardado. */
  sources: (refresh = false,channelId?:string) => {const query=[...(refresh?['refresh=1']:[]),...(channelId?[`channelId=${encodeURIComponent(channelId)}`]:[])];return send<SourceList>(`/api/sources${query.length?'?'+query.join('&'):''}`)},
  /** Fontes configuradas para o multiview; não inventa feeds de demonstração. */
  liveSources: (channelId: string,signal?:AbortSignal) =>
    send<ManagedLiveSource[]>(`/api/sources/live?channelId=${encodeURIComponent(channelId)}`,{signal}),
  liveSourceReview:(channelId:string)=>send<LiveSourceReview>(`/api/channels/${encodeURIComponent(channelId)}/live-source-review`),
  multiviewReview:(channelId:string|null)=>send<MultiviewReview>(`/api/multiview/config${channelId===null?'':`?channelId=${encodeURIComponent(channelId)}`}`),
  saveMultiview:(channelId:string|null,layout:MultiviewLayout,review:MultiviewReview|null,cells?:MultiviewCell[])=>send<MultiviewReview&{applied:true;refreshError?:string}>('/api/multiview/config',{method:'PUT',headers:multiviewHeaders(review,channelId),body:JSON.stringify({...(channelId===null?{}:{channelId}),layout,...(cells===undefined?{}:{cells})})}),
  reviewOperationalInsertion:(channelId:string,input:OperationalInsertionInput)=>post<OperationalInsertionReview>(`/api/channels/${encodeURIComponent(channelId)}/operational-insert/review`,input),
  operationalInsertion:(channelId:string,review:OperationalInsertionReview)=>post<OperationalInsertionResult>(`/api/channels/${encodeURIComponent(channelId)}/operational-insert`,{input:review.input,reviewToken:review.reviewToken,confirm:true}),
  operationalInsertionStatus:(channelId:string,requestId:string)=>send<{run:OperationalInsertionResult['run']&{message?:string};configurationOperation:{state:string;reason:string|null};automaticTake:false}>(`/api/channels/${encodeURIComponent(channelId)}/operational-insert/${encodeURIComponent(requestId)}`),
  createLiveSource: (body: {
    channelId: string
    name: string
    kind: 'SRT' | 'RTMP' | 'SDI' | 'NDI' | 'OMT'
    targetUrl: string
    srtConfig?: unknown
    failoverConfig?: unknown
  },review:LiveSourceReview|null) => send<ManagedLiveSource & {applied:true;revision:number;refreshError:string|null}>('/api/sources/live',{method:'POST',headers:liveSourceHeaders(review,body.channelId),body:JSON.stringify(body)}),
  updateLiveSource: (id: string, body: Partial<{
    name: string
    kind: 'SRT' | 'RTMP' | 'SDI' | 'NDI' | 'OMT'
    targetUrl: string
    enabled: boolean
  }>,review:LiveSourceReview|null) =>
    send<ManagedLiveSource & {applied:true;revision:number;refreshError:string|null}>(`/api/sources/live/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers:liveSourceHeaders(review,review?.channelId??'',id),
      body: JSON.stringify(body),
    }),
  deleteLiveSource: (id: string,review:LiveSourceReview|null) =>
    send<{ok:true;applied:true;revision:number;refreshError:string|null}>(`/api/sources/live/${encodeURIComponent(id)}`, { method: 'DELETE',headers:liveSourceHeaders(review,review?.channelId??'',id) }),
  /** Telemetria recebida pelo manager SRT, indexada pelo id da fonte. */
  srtTelemetry: (signal?:AbortSignal) => send<Record<string, SrtTelemetry>>('/api/srt/telemetry',{signal}),
  triggerFailover: (sourceId: string, targetRole: 'PRIMARY' | 'BACKUP', reason?: string) =>
    post<{ ok: boolean; event: { sourceId: string; fromRole: string; toRole: string; reason: string; timestamp: string } }>('/api/engineering/failover/trigger', { sourceId, targetRole, reason }),
  rundown: (id: string,signal?:AbortSignal) => send<Snapshot>(`/api/rundowns/${encodeURIComponent(id)}`,{signal}),
  operationalRevisions: (id: string,signal?:AbortSignal) => send<{ revisions: OperationalRevisionSummary[] }>(`/api/rundowns/${encodeURIComponent(id)}/operational-playlists`,{signal}),
  simulateOperationalPlaylist: (id: string,signal?:AbortSignal) => send<OperationalSimulation>(`/api/rundowns/${encodeURIComponent(id)}/operational-simulation`,{signal}),
  saveProtectedZones: (id: string, zones: readonly import('@rplayout/protocol').ProtectedTimingZone[], expectedZones: readonly import('@rplayout/protocol').ProtectedTimingZone[],revision:number|undefined) => send<Snapshot & { publicationRequired: boolean }>(`/api/rundowns/${encodeURIComponent(id)}/protected-zones`, { method: 'PUT',headers:editorialHeaders(revision), body: JSON.stringify({ zones, expectedZones }) }),
  reviewOperationalRollback: (id:string,revisionId:string,editorialRevision:number,signal?:AbortSignal) => send<OperationalSimulation & {sourceRevision:number}>(`/api/rundowns/${encodeURIComponent(id)}/operational-rollback-review?revisionId=${encodeURIComponent(revisionId)}`,{headers:editorialHeaders(editorialRevision),signal}),
  rollbackOperationalPlaylist: (id: string, revisionId: string,editorialRevision:number,reviewToken:string) => send<((Snapshot & {snapshotAvailable:true})|{snapshotAvailable:false}) & {revision:number;applied:true;executionUpdated:boolean|null;refreshError:string|null}>(`/api/rundowns/${encodeURIComponent(id)}/operational-rollback`, {method:'POST',headers:editorialHeaders(editorialRevision),body:JSON.stringify({revisionId,reviewToken})}),
  publishOperationalPlaylist: (rundownId: string,editorialRevision:number,reviewToken:string) =>
    send<{ id: string; revision: number; publishedAt: string; conflicts: RundownView['schedule']['conflicts'];applied:true;executionUpdated:boolean|null;refreshError:string|null;mirrors?:MirrorResult[] }>(
      `/api/rundowns/${encodeURIComponent(rundownId)}/operational-publish`,
      {method:'POST',headers:editorialHeaders(editorialRevision),body:JSON.stringify({reviewToken})},
    ),

  addItem: (
    rundownId: string,
    body: {
      mediaId?: string | null
      sourceRef?: string | null
      configuredSourceId?: string | null
      type: 'VT' | 'LIVE' | 'GFX' | 'SLATE' | 'COMMERCIAL' | 'FILLER'
      title?: string
      anchor?: Anchor
      durationOverride?: number | null
      atIndex?: number
      eventType?: ScheduleEventType
      timingFlags?: TimingFlags
      trimmable?: boolean
      optional?: boolean
      protected?: boolean
      liveConfig?: LiveSourceConfig | null
    },
    revision:number|undefined,
  ) => send<Snapshot>(`/api/rundowns/${rundownId}/items`, {method:'POST',headers:editorialHeaders(revision),body:JSON.stringify(body)}),

  patchItem: (id: string, body: Record<string, unknown>,revision:number|undefined) =>
    send<Snapshot>(`/api/items/${id}`, { method: 'PATCH',headers:editorialHeaders(revision), body: JSON.stringify(body) }),

  removeItem: (id: string,revision:number|undefined) => send<Snapshot>(`/api/items/${id}`, { method: 'DELETE',headers:editorialHeaders(revision) }),

  bulkDeleteItems: (rundownId: string, ids: string[],revision:number|undefined) =>
    send<Snapshot>(`/api/rundowns/${encodeURIComponent(rundownId)}/items/bulk-delete`, {method:'POST',headers:editorialHeaders(revision),body:JSON.stringify({ids})}),

  moveItem: (id: string, toIndex: number,revision:number|undefined) =>
    send<Snapshot>(`/api/items/${id}/move`,{method:'POST',headers:editorialHeaders(revision),body:JSON.stringify({toIndex})}),

  editScope: (id:string,scope:EditScope,revision:number|undefined)=>send<{review:EditScopeReview}>(`/api/items/${encodeURIComponent(id)}/edit-scope?scope=${encodeURIComponent(scope)}`,{headers:editorialHeaders(revision)}),

  setTrim: (id: string, trim: Trim, scope: EditScope,revision:number|undefined,scopeReviewToken?:string) =>
    send<Snapshot & {result:{message:string}}>(`/api/items/${id}/trim`,{method:'POST',headers:editorialHeaders(revision),body:JSON.stringify({trim,scope,scopeReviewToken})}),

  analyzeAudioMix:(id:string,contentHash:string,audioTrack:number,routing:AudioRouting,revision:number|undefined,scope:'FILE'|'TRIM'='FILE')=>send<{analysis:AudioMixAnalysisView}>(`/api/items/${encodeURIComponent(id)}/audio-analysis`,{method:'POST',body:JSON.stringify({contentHash,audioTrack,routing,scope}),headers:editorialHeaders(revision)}),
  audioMixAnalysis:(id:string,analysisId:string)=>send<{analysis:AudioMixAnalysisView}>(`/api/items/${encodeURIComponent(id)}/audio-analysis/${encodeURIComponent(analysisId)}`),
  setAudio: (id: string, audio: AudioLevel, scope: EditScope,revision:number|undefined,audioTrack?:number,scopeReviewToken?:string) =>
    send<Snapshot & {result:{message:string}}>(`/api/items/${id}/audio`,{method:'POST',headers:editorialHeaders(revision),body:JSON.stringify({audio,scope,audioTrack,scopeReviewToken})}),

  distribution: (signal?:AbortSignal) => send<Distribution>('/api/distribution',{signal}),
  processes: (signal?:AbortSignal) =>
    send<{
      generatedAt: string
      processes: Array<{
        id: string
        kind: 'ENGINE' | 'MEDIAMTX' | 'OUTPUT'
        channelId: string | null
        pid: number | null
        state: string
        cpuTimeMs: number | null
        memoryBytes: number | null
        details?: Record<string, unknown>
      }>
    }>('/api/processes',{signal}),
  storageStatus: () => send<{mode:'PROCESS'|'INLINE';connected:boolean;backendPid:number;storagePid:number;automaticReconnect:false;automaticReplay:false;latency:{calls:number;lastMs:number;maxMs:number;meanMs:number}|null;validation:'PENDING'}>('/api/engineering/storage'),
  hostMetrics:(signal?:AbortSignal)=>send<HostMetricSample>('/api/host-metrics',{signal}),
  hostMetricHistory:(hours=1,limit=120,page?:{until:string;before:string},signal?:AbortSignal)=>send<HostMetricHistory>(`/api/host-metrics/history?hours=${hours}&limit=${limit}${page?`&until=${encodeURIComponent(page.until)}&before=${encodeURIComponent(page.before)}`:''}`,{signal}),
  operationalMetricHistory:(channelId:string,hours=1,limit=120,page?:{until:string;before:string},signal?:AbortSignal)=>send<OperationalMetricHistory>(`/api/channels/${encodeURIComponent(channelId)}/operational-metrics/history?hours=${hours}&limit=${limit}${page?`&until=${encodeURIComponent(page.until)}&before=${encodeURIComponent(page.before)}`:''}`,{signal}),
  externalAutomationAudit: () => send<{
    entries: Array<{
      id: string
      timestamp: string
      pgmTimecode: string
      targetDevice: string
      action: string
      latencyMs: number
      executionStatus: 'SUCCESS' | 'FAILED' | 'ERROR_TIMEOUT'
      details?: Record<string, unknown>
      error?: string
    }>
  }>('/api/external/audit'),
  externalDevices: () => send<{ devices: Array<{ id: string; name: string; kind: 'ATEM_SWITCHER' | 'VIDEOHUB_ROUTER' | 'GPIO_RELAY'; host: string; port: number; enabled: boolean; createdAt: string }> }>('/api/external/devices'),
  addExternalDevice: (body: { name: string; kind: 'ATEM_SWITCHER' | 'VIDEOHUB_ROUTER' | 'GPIO_RELAY'; host: string; port: number; enabled: boolean }) => post<{ device: { id: string } }>('/api/external/devices', body),
  updateExternalDevice: (id: string, body: { enabled: boolean }) => send(`/api/external/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  externalCommandRuns: () => send<{ runs: ManualExternalRun[]; uncertainState: string }>('/api/external/commands'),
  acknowledgeExternalCommand: (requestId: string, note: string) => post(`/api/external/commands/${encodeURIComponent(requestId)}/acknowledge`, { note }),
  controlExternalDevice: (id: string, body: { requestId: string; action: 'PING' | 'ROUTE_CROSSPOINT'; source?: number; destination?: number }) => post<{ run: ManualExternalRun; deduplicated: boolean; physicalOutputValidated: false }>(`/api/external/devices/${encodeURIComponent(id)}/control`, body),
  healthEvents: (channelId?: string,options?:{severity?:'ALL'|'INFO'|'WARN'|'CRITICAL';acknowledgement?:'ALL'|'PENDING'|'ACKNOWLEDGED';until?:string;beforeAt?:string;beforeId?:string},signal?:AbortSignal) => send<{ events: Array<{ id: string; channelId: string | null; component: string; state: string; severity: 'INFO' | 'WARN' | 'CRITICAL'; message: string | null; occurredAt: string; acknowledgedAt: string | null;resolvedAt?:string|null;observationEndedAt?:string|null;context?:IncidentContext|null }>;pending:{critical:number;warn:number};risk:{observedUnresolved:number;observationEndedUnresolved:number;withoutContext:number};page:{until:string;totalMatching:number;hasMore:boolean;nextBefore:{occurredAt:string;id:string}|null} }>(`/api/health-events?limit=30${channelId ? `&channelId=${encodeURIComponent(channelId)}` : ''}${options?'&'+new URLSearchParams(Object.entries(options).filter((entry):entry is [string,string]=>typeof entry[1]==='string')).toString():''}`,{signal}),
  acknowledgeHealth: (id: string) => post<{ ok: true }>(`/api/health-events/${id}/ack`, {}),
  schedulerStatus: (signal?:AbortSignal) => send<{ checkedAt: string; channels: Array<{ channelId: string; rundownId: string | null; rundownDate: string | null; revisionId: string | null; source: 'NONE' | 'LEGACY' | 'PUBLISHED'; mode: 'FINITE' | 'LOOP' | 'OPEN_LIVE' | 'MANUAL_HOLD' | 'WAITING_START' | 'NO_EXECUTION' | 'INVALID_DATE'; reason: string | null; automaticHandover: boolean; nextPlaylist: {state:NextPlaylistRun['state'];targetName:string;targetRevisionId:string;policy:'ONE_REVIEWED_EOS'}|null; activeRule: { name: string; startMinute: number; endMinute: number } | null; endsAtFrames: number | null; minutesRemaining: number | null; coverageMinutes: number | null; coverageHours: number | null; targetHours: number; coverageReady: boolean }> }>('/api/scheduler/status',{signal}),
  nextPlaylist:(channelId:string)=>send<NextPlaylistStatus>(`/api/channels/${encodeURIComponent(channelId)}/next-playlist`),
  publishedContinuity:(channelId:string)=>send<PublishedContinuityStatus>(`/api/channels/${encodeURIComponent(channelId)}/published-continuity`),
  schedulePublication:(channelId:string)=>send<SchedulePublicationStatus>(`/api/channels/${encodeURIComponent(channelId)}/schedule-publication`),
  schedulePublicationReview:(channelId:string,daysAhead:number,maxItems:number)=>send<{review:SchedulePublicationReview}>(`/api/channels/${encodeURIComponent(channelId)}/schedule-publication/review?daysAhead=${daysAhead}&maxItems=${maxItems}`),
  setSchedulePublication:(channelId:string,body:{action:'ENABLE'|'DISABLE';version:number;daysAhead?:number;maxItems?:number;reviewToken?:string})=>post(`/api/channels/${encodeURIComponent(channelId)}/schedule-publication`,body),
  publishedContinuityReview:(channelId:string,maxLateMinutes:number)=>send<{review:PublishedContinuityReview}>(`/api/channels/${encodeURIComponent(channelId)}/published-continuity/review?maxLateMinutes=${maxLateMinutes}`),
  setPublishedContinuity:(channelId:string,body:{action:'ENABLE'|'DISABLE';version:number;maxLateMinutes?:number;reviewToken?:string})=>post(`/api/channels/${encodeURIComponent(channelId)}/published-continuity`,body),
  nextPlaylistReview:(channelId:string,revisionId:string)=>send<{review:NextPlaylistReview;nativeEngine:boolean}>(`/api/channels/${encodeURIComponent(channelId)}/next-playlist/review?revisionId=${encodeURIComponent(revisionId)}`),
  setNextPlaylist:(channelId:string,body:{action:'QUEUE'|'CANCEL'|'RECONCILE';requestId:string;sourceRevisionId?:string;targetRevisionId?:string;reviewToken?:string})=>post<{id:string;state:NextPlaylistRun['state'];nativeProgramConfirmed?:boolean;physicalOutputValidated?:false;replayed?:false}>(`/api/channels/${encodeURIComponent(channelId)}/next-playlist`,body),
  n1Status: (signal?:AbortSignal) => send<{ configured: boolean; peer: string | null; reachable: boolean; latencyMs: number | null; checkedAt: string; error: string | null }>('/api/n1/status',{signal}),
  haStatus:()=>send<HaReplicationStatus>('/api/ha/status'),
  createUpgradeBackup:(requestId:string)=>post<UpgradeBackupReport>('/api/backups/upgrade',{requestId}),
  upgradeBackup:(requestId:string)=>send<UpgradeBackupReport>(`/api/backups/upgrade/${encodeURIComponent(requestId)}`),
  reconcileUpgradeBackup:(requestId:string)=>post<UpgradeBackupReport>(`/api/backups/upgrade/${encodeURIComponent(requestId)}/reconcile`,{confirm:true}),
  haBindingChannels:()=>send<{channels:Array<{id:string;name:string}>}>('/api/ha/binding-channels'),
  haExecutionObservations:(channelId:string)=>send<{executions:HaExecutionObservation[];automaticTake:false;physicalOutputValidated:false}>('/api/ha/executions?channelId='+encodeURIComponent(channelId)),
  haMonitor:(body:HaMonitorRequest)=>post<HaMonitorReport>('/api/ha/executions/monitor',body),
  haMonitorQuery:(requestId:string,channelId:string)=>send<HaMonitorReport>('/api/ha/executions/monitor?requestId='+encodeURIComponent(requestId)+'&channelId='+encodeURIComponent(channelId)),
  haControl:(body:HaControlRequest)=>post<HaControlReport>('/api/ha/executions/control',body),
  haControlQuery:(requestId:string,channelId:string)=>send<HaControlReport>('/api/ha/executions/control?requestId='+encodeURIComponent(requestId)+'&channelId='+encodeURIComponent(channelId)),
  haControlReview:(body:{reviewId:string;requestId:string;channelId:string;reviewToken:string})=>post<HaControlReport>('/api/ha/executions/control/review',body),
  haStopReview:(promotionId:string,channelId:string)=>send<HaStopReview>('/api/ha/executions/stop-review?promotionId='+encodeURIComponent(promotionId)+'&channelId='+encodeURIComponent(channelId)),
  haStop:(body:HaStopRequest)=>post<HaStopReport>('/api/ha/executions/stop',body),
  haStopQuery:(requestId:string,channelId:string)=>send<HaStopReport>('/api/ha/executions/stop?requestId='+encodeURIComponent(requestId)+'&channelId='+encodeURIComponent(channelId)),
  haReturnPlanReview:(promotionId:string,channelId:string)=>send<HaReturnPlan>('/api/ha/executions/return-review?promotionId='+encodeURIComponent(promotionId)+'&channelId='+encodeURIComponent(channelId)),
  haExport:(body:HaExportRequest)=>post<HaExportReport>('/api/ha/executions/export',body),
  haExportQuery:(requestId:string,channelId:string)=>send<HaExportReport>('/api/ha/executions/export?requestId='+encodeURIComponent(requestId)+'&channelId='+encodeURIComponent(channelId)),
  haReturnReceipts:(channelId:string)=>send<{receipts:HaReturnReceipt[];publicationAuthorized:false}>('/api/ha/returns?channelId='+encodeURIComponent(channelId)),
  haReturnSend:(body:HaReturnSendRequest)=>post<HaReturnSendReport>('/api/ha/executions/return-send',body),
  haReturnSendQuery:(requestId:string,channelId:string)=>send<HaReturnSendReport>('/api/ha/executions/return-send?requestId='+encodeURIComponent(requestId)+'&channelId='+encodeURIComponent(channelId)),
  haReturnSendInspect:(requestId:string,channelId:string)=>post<HaReturnSendReport>('/api/ha/executions/return-inspect',{requestId,channelId}),
  haReturnResume:(body:HaReturnResumeRequest)=>post<HaReturnResumeReport>('/api/ha/executions/return-resume',body),
  haReturnResumeQuery:(resumeId:string,channelId:string)=>send<HaReturnResumeReport>('/api/ha/executions/return-resume?resumeId='+encodeURIComponent(resumeId)+'&channelId='+encodeURIComponent(channelId)),
  haReturnReview:(body:HaReturnReviewRequest)=>post<HaReturnReviewReport>('/api/ha/returns/review',body),
  haReturnReviewQuery:(reviewId:string,channelId:string)=>send<HaReturnReviewReport>('/api/ha/returns/review?reviewId='+encodeURIComponent(reviewId)+'&channelId='+encodeURIComponent(channelId)),
  haReturnSelection:(body:HaReturnSelectionRequest)=>post<HaReturnSelectionReport>('/api/ha/returns/selection',body),
  haReturnSelectionQuery:(planId:string,channelId:string)=>send<HaReturnSelectionReport>('/api/ha/returns/selection?planId='+encodeURIComponent(planId)+'&channelId='+encodeURIComponent(channelId)),
  haReturnCandidate:(body:HaReturnCandidateRequest)=>post<HaReturnCandidateReport>('/api/ha/returns/candidate',body),
  haReturnCandidateQuery:(candidateId:string,channelId:string)=>send<HaReturnCandidateReport>('/api/ha/returns/candidate?candidateId='+encodeURIComponent(candidateId)+'&channelId='+encodeURIComponent(channelId)),
  haReturnBindingReview:(candidate:HaReturnCandidateRequest,requestId?:string)=>send<HaReturnBindingReport>('/api/ha/returns/bindings?candidateId='+encodeURIComponent(candidate.candidateId)+'&planId='+encodeURIComponent(candidate.planId)+'&channelId='+encodeURIComponent(candidate.channelId)+(requestId?'&requestId='+encodeURIComponent(requestId):'')),
  saveHaReturnBindings:(body:HaReturnBindingRequest)=>post<HaReturnBindingReport>('/api/ha/returns/bindings',body),
  applyHaReturnBindings:(body:HaReturnApplicationRequest)=>post<HaReturnApplicationReport>('/api/ha/returns/application',body),
  haReturnApplicationQuery:(applicationId:string,channelId:string)=>send<HaReturnApplicationReport>('/api/ha/returns/application?applicationId='+encodeURIComponent(applicationId)+'&channelId='+encodeURIComponent(channelId)),
  reviewHaReturnMedia:(body:HaReturnMediaReviewRequest)=>post<HaReturnMediaReviewReport>('/api/ha/returns/media-review',body),
  haReturnMediaReviewQuery:(mediaReviewId:string,channelId:string)=>send<HaReturnMediaReviewReport>('/api/ha/returns/media-review?mediaReviewId='+encodeURIComponent(mediaReviewId)+'&channelId='+encodeURIComponent(channelId)),
  haReturnMediaOptions:(applicationId:string,channelId:string)=>send<HaReturnMediaOptions>('/api/ha/returns/media-options?applicationId='+encodeURIComponent(applicationId)+'&channelId='+encodeURIComponent(channelId)),
  haReturnAutoOptions:(mediaReviewId:string,channelId:string)=>send<HaReturnAutoOptions>('/api/ha/returns/auto-options?mediaReviewId='+encodeURIComponent(mediaReviewId)+'&channelId='+encodeURIComponent(channelId)),
  haReturnPendingJobs:(channelId:string,kind:HaReturnPendingJobs['kind'],afterId:string|null=null)=>send<HaReturnPendingJobs>('/api/ha/returns/pending-jobs?channelId='+encodeURIComponent(channelId)+'&kind='+encodeURIComponent(kind)+(afterId?'&afterId='+encodeURIComponent(afterId):'')),
  haReturnHistoryJobObservation:(id:string,channelId:string,kind:'HISTORY_IMPORT'|'HISTORY_VARIANT')=>send<HaReturnHistoryJobObservation>('/api/ha/returns/history-job?id='+encodeURIComponent(id)+'&channelId='+encodeURIComponent(channelId)+'&kind='+encodeURIComponent(kind)),
  closeHaReturnInterruptedJob:(body:HaReturnJobRecoveryRequest)=>post<HaReturnJobRecoveryReport>('/api/ha/returns/job-recovery',body),
  haReturnJobRecoveryQuery:(recoveryId:string,channelId:string)=>send<HaReturnJobRecoveryReport>('/api/ha/returns/job-recovery?recoveryId='+encodeURIComponent(recoveryId)+'&channelId='+encodeURIComponent(channelId)),
  saveHaReturnAutoDecision:(body:HaReturnAutoDecisionRequest)=>post<HaReturnAutoDecisionReport>('/api/ha/returns/auto-decision',body),
  haReturnAutoDecisionQuery:(decisionId:string,channelId:string)=>send<HaReturnAutoDecisionReport>('/api/ha/returns/auto-decision?decisionId='+encodeURIComponent(decisionId)+'&channelId='+encodeURIComponent(channelId)),
  stageHaReturnMediaApplication:(body:HaReturnMediaApplicationRequest)=>post<HaReturnMediaApplicationReport>('/api/ha/returns/media-application',body),
  reviewHaReturnPostGain:(body:HaReturnPostGainReviewRequest)=>post<HaReturnPostGainReviewReport>('/api/ha/returns/postgain-review',body),
  reviewHaReturnBus:(body:HaReturnBusReviewRequest)=>post<HaReturnBusReviewReport>('/api/ha/returns/bus-review',body),
  haReturnBusQuery:(busReviewId:string,channelId:string)=>send<HaReturnBusReviewReport>('/api/ha/returns/bus-review?busReviewId='+encodeURIComponent(busReviewId)+'&channelId='+encodeURIComponent(channelId)),
  haReturnPostGainQuery:(postGainReviewId:string,channelId:string)=>send<HaReturnPostGainReviewReport>('/api/ha/returns/postgain-review?postGainReviewId='+encodeURIComponent(postGainReviewId)+'&channelId='+encodeURIComponent(channelId)),
  haReturnMediaApplicationQuery:(mediaApplicationId:string,channelId:string)=>send<HaReturnMediaApplicationReport>('/api/ha/returns/media-application?mediaApplicationId='+encodeURIComponent(mediaApplicationId)+'&channelId='+encodeURIComponent(channelId)),
  haHistoryImport:(body:HaHistoryImportRequest)=>post<HaHistoryImportReport>('/api/ha/returns/history',body),
  haHistoryImportQuery:(importId:string,channelId:string)=>send<HaHistoryImportReport>('/api/ha/returns/history?importId='+encodeURIComponent(importId)+'&channelId='+encodeURIComponent(channelId)),
  haHistoryVariants:(body:HaHistoryVariantRequest)=>post<HaHistoryVariantReport>('/api/ha/returns/variants',body),
  haHistoryVariantsQuery:(decisionId:string,channelId:string)=>send<HaHistoryVariantReport>('/api/ha/returns/variants?decisionId='+encodeURIComponent(decisionId)+'&channelId='+encodeURIComponent(channelId)),
  haReturnRekey:(body:HaReturnRekeyRequest)=>post<HaReturnRekeyReport>('/api/ha/returns/rekey',body),
  haReturnRekeyQuery:(rekeyId:string,channelId:string)=>send<HaReturnRekeyReport>('/api/ha/returns/rekey?rekeyId='+encodeURIComponent(rekeyId)+'&channelId='+encodeURIComponent(channelId)),
  haBindingReview:(channelId:string)=>send<HaBindingReview>(`/api/ha/bindings?channelId=${encodeURIComponent(channelId)}`),
  prepareHaBindings:(body:HaPreparationRequest)=>post<HaPreparationReport>('/api/ha/prepare',body),
  haPreparationReports:()=>send<{reports:HaPreparationReport[];promotionReady:false;automaticTake:false}>('/api/ha/rehearsal'),
  saveHaBindings:(body:{requestId:string;channelId:string;sequence:number;basePlanId:string|null;reviewToken:string;inputs:Array<{sourceKey:string;localKey:string}>;outputs:Array<{outputId:string;disposition:'LOCAL'|'DISABLED';localTarget?:string;reason?:string}>})=>post<HaBindingReview>('/api/ha/bindings',body),
  timeline: (channelId: string,signal?:AbortSignal) => send<{ channelId: string; nowFrames: number; items: Array<{ itemId: string; title: string; type: string; start: number; end: number; duration: number; state: 'ON_AIR' | 'UP_NEXT' | 'AIRED' }> }>(`/api/channels/${encodeURIComponent(channelId)}/timeline`,{signal}),
  scteCues: (channelId?: string) => send<{ cues: Array<{ id: string; channelId: string | null; state: string; message: string | null; occurredAt: string }> }>(`/api/cues/scte${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ''}`),
  graphicLayers: (channelId: string) => send<{channelId:string;channelName:string;rate:{num:number;den:number};nowFrames:number;simulated:boolean;secondaryEvents:import('@rplayout/protocol').SecondaryEvent[];layers:Record<import('@rplayout/protocol').GraphicsLayer,import('@rplayout/protocol').GraphicLayerState>}>(`/api/v1/graphics/layers?channelId=${encodeURIComponent(channelId)}`),
  triggerGraphicLayer: (channelId:string,layer:import('@rplayout/protocol').GraphicsLayer,values:{action:'SHOW'|'HIDE';payload:Record<string,unknown>;durationFrames?:number},key=graphicCommandKey()) => send('/api/v1/graphics/layers/'+layer+'/trigger',{method:'POST',headers:{'idempotency-key':key},body:JSON.stringify({channelId,...values})}),
  requestScte: (channelId:string) => post<{spliceEventId:number;status:string;physicalInsertionConfirmed:boolean}>('/api/v1/scte/splice-insert',{channelId,prerollMs:4000,durationSeconds:30}),
  secondaryEvents: (itemId:string) => send<ItemAutomationState>(`/api/items/${itemId}/secondary-events`),
  addSecondaryEvent: (itemId:string,event:Omit<import('@rplayout/protocol').SecondaryEvent,'id'|'channelId'|'rundownItemId'>,revision:number) => send<ItemAutomationState>(`/api/items/${itemId}/secondary-events`,{method:'POST',headers:editorialHeaders(revision),body:JSON.stringify(event)}),
  removeSecondaryEvent: (itemId:string,eventId:string,revision:number) => send<ItemAutomationState>(`/api/items/${itemId}/secondary-events/${eventId}`,{method:'DELETE',headers:editorialHeaders(revision)}),
  secondaryEventRuns: (channelId:string) => send<{runs:Array<{id:string;itemId:string;revisionId:string|null;eventId:string;mode:string;state:string;frames:number;createdAt:string;error:string|null}>;uncertainState:string}>(`/api/channels/${channelId}/secondary-event-runs`),
  fireSecondaryEvent: (channelId:string,eventId:string) => post(`/api/channels/${channelId}/secondary-events/${eventId}/fire`,{}),

  autoFill: (
    rundownId: string,
    body: {
      minutes?: number
      proposalId?:string
      avoidHours?: number
      preview?: boolean
      insertAtMinute?: number
      insertAfterItemId?: string
      insertAtOrder?: number
    },
    revision:number|undefined,
  ) => send<import('./types.js').FillResponse>(`/api/rundowns/${rundownId}/autofill`,{method:'POST',headers:body.preview&&revision===undefined?{}:editorialHeaders(revision),body:JSON.stringify(body)}),

  asRun: (
    channelId: string,
    options?: { since?: string; until?: string; limit?: number },
  ) => {
    const params = new URLSearchParams()
    if (options?.since) params.set('since', options.since)
    if (options?.until) params.set('until', options.until)
    if (options?.limit) params.set('limit', String(options.limit))
    const qs = params.toString() ? `?${params.toString()}` : ''
    return send<{ entries: AsRunEntry[]; since?: string; until?: string | null }>(
      `/api/channels/${encodeURIComponent(channelId)}/asrun${qs}`,
    )
  },

  channelRundowns: (channelId: string, date?: string) =>
    send<{
      rundowns?: Rundown[]
      rundown?: Rundown | null
      view?: RundownView | null
    }>(
      `/api/channels/${encodeURIComponent(channelId)}/rundowns${
        date ? `?date=${encodeURIComponent(date)}` : ''
      }`,
    ),

  createChannelRundown: (
    channelId: string,
    body: { date: string; name?: string; copyFromRundownId?: string },
  ) =>
    post<{ rundown: any; view: RundownView }>(
      `/api/channels/${encodeURIComponent(channelId)}/rundowns`,
      body,
    ),

  loadChannelRundown: (channelId: string, rundownId: string) =>
    post<Snapshot>(`/api/channels/${encodeURIComponent(channelId)}/load-rundown`, { rundownId }),

  rules: (channelId: string,signal?:AbortSignal) =>
    send<ScheduleRuleReview>(`/api/channels/${encodeURIComponent(channelId)}/rules`,{signal}),
  addRule: (
    channelId: string,
    body: {
      name: string
      weekdays: string
      startMinute: number
      endMinute: number
      categories: string[]
      avoidHours: number
    },
    review:ScheduleRuleReview|null,
  ) => send<ScheduleRuleReview&{applied:true;refreshError?:string}>(`/api/channels/${encodeURIComponent(channelId)}/rules`,{method:'POST',headers:scheduleRuleHeaders(review,channelId),body:JSON.stringify(body)}),
  /** "Estou com este monitor aberto." O engine só codifica enquanto há aviso. */
  watching: (channelId: string, bus: 'pvw' | 'mon') =>
    post<{ ok: true; available?: boolean }>(`/api/channels/${channelId}/watching`, { bus }),
  qcLiveInspection:(channelId:string,viewerId:string,sourceRef:string,watching:boolean)=>
    post<{ok:true;rendition:'qc-encoded';profileFromSource:true;maxWidth:number;maxHeight:number;maxFps:number;maxBitrateKbps:number}>(`/api/channels/${channelId}/qc/inspection`,{viewerId,sourceRef,watching}),
  setWatching: (channelId: string, bus: 'pvw' | 'mon', watching = true) =>
    post<{ ok: true; available?: boolean }>(`/api/channels/${channelId}/watching`, { bus, watching }),

  playlists: () =>
    send<{ playlists: PlaylistFile[]; today: string | null; date: string }>('/api/playlists'),
  playlistEntries: (path: string) =>
    send<{ entries: PlaylistEntryView[] }>(
      `/api/playlists/entries?path=${encodeURIComponent(path)}`,
    ),
  loadPlaylist: (rundownId: string, path: string, replace: boolean, scheduledDate:string|undefined,revision:number|undefined) =>
    send<Snapshot & { loaded: number; skipped: number }>(
      `/api/rundowns/${rundownId}/playlist`,
      {method:'POST',headers:editorialHeaders(revision),body:JSON.stringify({path,replace,scheduledDate})},
    ),
  /** Lista arrastada para a janela: vai o conteúdo, porque não há caminho. */
  loadPlaylistText: (rundownId: string, text: string, replace: boolean, scheduledDate:string|undefined,revision:number|undefined) =>
    send<Snapshot & { loaded: number; skipped: number }>(
      `/api/rundowns/${rundownId}/playlist`,
      {method:'POST',headers:editorialHeaders(revision),body:JSON.stringify({text,replace,scheduledDate})},
    ),
  playlistVersions: (rundownId: string) =>
    send<{ versions: Array<{ id: string; sourceName: string; mode: 'APPEND' | 'PUBLISH_NEXT'; loaded: number; skipped: number; scheduledDate: string | null; publishedAt: string }> }>(
      `/api/rundowns/${rundownId}/playlist-versions`,
    ),

  categories: (signal?:AbortSignal) => send<{ categories: Categoria[] }>('/api/categories',{signal}),
  categoryReview:(id:string,signal?:AbortSignal)=>send<CategoryReview>(`/api/categories/${encodeURIComponent(id)}/review`,{signal}),
  setCategoryColor: (id: string, color: string,review:CategoryReview) =>
    send<CategoryReview&{ applied:true;refreshError:string|null }>(`/api/categories/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers:{'if-match':review.id===id?categoryETag(review):'invalid-category-review'},
      body: JSON.stringify({ color }),
    }),
  removeCategory: (id: string,review:CategoryReview) =>
    send<CategoryReview&{ applied:true; soltos: number;refreshError:string|null }>(`/api/categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers:{'if-match':review.id===id?categoryETag(review):'invalid-category-review'},
    }),

  removeRule: (id:string,channelId:string,review:ScheduleRuleReview|null)=>send<ScheduleRuleReview&{applied:true;refreshError?:string}>(`/api/rules/${encodeURIComponent(id)}`,{method:'DELETE',headers:scheduleRuleHeaders(review,channelId)}),
  updateRule: (id:string,channelId:string,body:Partial<{name:string;weekdays:string;startMinute:number;endMinute:number;categories:string[];avoidHours:number}>,review:ScheduleRuleReview|null)=>
    send<ScheduleRuleReview&{applied:true;refreshError?:string}>(`/api/rules/${encodeURIComponent(id)}`,{method:'PATCH',headers:scheduleRuleHeaders(review,channelId),body:JSON.stringify(body)}),
  autoFillDay: (rundownId: string,revision:number|undefined,body:{preview?:boolean;proposalId?:string}={}) =>
    send<import('./types.js').FillResponse>(
      `/api/rundowns/${rundownId}/autofill-day`,
      {method:'POST',headers:body.preview&&revision===undefined?{}:editorialHeaders(revision),body:JSON.stringify(body)},
    ),

  overlays: (channelId: string) => send<{ slots: OverlaySlotState[] }>(`/api/channels/${encodeURIComponent(channelId)}/overlays`),
  overlayCommand: (channelId: string, slot: number, body: { action: 'IN' | 'OUT' | 'CUT' | 'OFF'; templateId?: string; values?: Record<string, string> }) =>
    send<{ slot: OverlaySlotState | null; slots: OverlaySlotState[] }>(`/api/channels/${encodeURIComponent(channelId)}/overlays/${slot}`, { method: 'POST', body: JSON.stringify(body) }),
  graphics: (channelId: string) =>
    send<{ templates: GraphicTemplate[] }>(`/api/graphics?channelId=${encodeURIComponent(channelId)}`),
  graphicsReview:(channelId:string|null,signal?:AbortSignal)=>send<GraphicsReview>(`/api/graphics/review${channelId===null?'':`?channelId=${encodeURIComponent(channelId)}`}`,{signal}),
  addGraphicTemplate:(channelId:string|null,body:Pick<GraphicTemplate,'name'|'svg'|'fields'|'fadeMs'|'holdSeconds'>,review:GraphicsReview|null)=>send<GraphicsReview&{applied:true;refreshError?:string}>('/api/graphics',{method:'POST',headers:graphicsHeaders(review,channelId),body:JSON.stringify({...body,channelId})}),
  updateGraphicTemplate:(id:string,channelId:string|null,body:Partial<Pick<GraphicTemplate,'name'|'svg'|'fields'|'fadeMs'|'holdSeconds'>>,review:GraphicsReview|null)=>send<GraphicsReview&{applied:true;refreshError?:string}>(`/api/graphics/${encodeURIComponent(id)}`,{method:'PATCH',headers:graphicsHeaders(review,channelId),body:JSON.stringify(body)}),
  removeGraphicTemplate:(id:string,channelId:string|null,review:GraphicsReview|null)=>send<GraphicsReview&{applied:true;refreshError?:string}>(`/api/graphics/${encodeURIComponent(id)}`,{method:'DELETE',headers:graphicsHeaders(review,channelId)}),
  showGraphic: (channelId: string, templateId: string, values: Record<string, string>,key=graphicCommandKey()) =>
    send<Snapshot&{graphicCommand:GraphicCommandReceipt}>(`/api/channels/${channelId}/graphic`, {method:'POST',headers:{'idempotency-key':key},body:JSON.stringify({templateId,values})}),
  hideGraphic: (channelId: string,key=graphicCommandKey()) =>
    send<Snapshot&{graphicCommand:GraphicCommandReceipt}>(`/api/channels/${channelId}/graphic`, { method: 'DELETE',headers:{'idempotency-key':key} }),
  graphicCommands:(channelId:string,signal?:AbortSignal)=>send<{commands:ReviewedGraphicCommand[];canReview:boolean}>(`/api/channels/${encodeURIComponent(channelId)}/graphic-commands`,{signal}),
  reviewGraphicCommand:(channelId:string,command:ReviewedGraphicCommand,note:string)=>post<{graphicCommand:GraphicCommandReceipt;signalRecovered:false}>(`/api/channels/${encodeURIComponent(channelId)}/graphic-commands/${encodeURIComponent(command.id)}/review`,{reviewToken:command.reviewToken,note,imageAndEngineChecked:true}),

  setSlate: (channelId: string, templateId: string | null,review:GraphicsReview|null) =>
    send<GraphicsReview&{applied:true;runtimeConfigurationApplied:boolean;refreshError?:string}>(`/api/channels/${encodeURIComponent(channelId)}/slate`, {
      method: 'PATCH',
      headers:graphicsHeaders(review,channelId),
      body: JSON.stringify({ templateId }),
    }),

  itemGraphics: (itemId: string,revision?:number) => send<ItemAutomationState>(`/api/items/${itemId}/graphics`,revision===undefined?undefined:{headers:editorialHeaders(revision)}),
  addItemGraphic: (
    itemId: string,
    templateId: string,
    values: Record<string, string>,
    atSeconds: number,
    revision:number,
  ) => send<ItemAutomationState>(`/api/items/${itemId}/graphics`,{method:'POST',headers:editorialHeaders(revision),body:JSON.stringify({templateId,values,atSeconds})}),
  removeItemGraphic: (id: string,revision:number) =>
    send<ItemAutomationState>(`/api/item-graphics/${id}`, { method: 'DELETE',headers:editorialHeaders(revision) }),

  addGuest: (channelId: string, label: string) =>
    post<{ streamKey: string; publishUrl: string }>(`/api/channels/${channelId}/guests`, { label }),
  removeGuest: (id: string) => send<{ ok: true }>(`/api/guests/${id}`, { method: 'DELETE' }),

  addDestination: (channelId: string, name: string, url: string) =>
    post<{ ok: true }>(`/api/channels/${channelId}/destinations`, { name, url }),
  setDestination: (id: string, body: { enabled?: boolean }) =>
    send<{ ok: true }>(`/api/destinations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeDestination: (id: string) =>
    send<{ ok: true }>(`/api/destinations/${id}`, { method: 'DELETE' }),

  undo: (rundownId: string,revision:number|undefined) => send<Snapshot & { label: string }>(`/api/rundowns/${rundownId}/undo`, {method:'POST',headers:editorialHeaders(revision),body:'{}'}),
  redo: (rundownId: string,revision:number|undefined) => send<Snapshot & { label: string }>(`/api/rundowns/${rundownId}/redo`, {method:'POST',headers:editorialHeaders(revision),body:'{}'}),

  group: (rundownId: string, itemIds: string[],revision:number|undefined) =>
    send<Snapshot>(`/api/rundowns/${rundownId}/blocks`, {method:'POST',headers:editorialHeaders(revision),body:JSON.stringify({itemIds})}),
  ungroup: (blockId: string,revision:number|undefined) => send<Snapshot>(`/api/blocks/${blockId}/ungroup`, {method:'POST',headers:editorialHeaders(revision),body:'{}'}),

  transport: (
    channelId: string,
    action: 'take' | 'cue' | 'stop' | 'park' | 'seek',
    target?: { itemId?: string | null; assetId?: string | null; bus?: 'pgm' | 'pvw'; frames?: number },
  ) => post<Snapshot>(`/api/channels/${channelId}/transport`, { action, ...target }),
}
import {categoryETag,type CategoryReview} from '@rplayout/protocol'
import {integrationETag,integrationCatalogETag,integrationDeliveryETag,type IntegrationReview,type IntegrationCatalogReview,type IntegrationDeliveryReview} from '@rplayout/protocol'
