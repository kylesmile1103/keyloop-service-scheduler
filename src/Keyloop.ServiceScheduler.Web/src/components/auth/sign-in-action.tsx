import { Info, LogIn } from "lucide-react"
import type { ComponentProps, Ref } from "react"
import { Link } from "react-router-dom"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useSignInTarget } from "@/hooks/use-sign-in"

interface SignInActionProps extends Omit<ComponentProps<"a">, "href" | "children"> {
  /** The local page to return to; the current page by default. */
  returnTo?: string
  /** A login URL to use instead of `/me`'s (a 401 problem's own `loginUrl`). */
  loginUrl?: string
  variant?: "default" | "outline" | "signal" | "secondary"
  size?: "default" | "sm" | "lg"
  ref?: Ref<HTMLAnchorElement>
}

/**
 * The Sign in action: a link styled as a button, so signing in is a plain top-level navigation to the API's login URL
 * (never a form, never a request made by script), returning to the current page with its dealership and day. On the
 * development server, whose identity is configuration, it is "How to sign in", to Settings > Account.
 */
export function SignInAction({ returnTo, loginUrl, variant = "default", size = "default", className, ref, ...props }: SignInActionProps) {
  const target = useSignInTarget({ returnTo, loginUrl })
  // Merged, so the variant's border and fill replace the base's transparent ones (cva only concatenates).
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
