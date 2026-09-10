import { db } from './firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
  where,
  limit,
} from 'firebase/firestore';

export interface SupportTicket {
  id: string;
  ticketId: string;
  fullName: string;
  contactInfo: string;
  regNo?: string;
  category: string;
  message: string;
  status: 'unsolved' | 'solved';
  createdAt: string;
  updatedAt?: string;
  solvedAt?: string | null;
  resolvedBy?: string | null;
  resolutionNote?: string | null;
}

export const SUPPORT_COLLECTION = 'support_tickets';
export const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

/**
 * Check if a ticket has been solved for more than 12 hours.
 * If solved > 12 hours, it must be permanently deleted from Firebase and removed from frontend.
 */
export function isTicketExpired(ticket: Partial<SupportTicket>): boolean {
  if (ticket.status !== 'solved' || !ticket.solvedAt) return false;
  const solvedTime = new Date(ticket.solvedAt).getTime();
  if (isNaN(solvedTime)) return false;
  return Date.now() - solvedTime >= TWELVE_HOURS_MS;
}

/**
 * Returns formatted remaining time string before 12-hour removal (e.g. "11h 45m remaining").
 */
export function getRemainingSolvedTime(ticket: Partial<SupportTicket>): string {
  if (ticket.status !== 'solved' || !ticket.solvedAt) return '';
  const solvedTime = new Date(ticket.solvedAt).getTime();
  if (isNaN(solvedTime)) return '';
  const remainingMs = TWELVE_HOURS_MS - (Date.now() - solvedTime);
  if (remainingMs <= 0) return 'Archived (12h expired)';
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) {
    return `${hours}h ${minutes}m left until auto-removal`;
  }
  return `${minutes}m left until auto-removal`;
}

/**
 * Store submitted ticket ID in user's browser localStorage for personal history tracking.
 */
export function saveTicketToUserHistory(ticketId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem('vrgc_user_tickets');
    const list: string[] = raw ? JSON.parse(raw) : [];
    if (!list.includes(ticketId)) {
      list.unshift(ticketId);
      // Keep up to 30 recent tickets
      localStorage.setItem('vrgc_user_tickets', JSON.stringify(list.slice(0, 30)));
    }
  } catch (err) {
    console.warn('Failed to save ticket to localStorage history:', err);
  }
}

/**
 * Remove ticket from user's localStorage history.
 */
export function removeTicketFromUserHistory(ticketId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem('vrgc_user_tickets');
    if (!raw) return;
    const list: string[] = JSON.parse(raw);
    const updated = list.filter((id) => id.toUpperCase() !== ticketId.trim().toUpperCase());
    localStorage.setItem('vrgc_user_tickets', JSON.stringify(updated));
  } catch (err) {
    console.warn('Failed to remove ticket from localStorage history:', err);
  }
}

/**
 * Get user's saved ticket IDs from localStorage.
 */
export function getUserHistoryTicketIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('vrgc_user_tickets');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Permanently delete a support ticket from Firebase Firestore and user history.
 */
export async function deleteTicketPermanently(ticketId: string): Promise<void> {
  const cleanId = ticketId.trim().toUpperCase();
  if (!cleanId) return;

  try {
    // 1. Delete direct document ID match
    const directRef = doc(db, SUPPORT_COLLECTION, cleanId);
    await deleteDoc(directRef).catch(() => {});

    // 2. Also delete any matching document by `ticketId` field (in case Firestore doc ID is auto-generated)
    const q = query(collection(db, SUPPORT_COLLECTION), where('ticketId', '==', cleanId), limit(5));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const batch = writeBatch(db);
      snap.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    // 3. Prune from localStorage history
    removeTicketFromUserHistory(cleanId);
    console.log(`[SupportDesk] Permanently deleted ticket ${cleanId} from Firebase.`);
  } catch (err) {
    console.error(`[SupportDesk] Error permanently deleting ticket ${cleanId}:`, err);
    throw err;
  }
}

/**
 * Proactively sweep and delete any tickets from Firestore where status is 'solved'
 * and solvedAt is older than 12 hours.
 */
export async function cleanupExpiredSupportTickets(): Promise<number> {
  try {
    const now = Date.now();
    const q = query(
      collection(db, SUPPORT_COLLECTION),
      where('status', '==', 'solved'),
      limit(200)
    );
    const snap = await getDocs(q);
    const expiredRefs: any[] = [];

    snap.forEach((d) => {
      const data = d.data();
      if (data.solvedAt) {
        const solvedMs = new Date(data.solvedAt).getTime();
        if (!isNaN(solvedMs) && (now - solvedMs) >= TWELVE_HOURS_MS) {
          expiredRefs.push(d.ref);
        }
      }
    });

    if (expiredRefs.length > 0) {
      const batch = writeBatch(db);
      expiredRefs.forEach((ref) => batch.delete(ref));
      await batch.commit();
      console.log(`[SupportDesk] Periodic sweep permanently deleted ${expiredRefs.length} expired ticket(s) from Firebase.`);
    }

    return expiredRefs.length;
  } catch (err) {
    console.warn('[SupportDesk] Error in cleanupExpiredSupportTickets:', err);
    return 0;
  }
}

/**
 * Fetch a single ticket by its generated ID (e.g. "VRGC-SUP-123456").
 * If the ticket was solved > 12 hours ago, it is permanently deleted from Firestore and returns null.
 */
