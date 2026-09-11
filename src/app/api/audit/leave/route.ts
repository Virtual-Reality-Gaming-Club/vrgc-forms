import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { authenticateRequest } from '@/lib/server/auth';

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

async function handleLeaveSession(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = body?.sessionId;

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ ok: false, error: 'Missing sessionId' }, { status: 400 });
    }

    // 1. Authenticate caller via Firebase ID token
    const { user, errorResponse } = await authenticateRequest(req);
    if (errorResponse) {
      return errorResponse;
    }

    // 2. Look up the existing session to enforce ownership
    const sessionRef = adminDb.collection('audit_sessions').doc(sessionId);
    const sessionSnap = await sessionRef.get();

    if (!sessionSnap.exists) {
      return NextResponse.json({ ok: false, error: 'Session not found' }, { status: 404 });
    }

    const sessionData = sessionSnap.data();
    const sessionEmail = (sessionData?.userEmail || '').toLowerCase().trim();
    const callerEmail = (user.email || '').toLowerCase().trim();

    // 3. Verify that the authenticated caller owns this session
    if (!sessionEmail || sessionEmail !== callerEmail) {
      return NextResponse.json(
        { ok: false, error: "Forbidden: You do not have permission to modify another user's session." },
        { status: 403 }
      );
    }

    const nowIso = body?.leftAt || new Date().toISOString();

    // 4. Mark this session as offline immediately in Firestore
    await sessionRef.update({
      status: 'offline',
      leftAt: nowIso,
    }).catch((err) => {
      console.warn('[AuditLeave] Could not update session status:', err);
    });

    // 5. Opportunistically purge any sessions older than 12 hours from the database
    const twelveHoursAgoIso = new Date(Date.now() - TWELVE_HOURS_MS).toISOString();
    adminDb
      .collection('audit_sessions')
      .where('enteredAt', '<=', twelveHoursAgoIso)
      .limit(25)
      .get()
      .then((staleSnap) => {
        if (!staleSnap.empty) {
          const batch = adminDb.batch();
          staleSnap.docs.forEach((d) => batch.delete(d.ref));
          batch.commit().catch(() => {});
        }
      })
      .catch(() => {});

    return NextResponse.json({ ok: true, sessionId, status: 'offline' });
  } catch (err) {
    console.warn('[AuditLeave] Error handling leave request:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handleLeaveSession(req);
}

export async function DELETE(req: Request) {
  return handleLeaveSession(req);
}
