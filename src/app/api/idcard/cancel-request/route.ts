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
    console.warn('[Cancel Request API] Super Admin verification notice:', err);
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
        { success: false, error: 'Forbidden: Only Super Administrators can cancel or deny ID card replacement requests.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { requestId, reason } = body;

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
    const targetEmail = (reqData.userEmail || '').toLowerCase().trim();
    if (!targetEmail) {
      return NextResponse.json(
        { success: false, error: 'Invalid user email in request document.' },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const batch = adminDb.batch();

    // a. Mark request as cancelled/denied
    batch.update(requestDocRef, {
      fulfillmentStatus: 'denied',
      status: 'cancelled',
      deniedAt: nowIso,
      deniedBy: callerEmail,
      denialReason: reason || 'Cancelled by Super Administrator',
      updatedAt: nowIso,
    });

    // b. Delete pending payment if unpaid
    if (reqData.paymentId && reqData.paymentStatus !== 'paid') {
      const payRef = adminDb.collection('payments').doc(reqData.paymentId);
      batch.delete(payRef);
    }

    // c. Restore ID card to 'Approved' and mark requestDenied: true
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
      paymentStatus: null,
      fulfillmentStatus: null,
      paidAt: null,
      requestDenied: true,
      denialMessage: 'Your request has been denied and you can try again.',
      deniedAt: nowIso,
      updated_at: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    // d. Log admin action
    try {
      await adminDb.collection('admin_logs').add({
        action: 'DENY_CARD_REPLACEMENT',
        adminEmail: callerEmail,
        performedBy: user.token.name || callerEmail.split('@')[0],
        targetEmail: targetEmail,
        targetName: reqData.candidateName || null,
        targetRegNo: reqData.registrationNumber || null,
        details: `Replacement request ${cleanRequestId} denied. Card reactivated with retry permission.`,
        timestamp: FieldValue.serverTimestamp(),
      });
    } catch (logErr) {
      console.warn('Failed to log admin action for card request cancel:', logErr);
    }

    return NextResponse.json({
      success: true,
      message: 'ID Card replacement request denied and cancelled. Card reactivated with retry notice.',
      requestId: cleanRequestId,
      targetEmail,
    });
  } catch (err: any) {
    console.error('Error in /api/idcard/cancel-request:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to cancel request.' },
      { status: 500 }
    );
  }
}
