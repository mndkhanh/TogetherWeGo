import { type GroupDetailResponse, updateGroupSchema } from "@twg/shared"
import * as React from "react"
import { toast } from "sonner"

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
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { ApiError } from "@/lib/api"
import { type FieldErrors, formErrorMessage, toFieldErrors, validate } from "@/lib/form-errors"
import { useUpdateGroup } from "@/lib/groups"

export function EditGroupDialog({
  group,
  open,
  onOpenChange,
}: {
  group: GroupDetailResponse
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [currency, setCurrency] = React.useState<Currency>(group.currency)
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const update = useUpdateGroup(group.id)

  React.useEffect(() => {
    if (open) {
      setCurrency(group.currency)
      setFieldErrors({})
      setFormError(null)
    }
  }, [open, group.currency])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const { data, errors } = validate(updateGroupSchema, { name: form.get("name"), currency })
    setFieldErrors(errors ?? {})
    setFormError(null)
    if (!data) return
    try {
      await update.mutateAsync(data)
      onOpenChange(false)
      toast.success("Group saved")
    } catch (error) {
      if (error instanceof ApiError) setFieldErrors(toFieldErrors(error.issues))
      setFormError(formErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>Edit group</DialogTitle>
            <DialogDescription>Everyone in the group sees these changes.</DialogDescription>
          </DialogHeader>

          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <FieldGroup>
            <Field data-invalid={!!fieldErrors.name || undefined}>
              <FieldLabel htmlFor="edit-group-name">Group name</FieldLabel>
              <Input
                id="edit-group-name"
                name="name"
                defaultValue={group.name}
                aria-invalid={!!fieldErrors.name || undefined}
                autoFocus
              />
              <FieldError>{fieldErrors.name}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-group-currency">Currency</FieldLabel>
              <CurrencyToggle id="edit-group-currency" value={currency} onChange={setCurrency} />
              <FieldDescription>New expenses in this group use this currency.</FieldDescription>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending && <Spinner data-icon="inline-start" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
