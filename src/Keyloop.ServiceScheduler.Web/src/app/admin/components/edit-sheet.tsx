import type { ReactNode, RefObject } from "react"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useUnsavedWork } from "@/hooks/use-unsaved-work"
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

/** Slide-over sheet (full-screen on mobile) for resource add and edit forms. */
export function EditSheet({ open, onOpenChange, phone, title, description, initialFocus, returnFocus, children }: EditSheetProps) {
  useUnsavedWork(open)
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
