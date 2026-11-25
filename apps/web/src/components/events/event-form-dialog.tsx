import { createEventSchema, type EventDetailResponse, updateEventSchema } from "@twg/shared"
import * as React from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

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
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api"
import { fromLocalInputs, toLocalInputs, useCreateEvent, useUpdateEvent } from "@/lib/events"
import { today } from "@/lib/expenses"
import { type FieldErrors, formErrorMessage, toFieldErrors, validate } from "@/lib/form-errors"

interface FormState {
  title: string
  date: string
  startTime: string
  endDate: string
  endTime: string
  location: string
  description: string
}

function initialState(event?: EventDetailResponse): FormState {
  if (!event) {
    return {
      title: "",
      date: today(),
      startTime: "19:00",
      endDate: "",
      endTime: "",
      location: "",
      description: "",
    }
  }
  const start = toLocalInputs(event.startsAt)
  const end = event.endsAt ? toLocalInputs(event.endsAt) : { date: "", time: "" }
  return {
    title: event.title,
    date: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    location: event.location ?? "",
    description: event.description ?? "",
  }
}

export function EventFormDialog({
  groupId,
  event,
  open,
  onOpenChange,
}: {
  groupId: string
  /** Given when editing. */
  event?: EventDetailResponse
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [state, setState] = React.useState(() => initialState(event))
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const create = useCreateEvent(groupId)
  const update = useUpdateEvent(groupId, event?.id ?? "")
  const navigate = useNavigate()
  const pending = create.isPending || update.isPending

  React.useEffect(() => {
    if (open) {
      setState(initialState(event))
      setFieldErrors({})
      setFormError(null)
    }
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const FIELD_FOR: Record<keyof FormState, string> = {
    title: "title",
    date: "startsAt",
    startTime: "startsAt",
    endDate: "endsAt",
    endTime: "endsAt",
    location: "location",
    description: "description",
  }
  const set = (key: keyof FormState, value: string) => {
    setFieldErrors(({ [FIELD_FOR[key]]: _cleared, ...rest }) => rest)
    setState((s) => ({ ...s, [key]: value }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errors: FieldErrors = {}
    const startsAt = fromLocalInputs(state.date, state.startTime)
    if (!startsAt) errors.startsAt = t("eventForm.chooseStart")
    let endsAt: string | null = null
    if (state.endTime) {
      // An end time on its own means the same day as the start.
      endsAt = fromLocalInputs(state.endDate || state.date, state.endTime)
      if (!endsAt) errors.endsAt = t("eventForm.validEnd")
    } else if (state.endDate) {
      errors.endsAt = t("eventForm.addEndTime")
    }

    const candidate = {
      title: state.title,
      startsAt: startsAt ?? "",
      endsAt,
      location: state.location,
      description: state.description,
      ...(event && { version: event.version }),
    }
    const { data, errors: schemaErrors } = event
      ? validate(updateEventSchema, candidate)
      : validate(createEventSchema, candidate)
    setFieldErrors({ ...schemaErrors, ...errors })
    setFormError(null)
    if (!data || Object.keys(errors).length > 0) return

    try {
      if (event) {
        await update.mutateAsync(candidate as typeof candidate & { version: number })
        toast.success(t("eventForm.updated"))
        onOpenChange(false)
      } else {
        const created = await create.mutateAsync(candidate)
        toast.success(t("eventForm.planned", { title: created.title }))
        onOpenChange(false)
        void navigate(`/groups/${groupId}/events/${created.id}`)
      }
    } catch (error) {
      if (error instanceof ApiError) setFieldErrors(toFieldErrors(error.issues))
      setFormError(formErrorMessage(error))
    }
  }

  const invalid = (field: string) => !!fieldErrors[field] || undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>{event ? t("eventForm.editTitle") : t("eventForm.planTitle")}</DialogTitle>
            <DialogDescription>
              {event ? t("eventForm.editHint") : t("eventForm.planHint")}
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <FieldGroup>
            <Field data-invalid={invalid("title")}>
              <FieldLabel htmlFor="event-title">{t("eventForm.what")}</FieldLabel>
              <Input
                id="event-title"
                value={state.title}
                placeholder={t("eventForm.titlePlaceholder")}
                autoFocus
                aria-invalid={invalid("title")}
                onChange={(e) => set("title", e.target.value)}
              />
              <FieldError>{fieldErrors.title}</FieldError>
            </Field>

            <Field data-invalid={invalid("startsAt")}>
              <FieldLabel htmlFor="event-date">{t("eventForm.starts")}</FieldLabel>
              <div className="grid grid-cols-[3fr_2fr] gap-3">
                <Input
                  id="event-date"
                  type="date"
                  value={state.date}
                  aria-invalid={invalid("startsAt")}
                  onChange={(e) => set("date", e.target.value)}
                />
                <Input
                  id="event-start-time"
                  type="time"
                  aria-label={t("eventForm.startTime")}
                  value={state.startTime}
                  aria-invalid={invalid("startsAt")}
                  onChange={(e) => set("startTime", e.target.value)}
                />
              </div>
              <FieldError>{fieldErrors.startsAt}</FieldError>
            </Field>

            <Field data-invalid={invalid("endsAt")}>
              <FieldLabel htmlFor="event-end-time">{t("eventForm.ends")}</FieldLabel>
              <div className="grid grid-cols-[3fr_2fr] gap-3">
                <Input
                  id="event-end-date"
                  type="date"
                  aria-label={t("eventForm.endDate")}
                  value={state.endDate}
                  min={state.date}
                  aria-invalid={invalid("endsAt")}
                  onChange={(e) => set("endDate", e.target.value)}
                />
                <Input
                  id="event-end-time"
                  type="time"
                  value={state.endTime}
                  aria-invalid={invalid("endsAt")}
                  onChange={(e) => set("endTime", e.target.value)}
                />
              </div>
              <FieldDescription>{t("eventForm.endHint")}</FieldDescription>
              <FieldError>{fieldErrors.endsAt}</FieldError>
            </Field>

            <Field data-invalid={invalid("location")}>
              <FieldLabel htmlFor="event-location">{t("eventForm.where")}</FieldLabel>
              <Input
                id="event-location"
                value={state.location}
                placeholder={t("eventForm.wherePlaceholder")}
                aria-invalid={invalid("location")}
                onChange={(e) => set("location", e.target.value)}
              />
              <FieldError>{fieldErrors.location}</FieldError>
            </Field>

            <Field data-invalid={invalid("description")}>
              <FieldLabel htmlFor="event-description">{t("eventForm.details")}</FieldLabel>
              <Textarea
                id="event-description"
                value={state.description}
                rows={3}
                aria-invalid={invalid("description")}
                onChange={(e) => set("description", e.target.value)}
              />
              <FieldError>{fieldErrors.description}</FieldError>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}
              {event ? t("common.saveChanges") : t("eventForm.plan")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
