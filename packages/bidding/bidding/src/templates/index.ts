/**
 * Shipped (built-in) bid templates.
 *
 * Compiled into the engine so the bundled `lib/index.js` carries them with
 * zero runtime file discovery; user templates still merge in from the user
 * root at discovery time.
 * @module @deepseek-ai/dsh-bidding
 */

import type { BidTemplate } from '../types.ts'
import { ENGINEERING_TEMPLATE } from './engineering.ts'
import { GOODS_TEMPLATE } from './goods.ts'
import { GOVERNMENT_PROCUREMENT_TEMPLATE } from './government-procurement.ts'
import { SERVICES_TEMPLATE } from './services.ts'

/** All shipped templates in stable registration order. */
export const SHIPPED_TEMPLATES: readonly BidTemplate[] = [
  GOVERNMENT_PROCUREMENT_TEMPLATE,
  ENGINEERING_TEMPLATE,
  GOODS_TEMPLATE,
  SERVICES_TEMPLATE,
]
