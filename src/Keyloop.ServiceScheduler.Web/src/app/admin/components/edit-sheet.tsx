import type { ReactNode, RefObject } from "react"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

interface EditSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Below 768 px the form takes the whole screen, as the booking sheet does. */
  phone: boolean
  title: string
  description: ReactNode
  /** What takes focus as the sheet opens: the form's first field, else the title. */
  initialFocus: RefObject<HTMLElement | null>
  /** Where focus goes when it closes: the control that opened it, when it is still there. */
  returnFocus: () => HTMLElement | null
  children: ReactNode
}

/**
 * The Resources area's edit sheet (UI_DESIGN 11.24): a side sheet on wide screens (`sm:max-w-xl`), the whole screen on a
 * phone, with the title (its accessible name), one line on what a change does, then the form, whose actions stay in view at
 * the bottom. Base UI traps focus, closes on Escape and gives focus back on close.
 */
export function EditSheet({ open, onOpenChange, phone, title, description, initialFocus, returnFocus, children }: EditSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={phone ? "bottom" : "right"}
        initialFocus={() => initialFocus.current ?? true}
        finalFocus={() => {
          const target = returnFocus()
          return target?.isConnected ? target : (document.getElementById("content") ?? true)
        }}
        className={cn(
          "gap-0 p-0 *:data-[slot=sheet-close]:pointer-coarse:size-11",
          phone ? "h-dvh data-[side=bottom]:max-h-dvh data-[side=bottom]:rounded-none" : "w-full data-[side=right]:sm:max-w-xl"
        )}
      >
        <SheetHeader className="gap-1 border-b pr-12">
          <SheetTitle className="font-heading text-lg font-semibold">{title}</SheetTitle>
          <SheetDescription className="text-pretty">{description}</SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  )
}
