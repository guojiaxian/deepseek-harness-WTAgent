import { BrandWordmark, LogoMark } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official brand mark.
 */
/** Own props of the official brand mark, compatible with both the hero and sidebar slots. */
type OfficialBrandMarkProps = SidebarBrandMarkOwnerProps & { className?: string | undefined }

export function OfficialBrandMark({ size, className }: OfficialBrandMarkProps) {
  return <LogoMark size={size} className={className} />
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @returns the official name wordmark.
 */
export function OfficialBrandName() {
  return <BrandWordmark includeMark={false} />
}
