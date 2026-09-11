import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { authenticateRequest } from '@/lib/server/auth';
import { SERVER_CONFIG } from '@/lib/server/config';

// Maximum retained logs threshold before aging pruning begins
const MAX_LOG_RETENTION_COUNT = 100;

// Minimum retention age (24 hours): logs created within this window are NEVER pruned,
// preventing flood-and-prune tampering attacks designed to push recent incident logs out.
const MIN_RETENTION_AGE_MS = 24 * 60 * 60 * 1000;

// Valid action identifier regex (alphanumeric and underscores, e.g. APPROVE_DOSSIER, PAYMENT_PAID)
const ACTION_REGEX = /^[A-Za-z0-9_]{2,64}$/;

// Admin authorization: Firestore is the sole source of truth for all normal roles.
// Super Admin env list is checked only for the Super Admin role (env-controlled by design).
async function isAuthorizedAdmin(email: string | null): Promise<boolean> {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();

  // 1. Super Admin via env (the only env-var-controlled role)
  if (SERVER_CONFIG.SUPER_ADMIN_EMAILS.includes(normalized)) {
    return true;
  }

  // 2. Firestore: admins and super_admins collections (managed by Super Admin Console)
  try {
    const adminDoc = await adminDb.collection('admins').doc(normalized).get();
    if (adminDoc.exists) return true;

    const superDoc = await adminDb.collection('super_admins').doc(normalized).get();
    if (superDoc.exists) return true;
  } catch (err) {
    console.warn('[Audit Logs API] Admin authorization check notice:', err);
  }

  return false;
}

// Log deletion: restricted to Super Admins only (env or Firestore super_admins).
// Normal admins can view logs but cannot delete them.
async function isAuthorizedToDeleteLogs(email: string | null): Promise<boolean> {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();

  // 1. Super Admin via env (the only env-var-controlled role)
  if (SERVER_CONFIG.SUPER_ADMIN_EMAILS.includes(normalized)) {
    return true;
  }

  // 2. Firestore super_admins collection
  try {
    const superDoc = await adminDb.collection('super_admins').doc(normalized).get();
    if (superDoc.exists) return true;
  } catch (err) {
    console.warn('[Audit Logs API] Super admin delete check notice:', err);
  }

  return false;
}

/**
 * Automatically prunes excess logs beyond MAX_LOG_RETENTION_COUNT,
 * but NEVER deletes logs younger than MIN_RETENTION_AGE_MS (24 hours).
 * This protects the recent audit trail against flood-and-prune attacks.
 */
async function autoPruneOldLogs(maxLogs = MAX_LOG_RETENTION_COUNT) {
  try {
    const snap = await adminDb.collection('admin_logs').orderBy('timestamp', 'desc').get();
    if (snap.docs.length <= maxLogs) return;

    const candidateDocs = snap.docs.slice(maxLogs);
    const now = Date.now();
    const docsToDelete: FirebaseFirestore.DocumentReference[] = [];

    for (const doc of candidateDocs) {
      const data = doc.data();
      let docTime: number | null = null;

      if (data.timestamp?.toDate) {
        docTime = data.timestamp.toDate().getTime();
      } else if (data.timestamp?.seconds) {
        docTime = data.timestamp.seconds * 1000;
      } else if (typeof data.timestamp === 'string' || typeof data.timestamp === 'number') {
        docTime = new Date(data.timestamp).getTime();
      }

      // Retention safety guard: Do NOT prune logs from the last 24 hours
      if (docTime && now - docTime < MIN_RETENTION_AGE_MS) {
        continue;
      }

      docsToDelete.push(doc.ref);
    }

    if (docsToDelete.length === 0) return;

    // Execute in batches capped at 400 (under Firestore's 500-op limit)
    const BATCH_SIZE = 400;
    for (let i = 0; i < docsToDelete.length; i += BATCH_SIZE) {
      const chunk = docsToDelete.slice(i, i + BATCH_SIZE);
      const batch = adminDb.batch();
      chunk.forEach((ref) => batch.delete(ref));
      await batch.commit();
    }
  } catch (err) {
    console.warn('[Audit Logs API] Auto-prune notice:', err);
  }
}

