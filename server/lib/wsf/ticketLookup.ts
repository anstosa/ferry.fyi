import type { Ticket } from "shared/contracts/tickets";
import { getTicketLookupId } from "shared/lib/tickets";

import { fetchTicket, TicketLookupUnavailableError } from "~/lib/wsf/ticket";
import {
  getTicketLookupUserAgent,
  TICKET_LOOKUP_CACHE_TTL_SECONDS,
} from "~/lib/wsf/ticketSettings";
import {
  deleteUserTicket,
  readUserTicket,
  writeUserTicket,
} from "~/lib/wsf/userTicketCache";

interface CachedTicket {
  expiresAt: number;
  sourceUpdatedAt: number;
  ticket: Ticket;
}

export interface TicketLookupResult {
  sourceUpdatedAt: number;
  ticket: Ticket | null;
}

const MAX_CACHED_TICKETS = 250;
const cache = new Map<string, CachedTicket>();
let lookupTail: Promise<void> = Promise.resolve();

// fresh memory cache read
const readCachedTicket = (
  lookupId: string,
  now: number
): CachedTicket | undefined => {
  const cached = cache.get(lookupId);
  // cache miss guard
  if (!cached) {
    return undefined;
  }
  // expiration guard
  if (cached.expiresAt <= now) {
    cache.delete(lookupId);
    return undefined;
  }
  return cached;
};

// bounded memory cache write
const cacheTicket = (
  lookupId: string,
  ticket: Ticket,
  now: number
): CachedTicket => {
  // capacity guard
  if (cache.size >= MAX_CACHED_TICKETS) {
    const oldestKey = cache.keys().next().value;
    // eviction key guard
    if (typeof oldestKey === "string") {
      cache.delete(oldestKey);
    }
  }
  const cached = {
    expiresAt: now + TICKET_LOOKUP_CACHE_TTL_SECONDS * 1_000,
    sourceUpdatedAt: now / 1_000,
    ticket,
  };
  cache.set(lookupId, cached);
  return cached;
};

// cached result adapter
const toLookupResult = (
  cached: Pick<CachedTicket, "sourceUpdatedAt" | "ticket">
): TicketLookupResult => ({
  sourceUpdatedAt: cached.sourceUpdatedAt,
  ticket: cached.ticket,
});

// optional account cache read
const readPersistedTicket = async (
  subject: string,
  lookupId: string
): Promise<Awaited<ReturnType<typeof readUserTicket>> | undefined> => {
  try {
    return await readUserTicket(
      subject,
      lookupId,
      TICKET_LOOKUP_CACHE_TTL_SECONDS
    );
  } catch (error) {
    console.error("Failed to read account ticket cache", error);
    return undefined;
  }
};

// authenticated result persistence
const persistLookupResult = async (
  subject: string | undefined,
  lookupId: string,
  result: TicketLookupResult
): Promise<TicketLookupResult> => {
  // signed-in persistence guard
  if (subject && result.ticket) {
    try {
      await writeUserTicket(subject, lookupId, {
        sourceUpdatedAt: result.sourceUpdatedAt,
        ticket: result.ticket,
      });
    } catch (error) {
      console.error("Failed to write account ticket cache", error);
    }
  }
  return result;
};

// serialized upstream execution
const serializeLookup = <T>(task: () => Promise<T>): Promise<T> => {
  const result = lookupTail.then(task, task);
  lookupTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
};

// layered ticket lookup
export const lookupTicket = async (
  ticketId: string,
  subject?: string
): Promise<TicketLookupResult> => {
  const lookupId = getTicketLookupId(ticketId);
  let persistedFallback: TicketLookupResult | undefined;
  // account cache guard
  if (subject) {
    const persisted = await readPersistedTicket(subject, lookupId);
    // fresh persisted result
    if (persisted?.fresh) {
      return {
        sourceUpdatedAt: persisted.sourceUpdatedAt,
        ticket: persisted.ticket,
      };
    }
    // stale fallback capture
    if (persisted) {
      persistedFallback = {
        sourceUpdatedAt: persisted.sourceUpdatedAt,
        ticket: persisted.ticket,
      };
    }
  }
  const cached = readCachedTicket(lookupId, Date.now());
  // shared cache hit
  if (cached) {
    return await persistLookupResult(subject, lookupId, toLookupResult(cached));
  }

  try {
    return await serializeLookup(async () => {
      const now = Date.now();
      const queuedCacheHit = readCachedTicket(lookupId, now);
      // queued cache hit
      if (queuedCacheHit) {
        return await persistLookupResult(
          subject,
          lookupId,
          toLookupResult(queuedCacheHit)
        );
      }
      const userAgent = await getTicketLookupUserAgent();
      const ticket = await fetchTicket(lookupId, { userAgent });
      // missing ticket guard
      if (!ticket) {
        return { sourceUpdatedAt: now / 1_000, ticket: null };
      }
      const stored = cacheTicket(lookupId, ticket, now);
      return await persistLookupResult(
        subject,
        lookupId,
        toLookupResult(stored)
      );
    });
  } catch (error) {
    // stale account fallback
    if (persistedFallback && error instanceof TicketLookupUnavailableError) {
      return persistedFallback;
    }
    throw error;
  }
};

// account ticket deletion
export const forgetTicket = async (
  ticketId: string,
  subject: string
): Promise<void> => {
  await deleteUserTicket(subject, getTicketLookupId(ticketId));
};

// memory cache reset
export const resetTicketLookupRuntime = (): void => {
  cache.clear();
};
