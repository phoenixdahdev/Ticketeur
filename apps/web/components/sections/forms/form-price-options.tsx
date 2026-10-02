'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, Tick02Icon } from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'

import { formatNaira } from '@/lib/event-display'
import type { PriceOption } from '@/components/sections/forms/types'

// Exactly one option: a vendor booth type, or the entry fee. A sold-out option
// stays on the list rather than disappearing — someone who was told to pick
// "Food stall" needs to see that it has gone, not wonder why it is missing.
export function FormPriceOptions({
  options,
  selectedId,
  onSelect,
  error,
  disabled,
}: {
  options: PriceOption[]
  selectedId: string | null
  onSelect: (id: string) => void
  error: string | null
  disabled?: boolean
}) {
  return (
    <fieldset className="flex scroll-mt-28 flex-col gap-3" id="anchor-options">
      <legend className="text-foreground text-sm font-semibold">
        Choose one
        <span className="text-destructive ml-1" aria-hidden>
          *
        </span>
      </legend>

      <div className="flex flex-col gap-2.5">
        {options.map((option) => {
          const selected = option.id === selectedId
          const unavailable = option.soldOut || disabled
          return (
            <label
              key={option.id}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-4 transition-colors',
                option.soldOut
                  ? 'border-border bg-muted/40 cursor-not-allowed opacity-60'
                  : 'hover:border-primary/60 cursor-pointer',
                selected && !option.soldOut
                  ? 'border-primary bg-primary/5'
                  : 'border-border'
              )}
            >
              <input
                type="radio"
                name="price-option"
                className="sr-only"
                value={option.id}
                checked={selected}
                disabled={unavailable}
                aria-invalid={error !== null}
                onChange={() => onSelect(option.id)}
              />
              <span
                aria-hidden
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border',
                  selected && !option.soldOut
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input'
                )}
              >
                {selected && !option.soldOut ? (
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    className="size-3"
                    strokeWidth={3}
                  />
                ) : null}
              </span>

              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-foreground text-sm font-semibold">
                  {option.name}
                </span>
                <span className="text-muted-foreground text-xs">
                  {option.soldOut
                    ? 'Sold out'
                    : option.remaining !== null && option.remaining <= 5
                      ? `Only ${option.remaining} left`
                      : null}
                </span>
              </span>

              <span
                className={cn(
                  'font-heading shrink-0 text-base font-bold',
                  option.soldOut ? 'text-muted-foreground' : 'text-primary'
                )}
              >
                {option.priceMinor === 0
                  ? 'Free'
                  : formatNaira(option.priceMinor)}
              </span>
            </label>
          )
        })}
      </div>

      {error ? (
        <p
          role="alert"
          className="text-destructive flex items-start gap-1.5 text-sm"
        >
          <HugeiconsIcon
            icon={Alert02Icon}
            className="mt-0.5 size-3.5 shrink-0"
            strokeWidth={2}
          />
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}
