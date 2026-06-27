import * as React from "react"

import { cn } from "../../lib/utils"

// Anchor primitive for the shadcn link pattern. The vendored shadcn
// primitives are the one place the raw control elements are rendered;
// callers compose this as `<Button asChild><Link/></Button>` (the
// documented design-system link pattern) instead of writing a raw <a>.
function Link({ className, ...props }: React.ComponentProps<"a">) {
  return <a data-slot="link" className={cn(className)} {...props} />
}

export { Link }
