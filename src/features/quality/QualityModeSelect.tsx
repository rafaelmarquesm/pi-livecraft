import type { RefObject } from 'react'
import type { ValidatedWorkMode } from '../../../shared/validated-work.ts'
import { ComposerSelect } from '../composer/selects/ComposerSelect.tsx'
import { qualityModes } from './quality-display.ts'

const options = [
  {
    label: qualityModes.standard.label,
    value: 'standard',
    description: qualityModes.standard.description,
  },
  {
    label: qualityModes.plan.label,
    value: 'plan',
    description: qualityModes.plan.description,
  },
  {
    label: `${qualityModes.validated.label} · Experimental`,
    value: 'validated',
    description: qualityModes.validated.description,
  },
]

export function QualityModeSelect({
  disabled,
  onChange,
  onOpenChange,
  open,
  triggerRef,
  value,
}: {
  disabled?: boolean
  onChange: (mode: ValidatedWorkMode) => void
  onOpenChange?: (open: boolean) => void
  open?: boolean
  triggerRef?: RefObject<HTMLButtonElement | null>
  value: ValidatedWorkMode
}) {
  return (
    <ComposerSelect
      ariaLabel={`Quality mode: ${qualityModes[value].label}`}
      disabled={disabled}
      onOpenChange={onOpenChange}
      onValueChange={(next) => onChange(next as ValidatedWorkMode)}
      open={open}
      options={options}
      tone='quality'
      triggerRef={triggerRef}
      value={value}
    />
  )
}
