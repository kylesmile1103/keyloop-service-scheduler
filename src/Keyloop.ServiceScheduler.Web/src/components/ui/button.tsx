import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// A button that disables itself when pressed (a run, a save, a retry, Today) takes Base UI's `focusableWhenDisabled`, so
// keyboard focus stays on it: `aria-disabled` and `data-disabled` instead of `disabled`, which a browser answers by moving
// focus to the top of the page. It looks like a disabled one (UI_DESIGN 11.2); the dimming is keyed to Base UI's
// `data-disabled`, so the calendar's own `aria-disabled` day buttons keep their styling.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        // Keyloop's cyan accent (UI_DESIGN 11.2): the mobile floating Book action and the toast action, nowhere else.
        accent: "bg-brand-accent text-brand-accent-foreground hover:bg-brand-accent/90",
        // Keyloop's outline button: secondary calls to action that move the user on (Go to next open day, Book another).
        signal: "border-signal bg-transparent text-signal hover:bg-signal/10",
        outline:
          "border-input bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        // One focus colour app-wide: no red focus override (2.1:1), the base signal focus applies.
        destructive: "bg-destructive/10 text-destructive hover:bg-destructive/15",
        link: "text-signal font-semibold underline-offset-4 hover:underline",
      },
      // 40 px controls, 36 px compact, 24 px only beside a trace id; every size grows to 44 px on touch (UI_DESIGN 11.2).
      size: {
        default:
          "h-10 gap-1.5 px-4 pointer-coarse:h-11 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs pointer-coarse:h-11 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1 px-3 pointer-coarse:h-11 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-1.5 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-10 pointer-coarse:size-11",
        "icon-xs":
          "size-6 rounded-md pointer-coarse:size-11 in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9 pointer-coarse:size-11 in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
