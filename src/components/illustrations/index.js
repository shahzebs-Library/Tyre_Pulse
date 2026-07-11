/**
 * Tyre Pulse illustration system — public entry point.
 *
 *   import { Illustration } from '@/components/illustrations'
 *   <Illustration name="state/no-data" size={220} title="No inspections yet" />
 *
 * Add new artwork by dropping a `*.illustration.jsx` file in a category folder
 * (see _CONTRACT.md); the registry discovers it automatically.
 */
export { default as Illustration } from './Illustration'
export { ILLUSTRATIONS, ILLUSTRATION_NAMES, getIllustration, hasIllustration } from './registry'
export { IllustrationBase, BrandDefs, useDefs } from './primitives'
export { C, G, DEFAULT_VIEWBOX } from './tokens'
