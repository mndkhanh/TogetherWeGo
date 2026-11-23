import { createGroupSchema } from "@twg/shared"
import { PlusIcon } from "lucide-react"
import * as React from "react"
import { useNavigate } from "react-router"

import { type Currency, CurrencyToggle } from "@/components/currency-toggle"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { ApiError } from "@/lib/api"
import { type FieldErrors, formErrorMessage, toFieldErrors, validate } from "@/lib/form-errors"
import { useCreateGroup } from "@/lib/groups"

export function CreateGroupDialog({ defaultCurrency }: { defaultCurrency: Currency }) {
  const [open, setOpen] = React.useState(false)
  const [currency, setCurrency] = React.useState<Currency>(defaultCurrency)
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const createGroup = useCreateGroup()
  const navigate = useNavigate()

  function reset(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) {
      setCurrency(defaultCurrency)
      setFieldErrors({})
      setFormError(null)
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const { data, errors } = validate(createGroupSchema, { name: form.get("name"), currency })
    setFieldErrors(errors ?? {})
    setFormError(null)
    if (!data) return
    try {
      const group = await createGroup.mutateAsync(data)
      setOpen(false)
      navigate(`/groups/${group.id}`)
    } catch (error) {
      if (error instanceof ApiError) setFieldErrors(toFieldErrors(error.issues))
      setFormError(formErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger render={<Button />}>
        <PlusIcon data-icon="inline-start" />
        New group
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
            <DialogDescription>
              You'll get a link to invite your friends once the group is created.
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <FieldGroup>
            <Field data-invalid={!!fieldErrors.name || undefined}>
              <FieldLabel htmlFor="group-name">Group name</FieldLabel>
              <Input
                id="group-name"
                name="name"
                placeholder="Đà Lạt trip, Friday futsal, Flat 302"
                aria-invalid={!!fieldErrors.name || undefined}
                autoFocus
              />
              <FieldError>{fieldErrors.name}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="group-currency">Currency</FieldLabel>
              <CurrencyToggle id="group-currency" value={currency} onChange={setCurrency} />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" disabled={createGroup.isPending}>
              {createGroup.isPending && <Spinner data-icon="inline-start" />}
              Create group
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
