import { Link } from "react-router"

import { StoolMark } from "@/components/stools"
import { cn } from "@/lib/utils"

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn(
        "flex w-fit items-center gap-2 rounded-md text-lg font-extrabold tracking-tight outline-offset-4",
        className
      )}
    >
      <StoolMark className="text-stool-red" />
      TogetherWeGo
    </Link>
  )
}
