import * as Select from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

export interface AppSelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface AppSelectProps {
  ariaInvalid?: boolean
  ariaDescribedBy?: string
  value: string
  options: AppSelectOption[]
  onValueChange: (value: string) => void
  id?: string
  ariaLabel?: string
  className?: string
  disabled?: boolean
  placeholder?: string
}

export function AppSelect({
  value,
  options,
  onValueChange,
  id,
  ariaLabel,
  className = "",
  disabled = false,
  ariaInvalid,
  ariaDescribedBy,
  placeholder = "Select an option",
}: AppSelectProps) {
  return (
    <Select.Root disabled={disabled} onValueChange={onValueChange} value={value}>
      <Select.Trigger aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy} aria-label={ariaLabel} className={`app-select-trigger ${className}`.trim()} id={id}>
        <Select.Value placeholder={placeholder} />
        <Select.Icon className="app-select-chevron"><ChevronDown size={15} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="app-select-content" collisionPadding={12} position="popper" sideOffset={6}>
          <Select.ScrollUpButton className="app-select-scroll"><ChevronUp size={15} /></Select.ScrollUpButton>
          <Select.Viewport className="app-select-viewport">
            {options.map((option) => (
              <Select.Item className="app-select-item" disabled={option.disabled} key={option.value} value={option.value}>
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="app-select-indicator"><Check size={14} /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="app-select-scroll"><ChevronDown size={15} /></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}
