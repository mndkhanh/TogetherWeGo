import { BadRequestException } from '@nestjs/common';
import {
  type EventSummaryResponse,
  type GroupRole,
  roleAtLeast,
  type RsvpStatus,
} from '@twg/shared';
import { personSelect, toPerson } from '../expenses/expense-mappers.js';
import type { Event, EventRsvp, User } from '../generated/prisma/client.js';

type PersonRow = Pick<User, 'id' | 'name' | 'avatarKey'>;

export const eventInclude = {
  creator: { select: personSelect },
  rsvps: { include: { user: { select: personSelect } }, orderBy: { updatedAt: 'asc' } },
  _count: { select: { comments: { where: { deletedAt: null } } } },
} as const;

export type EventWithPeople = Event & {
  creator: PersonRow;
  rsvps: (EventRsvp & { user: PersonRow })[];
  _count: { comments: number };
};

/** The creator or a group admin may edit or cancel an event. */
export function canEditEvent(event: Pick<Event, 'createdBy'>, userId: string, role: GroupRole) {
  return event.createdBy === userId || roleAtLeast(role, 'admin');
}

/**
 * RSVPs from people who have since left stay in the table (they were true at the time) but
 * don't count: `activeIds` is the group's current members.
 */
export function toEventSummary(
  event: EventWithPeople,
  me: { userId: string; role: GroupRole },
  activeIds: Set<string>,
): EventSummaryResponse {
  const current = event.rsvps.filter((r) => activeIds.has(r.userId));
  const going = current.filter((r) => r.status === 'going');
  return {
    id: event.id,
    groupId: event.groupId,
    title: event.title,
    location: event.location,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt?.toISOString() ?? null,
    status: event.status,
    createdBy: toPerson(event.creator),
    going: going.length,
    maybe: current.filter((r) => r.status === 'maybe').length,
    goingPreview: going.slice(0, 5).map((r) => toPerson(r.user)),
    myRsvp: (current.find((r) => r.userId === me.userId)?.status as RsvpStatus) ?? null,
    commentCount: event._count.comments,
    canEdit: canEditEvent(event, me.userId, me.role),
    version: event.version,
  };
}

/** What the activity log keeps about an event. */
export function eventSnapshot(event: Event) {
  return {
    title: event.title,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt?.toISOString() ?? null,
    location: event.location,
    description: event.description,
    status: event.status,
  };
}

// Cursor = "<ISO time>_<id>", base64url-encoded. Opaque to clients.
export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}_${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { at: Date; id: string } {
  const text = Buffer.from(cursor, 'base64url').toString();
  // A strict UUID: anything looser (e.g. 36 hyphens) would reach Postgres and fail as a 500.
  const match =
    /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(
      text,
    );
  const at = match ? new Date(match[1]!) : null;
  if (!match || !at || Number.isNaN(at.getTime())) throw new BadRequestException('Invalid cursor');
  return { at, id: match[2]! };
}
