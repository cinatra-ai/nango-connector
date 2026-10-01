import * as React from "react"

import { cn } from "../lib/utils"

// Package-owned anchor; composed with the host Button via asChild.
function Link({ className, ...props }: React.ComponentProps<"a">) {
  return <a data-slot="link" className={cn(className)} {...props} />
}

export { Link }
