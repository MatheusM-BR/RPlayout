export interface IntegrationReview {id:string;channelId:string|null;name:string;url:string;events:string[];enabled:boolean;revision:number;canEdit:boolean}
export interface IntegrationCatalogReview {channelId:string|null;revision:number;canEdit:boolean}
export interface IntegrationDeliveryDiagnostic {ownership:'INACTIVE'|'LOCAL_ALIVE'|'LOCAL_DEAD'|'REMOTE'|'UNKNOWN'|'UNCERTAIN';message:string}
export interface IntegrationDeliverySummary {id:string;integrationId:string;channelId:string|null;event:string;state:'QUEUED'|'SENDING'|'DELIVERED'|'FAILED'|'CANCELLED';attempts:number;nextAttemptAt:string;lastError:string|null;createdAt:string;deliveredAt:string|null;diagnostic:IntegrationDeliveryDiagnostic}
export interface IntegrationDeliveryReview {id:string;integrationId:string;channelId:string|null;state:string;attempts:number;revision:number;configurationRevision:number;canRetry:boolean;requiresOwnerConfirmation:boolean;diagnostic:IntegrationDeliveryDiagnostic}
export const integrationETag=(r:Pick<IntegrationReview,'id'|'revision'>)=>`"integration:${encodeURIComponent(r.id)}:${r.revision}"`
export const integrationCatalogETag=(r:IntegrationCatalogReview)=>`"integration-catalog:${r.channelId===null?'G':'C-'+encodeURIComponent(r.channelId)}:${r.revision}"`
export const integrationDeliveryETag=(r:IntegrationDeliveryReview)=>`"integration-delivery:${encodeURIComponent(r.id)}:${r.revision}:${r.configurationRevision}"`
