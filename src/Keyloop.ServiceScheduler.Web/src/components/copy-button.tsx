import { Check, Copy } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"

interface CopyButtonProps {
  value: string
  /** What the button copies, for assistive technology: "Copy trace ID". */
  label: string
  /** Its name for two seconds after a copy: "Trace ID copied". */
  copiedLabel: string
}

/** Copies a value (a trace id, an appointment id) to the clipboard, and says whether it worked. */
export function CopyButton({ value, label, copiedLabel }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      // The clipboard API exists only in secure contexts (https, localhost); on a plain-http address it is undefined.
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      toast.add({ type: "error", title: "Couldn’t copy", description: "Select the text and copy it instead." })
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={copy}
      aria-label={copied ? copiedLabel : label}
      className="text-muted-foreground hover:text-foreground pointer-coarse:size-11"
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </Button>
  )
}
