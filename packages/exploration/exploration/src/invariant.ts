/** Package-owned invariant companion for `@deepseek-ai/dsh-exploration`. @module @deepseek-ai/dsh-exploration/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-exploration'
/** Cordis companion plugin name. */
export const name = 'exploration-invariant'
/** Service required before package ownership can be reserved. */
export const inject = ['invariants']
/**
 * No runtime invariant: the engine is stateless — pipelines are validated at
 * registration and processors return pure values, so no durable event or data
 * relation exists to assert.
 */
const install: InvariantInstaller = () => {}
/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
