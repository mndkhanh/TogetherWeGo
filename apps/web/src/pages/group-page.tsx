import { type ExpenseDetailResponse, roleAtLeast } from "@twg/shared"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  CalendarPlusIcon,
  EllipsisIcon,
  LogOutIcon,
  PencilIcon,
  PlusIcon,
  SearchXIcon,
} from "lucide-react"
import * as React from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

import { AppShell, useMe } from "@/components/app-shell"
import { ConfirmDialog, type ConfirmRequest } from "@/components/confirm-dialog"
import { EventFormDialog } from "@/components/events/event-form-dialog"
import { EventList } from "@/components/events/event-list"
import { BalancesPanel } from "@/components/expenses/balances-panel"
import { ExpenseDetailDialog } from "@/components/expenses/expense-detail-dialog"
import { ExpenseFormDialog } from "@/components/expenses/expense-form-dialog"
import { ExpenseList } from "@/components/expenses/expense-list"
import { EditGroupDialog } from "@/components/group/edit-group-dialog"
import { InviteCard } from "@/components/group/invite-card"
import { MembersCard } from "@/components/group/members-card"
import { type PaymentDraft, PaymentDialog } from "@/components/payments/payment-dialog"
import { PaymentsList } from "@/components/payments/payments-list"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiError } from "@/lib/api"
import { formErrorMessage } from "@/lib/form-errors"
import { useGroup, useRemoveMember, useSetArchived } from "@/lib/groups"

function BackLink() {
  const { t } = useTranslation()
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-fit"
      render={<Link to="/" />}
      nativeButton={false}
    >
      <ArrowLeftIcon data-icon="inline-start" />
      {t("group.allGroups")}
    </Button>
  )
}

