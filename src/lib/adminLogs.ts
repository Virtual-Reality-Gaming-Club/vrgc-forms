import { collection, addDoc, serverTimestamp, getDocs, deleteDoc, doc, query, orderBy } from 'firebase/firestore';
import { db } from './firebase';

export const MAX_LOG_RETENTION_COUNT = 15;
export const MAX_MEMBER_LOG_RETENTION_COUNT = 50;

export type AdminActionType =
  | 'VERIFY'
  | 'PAYMENT_PAID'
  | 'SET_PENDING'
  | 'CREATE_DUE'
  | 'EDIT_DUE'
  | 'EDIT_INVOICE_CAMPAIGN'
  | 'EDIT_INVOICE_SINGLE'
  | 'ASSIGN_ALL'
  | 'ASSIGN_MULTI'
  | 'DELETE'
  | 'SYNC_SHEETS'
  | 'DOWNLOAD';

export type MemberAdminActionType =
  | 'MEMBER_CREATED'
  | 'MEMBER_UPDATED'
  | 'MEMBER_DELETED';

interface LogAdminActionParams {
  adminEmail: string;
  action: AdminActionType;
  targetEmail?: string;
  targetName?: string;
  details?: string;
}

export interface MemberLogChanges {
  [field: string]: { from: string; to: string };
}

interface LogMemberAdminActionParams {
  adminEmail: string;
  adminName: string;
  action: MemberAdminActionType;
  targetId: string;
  targetName: string;
  targetEmail?: string;
  targetRegNo?: string;
  changes?: MemberLogChanges;
  details?: string;
}

/**
 * Automatically prunes a Firestore collection to keep only the latest N logs.
 */
const purgeCollection = async (collectionName: string, maxLogs: number): Promise<number> => {
  try {
    const q = query(collection(db, collectionName), orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);

    if (snap.docs.length <= maxLogs) return 0;

    const docsToDelete = snap.docs.slice(maxLogs);
    let deletedCount = 0;

    const deletions = docsToDelete.map(async (docSnap) => {
      await deleteDoc(doc(db, collectionName, docSnap.id));
      deletedCount++;
    });

    await Promise.allSettled(deletions);
    return deletedCount;
  } catch (err) {
    console.warn(`[AdminLogs] Retention cleanup for ${collectionName}:`, err);
    return 0;
  }
};

/**
 * Automatically prunes the Firestore `admin_logs` collection to keep only the latest 15 logs.
 * Any log beyond the top 15 most recent entries is permanently deleted from Firestore.
 */
export const purgeExpiredLogs = async (maxLogs = MAX_LOG_RETENTION_COUNT): Promise<number> => {
  return purgeCollection('admin_logs', maxLogs);
};

/**
 * Writes an admin action log entry to the `admin_logs` Firestore collection.
 * Automatically retains only the latest 15 logs in Firebase by pruning older ones in the background.
 */
export const logAdminAction = async ({
  adminEmail,
  action,
  targetEmail,
  targetName,
  details,
}: LogAdminActionParams): Promise<void> => {
  try {
    await addDoc(collection(db, 'admin_logs'), {
      adminEmail,
      action,
      targetEmail: targetEmail || null,
      targetName: targetName || null,
      details: details || null,
      timestamp: serverTimestamp(),
    });

    // Automatically enforce 15-logs retention limit in Firebase
    purgeExpiredLogs(MAX_LOG_RETENTION_COUNT).catch(() => {});
  } catch (err) {
    console.error('[AdminLogs] Failed to write log entry:', err);
  }
};

/**
 * Writes a member management audit log entry to the `member_admin_logs` Firestore collection.
 * Separate from the general admin_logs to preserve member audit trail (50-entry retention).
 */
export const logMemberAdminAction = async ({
  adminEmail,
  adminName,
  action,
  targetId,
  targetName,
  targetEmail,
  targetRegNo,
  changes,
  details,
}: LogMemberAdminActionParams): Promise<void> => {
  try {
    await addDoc(collection(db, 'member_admin_logs'), {
      adminEmail,
      adminName,
      action,
      targetType: 'member',
      targetId,
      targetName,
      targetEmail: targetEmail || null,
      targetRegNo: targetRegNo || null,
      changes: changes || null,
      details: details || null,
      timestamp: serverTimestamp(),
    });

    // Enforce 50-entry retention limit for member admin logs
    purgeCollection('member_admin_logs', MAX_MEMBER_LOG_RETENTION_COUNT).catch(() => {});
  } catch (err) {
    console.error('[AdminLogs] Failed to write member admin log entry:', err);
  }
};
