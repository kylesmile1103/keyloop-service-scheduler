import { Info, LogIn } from "lucide-react"
import type { ComponentProps, Ref } from "react"
import { Link } from "react-router-dom"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useSignInTarget } from "@/hooks/use-sign-in"

interface SignInActionProps extends Omit<ComponentProps<"a">, "href" | "children"> {
  /** The local page to return to; the current page by default. */
  returnTo?: string
  variant?: "default" | "outline" | "signal" | "secondary"
  size?: "default" | "sm" | "lg"
  ref?: Ref<HTMLAnchorElement>
}

/** Button-styled link that navigates to the API sign-in path (or Settings > Account in configuration mode). */
export function SignInAction({ returnTo, variant = "default", size = "default", className, ref, ...props }: SignInActionProps) {
  const target = useSignInTarget({ returnTo })
  const classes = cn(buttonVariants({ variant, size }), className)
  if (target.source === "configuration") {
    return (
      <Link ref={ref} to={target.to} className={classes} {...props}>
        <Info aria-hidden="true" />
        {target.label}
      </Link>
    )
  }
  return (
    <a ref={ref} href={target.href} className={classes} {...props}>
      <LogIn aria-hidden="true" />
      {target.label}
    </a>
  )
}