export async function fetchTicketById(ticketId: string): Promise<SupportTicket | null> {
  const cleanId = ticketId.trim().toUpperCase();
  if (!cleanId) return null;

  try {
    // 1. Direct doc lookup
    const docRef = doc(db, SUPPORT_COLLECTION, cleanId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      const ticket: SupportTicket = {
        id: snap.id,
        ticketId: data.ticketId || snap.id,
        fullName: data.fullName || 'Anonymous User',
        contactInfo: data.contactInfo || 'Not provided',
        regNo: data.regNo || '',
        category: data.category || 'general',
        message: data.message || '',
        status: data.status === 'solved' ? 'solved' : 'unsolved',
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt,
        solvedAt: data.solvedAt || null,
        resolvedBy: data.resolvedBy || null,
        resolutionNote: data.resolutionNote || null,
      };

      // If expired, permanently delete from Firebase right now
      if (isTicketExpired(ticket)) {
        await deleteDoc(docRef).catch(console.warn);
        removeTicketFromUserHistory(cleanId);
        return null;
      }

      return ticket;
    }

    // 2. Query lookup by ticketId field
    const q = query(collection(db, SUPPORT_COLLECTION), where('ticketId', '==', cleanId), limit(1));
    const querySnap = await getDocs(q);
    if (!querySnap.empty) {
      const docItem = querySnap.docs[0];
      const data = docItem.data();
      const ticket: SupportTicket = {
        id: docItem.id,
        ticketId: data.ticketId || docItem.id,
        fullName: data.fullName || 'Anonymous User',
        contactInfo: data.contactInfo || 'Not provided',
        regNo: data.regNo || '',
        category: data.category || 'general',
        message: data.message || '',
        status: data.status === 'solved' ? 'solved' : 'unsolved',
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt,
        solvedAt: data.solvedAt || null,
        resolvedBy: data.resolvedBy || null,
        resolutionNote: data.resolutionNote || null,
      };

      // If expired, permanently delete from Firebase right now
      if (isTicketExpired(ticket)) {
        await deleteDoc(docItem.ref).catch(console.warn);
        removeTicketFromUserHistory(cleanId);
        return null;
      }

      return ticket;
    }
    return null;
  } catch (err) {
    console.error('Error fetching ticket by ID:', err);
    return null;
  }
}

/**
 * Fetch all tickets for Admin/SuperAdmin/Technical resolution desk.
 * Automatically deletes any tickets from Firebase that have been solved for more than 12 hours.
 */
export async function fetchAllActiveTickets(): Promise<SupportTicket[]> {
  try {
    const q = query(collection(db, SUPPORT_COLLECTION), orderBy('createdAt', 'desc'), limit(150));
    const snap = await getDocs(q);
    const list: SupportTicket[] = [];
    const expiredDocRefs: any[] = [];

    snap.forEach((docItem) => {
      const data = docItem.data();
      const ticket: SupportTicket = {
        id: docItem.id,
        ticketId: data.ticketId || docItem.id,
        fullName: data.fullName || 'Anonymous',
        contactInfo: data.contactInfo || '',
        regNo: data.regNo || '',
        category: data.category || 'general',
        message: data.message || '',
        status: data.status === 'solved' ? 'solved' : 'unsolved',
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt,
        solvedAt: data.solvedAt || null,
        resolvedBy: data.resolvedBy || null,
        resolutionNote: data.resolutionNote || null,
      };

      // If solved > 12 hours ago, queue for permanent deletion from Firebase
      if (isTicketExpired(ticket)) {
        expiredDocRefs.push(docItem.ref);
      } else {
        list.push(ticket);
      }
    });

    // Permanently batch-delete all expired tickets from Firebase
    if (expiredDocRefs.length > 0) {
      const batch = writeBatch(db);
      expiredDocRefs.forEach((ref) => batch.delete(ref));
      await batch.commit().catch((err) =>
        console.warn('[SupportDesk] Batch delete expired tickets error:', err)
      );
      console.log(`[SupportDesk] Permanently deleted ${expiredDocRefs.length} expired ticket(s) from Firebase.`);
    }

    return list;
  } catch (err) {
    console.error('Error fetching all tickets:', err);
    return [];
  }
}

/**
 * Mark a ticket as Solved (with solvedAt timestamp and resolver email).
 */
export async function resolveTicket(
  ticketId: string,
  resolvedBy: string,
  resolutionNote?: string
): Promise<void> {
  const cleanId = ticketId.trim().toUpperCase();
  const docRef = doc(db, SUPPORT_COLLECTION, cleanId);
  const now = new Date().toISOString();

  await updateDoc(docRef, {
    status: 'solved',
    solvedAt: now,
    updatedAt: now,
    resolvedBy: resolvedBy || 'Admin',
    resolutionNote: resolutionNote?.trim() || 'Resolved by Administrator.',
  });
}

/**
 * Reopen a ticket (set status back to unsolved).
 */
export async function reopenTicket(ticketId: string): Promise<void> {
  const cleanId = ticketId.trim().toUpperCase();
  const docRef = doc(db, SUPPORT_COLLECTION, cleanId);
  const now = new Date().toISOString();

  await updateDoc(docRef, {
    status: 'unsolved',
    solvedAt: null,
    updatedAt: now,
    resolutionNote: null,
  });
}
