import { NextResponse } from 'next/server';
import { adminDb, hasAdminCredentials } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { authenticateRequest } from '@/lib/server/auth';
import { SERVER_CONFIG } from '@/lib/server/config';

async function isAuthorizedSuperAdmin(email: string | null): Promise<boolean> {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();

  // 1. Super Admin via env
  if (SERVER_CONFIG.SUPER_ADMIN_EMAILS.includes(normalized)) {
    return true;
  }

  try {
    // 2. Super Admins collection in Firestore
    const superDoc = await adminDb.collection('super_admins').doc(normalized).get();
    if (superDoc.exists) return true;
  } catch (err) {
    console.warn('[Resolve Request API] Super Admin verification notice:', err);
  }

  return false;
}

export async function POST(request: Request) {
  try {
    if (!hasAdminCredentials()) {
      return NextResponse.json({
        success: false,
        localDevFallback: true,
        error: 'Firebase Admin credentials not found on localhost. Running in local development mode.',
      }, { status: 200 });
    }

    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 16384) {
      return NextResponse.json({ success: false, error: 'Payload too large' }, { status: 413 });
    }

    // 1. Authenticate caller
    const { user, errorResponse } = await authenticateRequest(request);
    if (errorResponse) {
      return errorResponse;
    }

    const callerEmail = (user.email || '').toLowerCase().trim();
    const isAllowed = await isAuthorizedSuperAdmin(callerEmail);
    if (!isAllowed) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Only Super Administrators have permission to resolve ID card replacement requests.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { requestId } = body;

    if (!requestId || typeof requestId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'requestId is required.' },
        { status: 400 }
      );
    }

    const cleanRequestId = requestId.trim();

    // 2. Fetch the request
    const requestDocRef = adminDb.collection('id_card_requests').doc(cleanRequestId);
    const requestSnap = await requestDocRef.get();

    if (!requestSnap.exists) {
      return NextResponse.json(
        { success: false, error: 'ID card replacement request not found.' },
        { status: 404 }
      );
    }

    const reqData = requestSnap.data() || {};
    if (reqData.fulfillmentStatus === 'resolved') {
      return NextResponse.json(
        { success: false, error: 'This request has already been marked as resolved.' },
        { status: 400 }
      );
    }

    const targetEmail = (reqData.userEmail || '').toLowerCase().trim();
    if (!targetEmail) {
      return NextResponse.json(
        { success: false, error: 'Invalid user email in request document.' },
        { status: 400 }
      );
    }

    // 3. Atomically update request to 'resolved' and reactivate the ID card
    const nowIso = new Date().toISOString();
    const batch = adminDb.batch();

    // a. Update request
    batch.update(requestDocRef, {
      fulfillmentStatus: 'resolved',
      resolvedAt: nowIso,
      resolvedBy: callerEmail,
      updatedAt: nowIso,
    });

    // b. Update id_cards
    let cardDocRef = adminDb.collection('id_cards').doc(targetEmail);
    const cardSnap = await cardDocRef.get();
    if (!cardSnap.exists) {
      const q = await adminDb.collection('id_cards').where('email', '==', targetEmail).limit(1).get();
      if (!q.empty) {
        cardDocRef = q.docs[0].ref;
      }
    }

    batch.update(cardDocRef, {
      status: 'Approved',
      activeRequestId: null,
      suspendedReason: null,
      suspendedAt: null,
      replacementPaid: null,
      requestDenied: null,
      denialMessage: null,
      deniedAt: null,
      updated_at: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    // 4. Log admin activity
    try {
      await adminDb.collection('admin_logs').add({
        action: 'RESOLVE_CARD_REPLACEMENT',
        adminEmail: callerEmail,
        performedBy: user.token.name || callerEmail.split('@')[0],
        targetEmail: targetEmail,
        targetName: reqData.candidateName || null,
        targetRegNo: reqData.registrationNumber || null,
        details: `Marked replacement request ${cleanRequestId} as resolved. Card badge reactivated.`,
        timestamp: FieldValue.serverTimestamp(),
      });
    } catch (logErr) {
      console.warn('Failed to log admin action for card request resolve:', logErr);
    }

    return NextResponse.json({
      success: true,
      message: 'ID Card replacement request resolved. Card reactivated successfully.',
      requestId: cleanRequestId,
      targetEmail,
    });
  } catch (err: any) {
    console.error('Error in /api/idcard/resolve-request:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to resolve request.' },
      { status: 500 }
    );
  }
}
