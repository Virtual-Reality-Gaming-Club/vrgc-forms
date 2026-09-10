import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, updateDoc, writeBatch, getDocs, query, collection, where, limit } from 'firebase/firestore';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = body?.sessionId;

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ ok: false, error: 'Missing sessionId' }, { status: 400 });
    }

    const nowIso = body?.leftAt || new Date().toISOString();

    // 1. Mark this session as offline immediately in Firestore
    await updateDoc(doc(db, 'audit_sessions', sessionId), {
      status: 'offline',
      leftAt: nowIso,
    }).catch((err) => {
      console.warn('[AuditLeave] Could not update session:', err);
    });

    // 2. Opportunistically purge any sessions older than 12 hours from the database
    const twelveHoursAgoIso = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    getDocs(
      query(
        collection(db, 'audit_sessions'),
        where('enteredAt', '<=', twelveHoursAgoIso),
        limit(25)
      )
    ).then((staleSnap) => {
      if (!staleSnap.empty) {
        const batch = writeBatch(db);
        staleSnap.docs.forEach((d) => batch.delete(d.ref));
        batch.commit().catch(() => {});
      }
    }).catch(() => {});

    return NextResponse.json({ ok: true, sessionId, status: 'offline' });
  } catch (err) {
    console.warn('[AuditLeave] Error handling leave beacon:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
