import { Link } from "react-router"

import { cn } from "@/lib/utils"

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn(
        "w-fit rounded-md text-lg font-extrabold tracking-tight outline-offset-4",
        className
      )}
    >
      TogetherWeGo
    </Link>
  )
}
