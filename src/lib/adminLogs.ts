import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

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

interface LogAdminActionParams {
  adminEmail: string;
  action: AdminActionType;
  targetEmail?: string;
  targetName?: string;
  details?: string;
}

/**
 * Writes an admin action log entry to the `admin_logs` Firestore collection.
 * Fire-and-forget — errors are silently caught to avoid disrupting the main flow.
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
  } catch (err) {
    console.error('[AdminLogs] Failed to write log entry:', err);
  }
};
