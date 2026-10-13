// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/settings/appearance/page.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import { useId } from "react"

import { BaseLayout } from "@/components/layouts/base-layout"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import type { Theme } from "@/contexts/theme-context"
import { useTheme } from "@/hooks/use-theme"
import { cn } from "@/lib/utils"

import { ThemePreview } from "./theme-preview"

const CHOICES: ReadonlyArray<{ value: Theme; title: string; description: (system: "light" | "dark") => string }> = [
  { value: "light", title: "Light", description: () => "White work surface on Keyloop grey." },
  { value: "dark", title: "Dark", description: () => "Carbon and graphite, for low light." },
  { value: "system", title: "Match system", description: (system) => `Follows this device, ${system} at the moment.` },
]

/** Appearance settings page for selecting light, dark, or system theme. */
export default function AppearancePage() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const headingId = useId()
  const system: "light" | "dark" = theme === "system" ? resolvedTheme : prefersDark() ? "dark" : "light"

  return (
    <BaseLayout title="Appearance" description="How the scheduler looks on this device.">
      <div className="flex max-w-4xl flex-col gap-4 px-4 md:px-6 xl:px-8">
        <Card>
          <CardHeader>
            <h2 id={headingId} className="font-heading text-lg leading-snug font-semibold">
              Theme
            </h2>
            <CardDescription>A choice applies at once and stays on this device. The header’s button switches between light and dark from any page.</CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={theme}
              onValueChange={(value) => setTheme(value as Theme)}
              aria-labelledby={headingId}
              className="grid gap-3 sm:grid-cols-3"
            >
              {CHOICES.map((choice) => (
                <ThemeChoice key={choice.value} value={choice.value} title={choice.title} description={choice.description(system)} />
              ))}
            </RadioGroup>
          </CardContent>
        </Card>
      </div>
    </BaseLayout>
  )
}

function prefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
}

function ThemeChoice({ value, title, description }: { value: Theme; title: string; description: string }) {
  const titleId = useId()
  const descriptionId = useId()
  return (
    <Radio.Root
      value={value}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={cn(
        "group/theme flex cursor-pointer items-center gap-3 rounded-chip border border-input bg-card p-2.5 text-left outline-none sm:flex-col sm:items-stretch",
        "hover:not-data-checked:bg-accent data-checked:border-primary data-checked:ring-1 data-checked:ring-primary",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      )}
    >
      <span className="relative block aspect-[16/10] w-28 shrink-0 overflow-hidden rounded-md ring-1 ring-foreground/10 sm:w-full">
        {value === "system" ? (
          <>
            <ThemePreview theme="light" className="absolute inset-0" />
            <ThemePreview theme="dark" className="absolute inset-0 [clip-path:polygon(60%_0,100%_0,100%_100%,40%_100%)]" />
          </>
        ) : (
          <ThemePreview theme={value} />
        )}
      </span>
      <span className="flex items-start gap-2.5 px-0.5 pb-0.5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-input group-data-checked/theme:border-primary group-data-checked/theme:bg-primary"
        >
          <span className="size-1.5 rounded-full bg-primary-foreground opacity-0 group-data-checked/theme:opacity-100" />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span id={titleId} className="text-sm font-semibold">
            {title}
          </span>
          <span id={descriptionId} className="text-xs text-pretty text-muted-foreground">
            {description}
          </span>
        </span>
      </span>
    </Radio.Root>
  )
}