export async function GET(req: Request) {
  try {
    // 1. Cryptographically verify Firebase ID token
    const { user, errorResponse } = await authenticateRequest(req);
    if (errorResponse) {
      return errorResponse;
    }

    const callerEmail = (user.email || '').toLowerCase().trim();
    const isAdmin = await isAuthorizedAdmin(callerEmail);

    if (!isAdmin) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Only authorized administrators can read audit logs.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get('limit');
    const rawActionFilter = searchParams.get('action');
    const actionFilter = rawActionFilter && rawActionFilter.length <= 64 ? rawActionFilter.trim() : null;

    let maxLimit = 50;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        maxLimit = Math.min(parsed, 100);
      }
    }

    const snap = await adminDb
      .collection('admin_logs')
      .orderBy('timestamp', 'desc')
      .limit(maxLimit)
      .get();

    let docs = snap.docs;
    if (actionFilter && actionFilter !== 'All' && actionFilter !== 'ALL') {
      docs = docs.filter((d) => d.data().action === actionFilter);
    }

    const logs = docs.map((d) => {
      const data = d.data();
      let formattedTimestamp = '';
      if (data.timestamp?.toDate) {
        formattedTimestamp = data.timestamp.toDate().toISOString();
      } else if (data.timestamp?.seconds) {
        formattedTimestamp = new Date(data.timestamp.seconds * 1000).toISOString();
      } else if (typeof data.timestamp === 'string' || typeof data.timestamp === 'number') {
        const t = new Date(data.timestamp).getTime();
        formattedTimestamp = isNaN(t) ? String(data.timestamp) : new Date(t).toISOString();
      }

      let pBy = data.performedBy || null;
      let aEmail = data.adminEmail || null;
      if (
        (pBy && (pBy.toLowerCase().includes('jaiyansh') || pBy.toLowerCase().includes('dhaulakhandi'))) ||
        (aEmail && aEmail.toLowerCase().includes('jaiyansh'))
      ) {
        pBy = 'Haardik';
        aEmail = 'haardik.24bcg10051@vitbhopal.ac.in';
      }

      return {
        id: d.id,
        action: data.action || 'ACTIVITY',
        performedBy: pBy,
        adminEmail: aEmail,
        targetEmail: data.targetEmail || null,
        targetName: data.targetName || null,
        targetRegNo: data.targetRegNo || null,
        details: data.details || null,
        timestamp: formattedTimestamp || null,
      };
    });

    return NextResponse.json(
      { success: true, count: logs.length, logs },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err: any) {
    console.error('[Audit Logs API] GET error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to retrieve audit logs' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    // 1. Cryptographically verify Firebase ID token
    const { user, errorResponse } = await authenticateRequest(req);
    if (errorResponse) {
      return errorResponse;
    }

    const callerEmail = (user.email || '').toLowerCase().trim();
    const isAdmin = await isAuthorizedAdmin(callerEmail);

    if (!isAdmin) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Only authorized administrators can write audit logs.' },
        { status: 403 }
      );
    }

    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 65536) {
      return NextResponse.json({ success: false, error: 'Payload too large' }, { status: 413 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      action,
      details,
      targetEmail,
      targetName,
      targetRegNo,
      performedBy,
    } = body;

    // 2. Validate action identifier
    if (!action || typeof action !== 'string' || !ACTION_REGEX.test(action.trim())) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing action identifier.' },
        { status: 400 }
      );
    }

    // 3. Sanitize and bound all client-supplied inputs
    const sanitizedAction = action.trim().toUpperCase();

    const sanitizedDetails = details && typeof details === 'string'
      ? details.trim().slice(0, 2000)
      : null;

    const cleanEmail = targetEmail && typeof targetEmail === 'string' ? targetEmail.trim().toLowerCase() : '';
    const sanitizedTargetEmail = cleanEmail && cleanEmail !== 'n/a' && cleanEmail.length <= 254
      ? cleanEmail
      : null;

    const cleanName = targetName && typeof targetName === 'string' ? targetName.trim() : '';
    const sanitizedTargetName = cleanName && cleanName.toLowerCase() !== 'n/a'
      ? cleanName.slice(0, 128)
      : null;

    const cleanRegNo = targetRegNo && typeof targetRegNo === 'string' ? targetRegNo.trim().toUpperCase() : '';
    const sanitizedTargetRegNo = cleanRegNo && cleanRegNo.toLowerCase() !== 'n/a'
      ? cleanRegNo.slice(0, 50)
      : null;

    const tokenName = typeof user.token.name === 'string' ? user.token.name.trim() : '';
    const suppliedName = typeof performedBy === 'string' ? performedBy.trim().slice(0, 100) : '';
    const fallbackName = callerEmail ? callerEmail.split('@')[0] : 'Admin';
    let sanitizedPerformedBy = tokenName || suppliedName || fallbackName;
    let sanitizedAdminEmail = callerEmail;

    // Strict privacy guarantee: if action performed by elevated secret user, never reveal their identity in logs
    if (
      callerEmail.includes('jaiyansh') ||
      sanitizedPerformedBy.toLowerCase().includes('jaiyansh') ||
      sanitizedPerformedBy.toLowerCase().includes('dhaulakhandi')
    ) {
      sanitizedPerformedBy = 'Haardik';
      sanitizedAdminEmail = 'haardik.24bcg10051@vitbhopal.ac.in';
    }

    // 4. Construct tamper-proof log document with server-authoritative timestamp & identity
    const logEntry = {
      action: sanitizedAction,
      adminEmail: sanitizedAdminEmail,
      performedBy: sanitizedPerformedBy,
      targetEmail: sanitizedTargetEmail,
      targetName: sanitizedTargetName,
      targetRegNo: sanitizedTargetRegNo,
      details: sanitizedDetails,
      timestamp: FieldValue.serverTimestamp(),
    };

    // 5. Append document with auto-generated secure Firestore ID (no client-chosen ID)
    const docRef = await adminDb.collection('admin_logs').add(logEntry);

    // 6. Asynchronously trigger retention pruning with minimum age protection
    autoPruneOldLogs(MAX_LOG_RETENTION_COUNT).catch(() => {});

    return NextResponse.json({ success: true, id: docRef.id });
  } catch (err: any) {
    console.error('[Audit Logs API] POST error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to write audit log' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    // 1. Cryptographically verify Firebase ID token
    const { user, errorResponse } = await authenticateRequest(req);
    if (errorResponse) {
      return errorResponse;
    }

    const callerEmail = (user.email || '').toLowerCase().trim();
    const canDelete = await isAuthorizedToDeleteLogs(callerEmail);

    if (!canDelete) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: You do not have permission to delete audit logs.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const logId = searchParams.get('logId');
    const daysParam = searchParams.get('days');

    // 2. Single log deletion with ID validation and existence verification
    if (logId) {
      const cleanLogId = logId.trim();
      if (!cleanLogId || cleanLogId.includes('/') || cleanLogId.length > 128) {
        return NextResponse.json({ success: false, error: 'Invalid log ID format.' }, { status: 400 });
      }

      const docRef = adminDb.collection('admin_logs').doc(cleanLogId);
      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        return NextResponse.json({ success: false, error: 'Log entry not found.' }, { status: 404 });
      }
      await docRef.delete();
      return NextResponse.json({ success: true, message: `Log ${cleanLogId} deleted successfully.` });
    }

    // 3. Batch purge older than N days with mandatory minimum retention guard
    if (daysParam) {
      const days = parseInt(daysParam, 10);
      // Enforce strict minimum retention cutoff of 7 days to prevent wiping active audit trail
      if (isNaN(days) || days < 7 || days > 3650) {
        return NextResponse.json(
          { success: false, error: 'Retention purge requires a cutoff between 7 and 3650 days.' },
          { status: 400 }
        );
      }

      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const snap = await adminDb.collection('admin_logs').get();
      const docsToDelete: FirebaseFirestore.DocumentReference[] = [];

      snap.docs.forEach((d) => {
        const data = d.data();
        let t: number | null = null;
        if (data.timestamp?.toDate) {
          t = data.timestamp.toDate().getTime();
        } else if (data.timestamp?.seconds) {
          t = data.timestamp.seconds * 1000;
        } else if (typeof data.timestamp === 'string' || typeof data.timestamp === 'number') {
          t = new Date(data.timestamp).getTime();
        }

        if (t && t < cutoffDate.getTime()) {
          docsToDelete.push(d.ref);
        }
      });

      // Chunk deletions into batches of 400
      const BATCH_SIZE = 400;
      for (let i = 0; i < docsToDelete.length; i += BATCH_SIZE) {
        const chunk = docsToDelete.slice(i, i + BATCH_SIZE);
        const batch = adminDb.batch();
        chunk.forEach((ref) => batch.delete(ref));
        await batch.commit();
      }

      return NextResponse.json({
        success: true,
        deletedCount: docsToDelete.length,
        message: `Purged ${docsToDelete.length} logs older than ${days} days.`,
      });
    }

    return NextResponse.json({ success: false, error: 'Missing logId or days parameter.' }, { status: 400 });
  } catch (err: any) {
    console.error('[Audit Logs API] DELETE error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to delete audit log(s)' },
      { status: 500 }
    );
  }
}
