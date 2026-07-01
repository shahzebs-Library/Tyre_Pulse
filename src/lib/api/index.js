/**
 * Service-layer barrel. Import domain services as namespaces:
 *   import { assets, tyres } from '../lib/api'
 *   const rows = await assets.listAssets({ country })
 *
 * More domain modules (inspections, workOrders, stock, accidents, uploads,
 * reports, organisations, users) are added here as each is migrated.
 */
export * as assets from './assets'
export * as tyres from './tyres'
export * as stock from './stock'
export * as workOrders from './workOrders'
export * as inspections from './inspections'
export * as accidents from './accidents'
export * as gatePasses from './gatePasses'
export * as correctiveActions from './correctiveActions'
export * as rca from './rca'
export * as warranty from './warranty'
export * as recalls from './recalls'
export * as alertThresholds from './alertThresholds'
export * as rotations from './rotations'
export * as kpiTargets from './kpiTargets'
export * as purchaseOrders from './purchaseOrders'
export * as customData from './customData'
export * as knowledgeDocuments from './knowledgeDocuments'
export { ServiceError, unwrap, applyCountry } from './_client'