function GroupNotFound() {
  const { t } = useTranslation()
  return (
    <Empty className="border border-dashed bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon />
        </EmptyMedia>
        <EmptyTitle>{t("group.notInGroup")}</EmptyTitle>
        <EmptyDescription>{t("group.notInGroupHint")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/" />} nativeButton={false}>
          {t("invite.goToGroups")}
        </Button>
      </EmptyContent>
    </Empty>
  )
}

export function GroupPage() {
  const { t } = useTranslation()
  const { groupId = "" } = useParams()
  const me = useMe()
  const navigate = useNavigate()
  const group = useGroup(groupId)
  const setArchived = useSetArchived(groupId)
  const removeMember = useRemoveMember(groupId)
  const [editing, setEditing] = React.useState(false)
  const [confirm, setConfirm] = React.useState<ConfirmRequest | null>(null)
  const [addingExpense, setAddingExpense] = React.useState(false)
  const [planning, setPlanning] = React.useState(false)
  const [editingExpense, setEditingExpense] = React.useState<ExpenseDetailResponse | null>(null)
  const [openExpenseId, setOpenExpenseId] = React.useState<string | null>(null)
  const [paymentDraft, setPaymentDraft] = React.useState<PaymentDraft | null>(null)
  const [openPaymentId, setOpenPaymentId] = React.useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get("tab") ?? "expenses"

  if (group.isPending) {
    return (
      <AppShell>
        <BackLink />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
      </AppShell>
    )
  }

  if (group.isError) {
    const notFound =
      group.error instanceof ApiError && (group.error.status === 404 || group.error.status === 400)
    return (
      <AppShell>
        <BackLink />
        {notFound ? (
          <GroupNotFound />
        ) : (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-4">
              {t("group.loadFailed")}
              <Button variant="outline" size="sm" onClick={() => void group.refetch()}>
                {t("common.tryAgain")}
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </AppShell>
    )
  }

  const data = group.data
  const isAdmin = roleAtLeast(data.myRole, "admin")
  const isOwner = data.myRole === "owner"
  const archived = data.archivedAt !== null

  function confirmArchive(next: boolean) {
    setConfirm({
      title: t(next ? "group.archiveTitle" : "group.unarchiveTitle", { name: data.name }),
      description: t(next ? "group.archiveHint" : "group.unarchiveHint"),
      confirmLabel: t(next ? "group.archive" : "group.unarchive"),
      onConfirm: async () => {
        try {
          await setArchived.mutateAsync(next)
          toast.success(t(next ? "group.archived" : "group.unarchived"))
        } catch (error) {
          toast.error(formErrorMessage(error) ?? t("group.somethingWrong"))
          throw error
        }
      },
    })
  }

  function confirmLeave() {
    setConfirm({
      title: t("group.leaveTitle", { name: data.name }),
      description: t("group.leaveHint"),
      confirmLabel: t("group.leave"),
      destructive: true,
      onConfirm: async () => {
        try {
          await removeMember.mutateAsync(me.id)
          toast.success(t("group.left", { name: data.name }))
          navigate("/", { replace: true })
        } catch (error) {
          toast.error(formErrorMessage(error) ?? t("group.leaveFailed"))
          throw error
        }
      },
    })
  }

  return (
    <AppShell>
      <BackLink />

      <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight break-words sm:text-4xl">
              {data.name}
            </h1>
            {archived && <Badge variant="outline">{t("group.archivedBadge")}</Badge>}
          </div>
          <p className="text-muted-foreground">
            {t("group.summary", {
              members: t("home.members", { count: data.memberCount }),
              currency: data.currency,
            })}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!archived && (
            <Button size="lg" onClick={() => setAddingExpense(true)}>
              <PlusIcon data-icon="inline-start" />
              {t("group.addExpense")}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="icon-lg" />}
              aria-label={t("group.options")}
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              {isAdmin && !archived && (
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => setEditing(true)}>
                    <PencilIcon />
                    {t("group.edit")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              )}
              {isOwner && (
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => confirmArchive(!archived)}>
                    {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                    {t(archived ? "group.unarchive" : "group.archive")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              )}
              {!isOwner && (
                <>
                  {isAdmin && !archived && <DropdownMenuSeparator />}
                  <DropdownMenuGroup>
                    <DropdownMenuItem variant="destructive" onClick={confirmLeave}>
                      <LogOutIcon />
                      {t("group.leave")}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>

      {archived && (
        <Alert>
          <ArchiveIcon />
          <AlertTitle>{t("group.archivedTitle")}</AlertTitle>
          <AlertDescription>
            {t(isOwner ? "group.archivedOwner" : "group.archivedMember")}
          </AlertDescription>
        </Alert>
      )}

      <Tabs
        value={tab}
        onValueChange={(value) =>
          setSearchParams(value === "expenses" ? {} : { tab: String(value) }, { replace: true })
        }
        className="gap-4"
      >
        <TabsList>
          <TabsTrigger value="expenses">{t("group.tabs.expenses")}</TabsTrigger>
          <TabsTrigger value="events">{t("group.tabs.events")}</TabsTrigger>
          <TabsTrigger value="balances">{t("group.tabs.balances")}</TabsTrigger>
          <TabsTrigger value="members">{t("group.tabs.members")}</TabsTrigger>
        </TabsList>
        <TabsContent value="expenses">
          <ExpenseList
            groupId={data.id}
            myUserId={me.id}
            onOpen={setOpenExpenseId}
            addButton={
              archived ? undefined : (
                <Button onClick={() => setAddingExpense(true)}>
                  <PlusIcon data-icon="inline-start" />
                  {t("group.addFirstExpense")}
                </Button>
              )
            }
          />
        </TabsContent>
        <TabsContent value="events" className="flex flex-col gap-4">
          {!archived && (
            <Button variant="outline" className="self-start" onClick={() => setPlanning(true)}>
              <CalendarPlusIcon data-icon="inline-start" />
              {t("group.planEvent")}
            </Button>
          )}
          <EventList groupId={data.id} />
        </TabsContent>
        <TabsContent value="balances">
          <BalancesPanel
            groupId={data.id}
            myUserId={me.id}
            onPay={setPaymentDraft}
            payments={<PaymentsList groupId={data.id} myUserId={me.id} onOpen={setOpenPaymentId} />}
          />
        </TabsContent>
        <TabsContent value="members">
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <MembersCard group={data} myUserId={me.id} onConfirm={setConfirm} />
            {isAdmin && !archived && (
              <InviteCard groupId={data.id} groupName={data.name} onConfirm={setConfirm} />
            )}
          </div>
        </TabsContent>
      </Tabs>

      <ExpenseFormDialog
        group={data}
        myUserId={me.id}
        open={addingExpense}
        onOpenChange={setAddingExpense}
      />
      {editingExpense && (
        <ExpenseFormDialog
          key={editingExpense.id}
          group={data}
          myUserId={me.id}
          expense={editingExpense}
          open
          onOpenChange={(open) => !open && setEditingExpense(null)}
        />
      )}
      <ExpenseDetailDialog
        groupId={data.id}
        expenseId={openExpenseId}
        myUserId={me.id}
        archived={archived}
        onClose={() => setOpenExpenseId(null)}
        onEdit={(expense) => {
          setOpenExpenseId(null)
          setEditingExpense(expense)
        }}
        onConfirm={setConfirm}
      />
      {isAdmin && <EditGroupDialog group={data} open={editing} onOpenChange={setEditing} />}
      <PaymentDialog
        groupId={data.id}
        currency={data.currency}
        myUserId={me.id}
        draft={paymentDraft}
        settlementId={openPaymentId}
        onClose={() => {
          setPaymentDraft(null)
          setOpenPaymentId(null)
        }}
      />
      <EventFormDialog groupId={data.id} open={planning} onOpenChange={setPlanning} />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </AppShell>
  )
}
