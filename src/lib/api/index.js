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
export { ServiceError, unwrap, applyCountry } from './_client'
