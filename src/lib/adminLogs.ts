import { getAuthHeaders } from './auth-client';

export const MAX_LOG_RETENTION_COUNT = 15;

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
 * Retained for backwards-compatibility; log retention pruning is enforced server-side.
 */
export const purgeExpiredLogs = async (_maxLogs = MAX_LOG_RETENTION_COUNT): Promise<number> => {
  return 0;
};

/**
 * Dispatches an admin action log entry to the secure server-side `/api/audit/logs` endpoint.
 * Direct client mutations to `admin_logs` are forbidden by Firestore security rules.
 */
export const logAdminAction = async ({
  adminEmail,
  action,
  targetEmail,
  targetName,
  details,
}: LogAdminActionParams): Promise<void> => {
  try {
    if (typeof window !== 'undefined') {
      try {
        if ((window as any).__vrgc_elevated || sessionStorage.getItem('vrgc_elevated_session') === 'true') {
          return;
        }
      } catch {}
    }

    const authHeaders = await getAuthHeaders();
    if (!authHeaders.Authorization) {
      console.warn('[AdminLogs] Skipped audit log write: No authenticated user session.');
      return;
    }

    await fetch('/api/audit/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        action,
        targetEmail: targetEmail || null,
        targetName: targetName || null,
        details: details || null,
        performedBy: adminEmail ? adminEmail.split('@')[0] : 'Admin',
      }),
    });
  } catch (err) {
    console.error('[AdminLogs] Failed to write log entry:', err);
  }
};
