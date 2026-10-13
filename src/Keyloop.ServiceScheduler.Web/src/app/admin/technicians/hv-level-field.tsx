import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import type { Ref } from "react"
import { useId } from "react"

import { type HvLevel, hvLevels } from "@/lib/vehicle-aware"
import { cn } from "@/lib/utils"

const LEVELS: readonly HvLevel[] = [0, 1, 2, 3, 4]

/** Each step's height: the ladder the levels climb, so the choice reads as a level at a glance. */
const STEP_HEIGHT: Record<HvLevel, string> = { 0: "h-11", 1: "h-12", 2: "h-14", 3: "h-16", 4: "h-[4.5rem]" }

/** A level's accessible name: "No HV training", "Level 3, Component repair". */
const levelName = (level: HvLevel) => (level === 0 ? hvLevels[0].name : `Level ${level}, ${hvLevels[level].name}`)

interface HvLevelFieldProps {
  ref?: Ref<HTMLElement>
  value: HvLevel
  onChange: (level: HvLevel) => void
  /** The id of the field's label ("HV level"). */
  labelledBy: string
  disabled?: boolean
}

/**
 * The HV level as a staircase of five radio steps (UI_DESIGN 11.24), from "No HV" to "HV 4", each a step taller: the chosen
 * one in the signal fill, the steps below it tinted, so the level reads like the ladder of the HV badge (11.23). Under it
 * the chosen level's IMI-style name and what it allows. A Base UI radio group: arrow keys move between levels, Tab enters
 * and leaves; each step is named "Level 3, Component repair" and described by its sentence.
 */
export function HvLevelField({ ref, value, onChange, labelledBy, disabled = false }: HvLevelFieldProps) {
  const descriptionId = useId()
  return (
    <div className="flex flex-col gap-2">
      <RadioGroup
        value={value}
        onValueChange={(next) => typeof next === "number" && onChange(next as HvLevel)}
        aria-labelledby={labelledBy}
        aria-describedby={descriptionId}
        disabled={disabled}
        className="grid grid-cols-5 items-end gap-1.5"
      >
        {LEVELS.map((level, index) => (
          <Radio.Root
            key={level}
            ref={index === 0 ? (ref as Ref<HTMLButtonElement>) : undefined}
            value={level}
            aria-label={levelName(level)}
            className={cn(
              "group/step flex cursor-pointer flex-col items-center justify-end gap-1 rounded-t-lg rounded-b-sm border border-input bg-card px-1 pb-1.5 text-xs font-semibold tabular-nums outline-none",
              "hover:not-data-checked:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 data-disabled:cursor-not-allowed data-disabled:opacity-50",
              "data-checked:border-signal data-checked:bg-signal data-checked:text-signal-foreground",
              level < value && "border-signal/40 bg-signal/12",
              STEP_HEIGHT[level]
            )}
          >
            <span>{level === 0 ? "No HV" : `HV ${level}`}</span>
          </Radio.Root>
        ))}
      </RadioGroup>
      <p id={descriptionId} aria-live="polite" className="text-sm text-pretty">
        <span className="font-semibold">{hvLevels[value].name}</span>
        <span className="text-muted-foreground">{`: ${hvLevels[value].description}`}</span>
      </p>
    </div>
  )
}
