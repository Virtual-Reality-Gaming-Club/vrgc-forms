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
    const isSuperAdmin = await isAuthorizedSuperAdmin(callerEmail);

    const body = await request.json().catch(() => ({}));
    const { requestId, reason } = body;

    const cleanRequestId = typeof requestId === 'string' ? requestId.trim() : '';

    // 2. Fetch the request document
    let requestDocRef = cleanRequestId ? adminDb.collection('id_card_requests').doc(cleanRequestId) : null;
    let requestSnap = requestDocRef ? await requestDocRef.get() : null;

    if (!requestSnap || !requestSnap.exists) {
      // Fallback: look up pending request for callerEmail
      const userReqs = await adminDb.collection('id_card_requests')
        .where('userEmail', '==', callerEmail)
        .limit(1)
        .get();
      if (!userReqs.empty) {
        requestDocRef = userReqs.docs[0].ref;
        requestSnap = userReqs.docs[0];
      }
    }

    const reqData = requestSnap?.exists ? (requestSnap.data() || {}) : {};
    const targetEmail = (reqData.userEmail || reqData.email || callerEmail).toLowerCase().trim();
    const isOwner = targetEmail === callerEmail;

    if (!isSuperAdmin && !isOwner) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: You are not authorized to cancel this ID card replacement request.' },
        { status: 403 }
      );
    }

    // If regular requester is cancelling, verify payment is not completed
    if (isOwner && !isSuperAdmin) {
      if (reqData.paymentStatus === 'paid' || reqData.fulfillmentStatus === 'queued') {
        return NextResponse.json(
          { success: false, error: 'Payment is already completed. Please contact Super Admin to cancel or re-issue.' },
          { status: 400 }
        );
      }
    }

    const nowIso = new Date().toISOString();
    const batch = adminDb.batch();

    // a. Delete or mark request as cancelled
    if (requestDocRef && requestSnap?.exists) {
      if (isOwner && !isSuperAdmin) {
        // When requester cancels, completely delete the request so it vanishes from the super admin queue
        batch.delete(requestDocRef);
      } else {
        // Super admin cancellation / denial
        batch.update(requestDocRef, {
          fulfillmentStatus: 'denied',
          status: 'cancelled',
          deniedAt: nowIso,
          deniedBy: callerEmail,
          denialReason: reason || 'Cancelled by Super Administrator',
          updatedAt: nowIso,
        });
      }
    }

    // b. Delete pending payment if unpaid
    if (reqData.paymentId && reqData.paymentStatus !== 'paid') {
      const payRef = adminDb.collection('payments').doc(reqData.paymentId);
      batch.delete(payRef);
    }

    // Also sweep any other orphan pending requests for this user email
    try {
      const pendingSnap = await adminDb.collection('id_card_requests')
        .where('userEmail', '==', targetEmail)
        .get();
      for (const d of pendingSnap.docs) {
        if (d.id !== cleanRequestId) {
          const dData = d.data();
          if (dData.paymentStatus !== 'paid' || dData.fulfillmentStatus === 'payment_pending') {
            batch.delete(d.ref);
          }
        }
      }
    } catch (sweepErr) {
      console.warn('Notice sweeping user pending requests:', sweepErr);
    }

    // c. Restore ID card to 'Approved'
    let cardDocRef = adminDb.collection('id_cards').doc(targetEmail);
    const cardSnap = await cardDocRef.get();
    if (!cardSnap.exists) {
      const q = await adminDb.collection('id_cards').where('email', '==', targetEmail).limit(1).get();
      if (!q.empty) {
        cardDocRef = q.docs[0].ref;
      }
    }

    const cardUpdates: Record<string, any> = {
      status: 'Approved',
      activeRequestId: null,
      suspendedReason: null,
      suspendedAt: null,
      replacementPaid: null,
      paymentStatus: null,
      fulfillmentStatus: null,
      paidAt: null,
      updated_at: FieldValue.serverTimestamp(),
    };

    if (isSuperAdmin) {
      cardUpdates.requestDenied = true;
      cardUpdates.denialMessage = reason || 'Your request has been denied and you can try again.';
      cardUpdates.deniedAt = nowIso;
    } else {
      cardUpdates.requestDenied = null;
      cardUpdates.denialMessage = null;
      cardUpdates.deniedAt = null;
    }

    batch.update(cardDocRef, cardUpdates);

    await batch.commit();

    // d. Log action
    try {
      await adminDb.collection('admin_logs').add({
        action: isSuperAdmin ? 'DENY_CARD_REPLACEMENT' : 'USER_CANCEL_CARD_REPLACEMENT',
        adminEmail: callerEmail,
        performedBy: user.token.name || callerEmail.split('@')[0],
        targetEmail: targetEmail,
        targetName: reqData.candidateName || null,
        targetRegNo: reqData.registrationNumber || null,
        details: isSuperAdmin
          ? `Replacement request ${cleanRequestId || 'N/A'} denied by admin. Card reactivated.`
          : `Replacement request cancelled by requester. Card reactivated.`,
        timestamp: FieldValue.serverTimestamp(),
      });
    } catch (logErr) {
      console.warn('Failed to log admin action for card request cancel:', logErr);
    }

    return NextResponse.json({
      success: true,
      message: isSuperAdmin
        ? 'ID Card replacement request denied and cancelled. Card reactivated with retry notice.'
        : 'Replacement request cancelled successfully. ID card reactivated.',
      requestId: cleanRequestId || reqData.id || null,
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
