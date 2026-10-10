import { NextResponse } from 'next/server';
import { adminDb, hasAdminCredentials } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { authenticateRequest } from '@/lib/server/auth';
import { SERVER_CONFIG } from '@/lib/server/config';

export async function POST(request: Request) {
  try {
    if (!hasAdminCredentials()) {
      return NextResponse.json({
        success: false,
        localDevFallback: true,
        error: 'Firebase Admin credentials not found on localhost. Running in local development mode.',
      }, { status: 200 });
    }

    // 1. Authenticate caller
    const { user, errorResponse } = await authenticateRequest(request);
    if (errorResponse) {
      return errorResponse;
    }

    const callerEmail = (user.email || '').toLowerCase().trim();
    const body = await request.json().catch(() => ({}));
    const { requestId, forceCancel = false, cancelIfUnpaid = false, cancel = false, sweep = false } = body;
    const shouldCancel = Boolean(forceCancel || cancelIfUnpaid || cancel);

    const now = Date.now();
    let revertedCount = 0;

    // A. Single Specific Request or Caller's Active Request Check
    let targetRequestId = requestId ? String(requestId).trim() : null;

    if (!targetRequestId && !sweep) {
      // Look up caller's ID card to see if they have an active request
      const cardSnap = await adminDb.collection('id_cards').doc(callerEmail).get();
      if (cardSnap.exists) {
        const cardData = cardSnap.data() || {};
        if (cardData.status === 'suspended' && cardData.activeRequestId) {
          targetRequestId = cardData.activeRequestId;
        }
      }
    }

    if (targetRequestId) {
      const reqRef = adminDb.collection('id_card_requests').doc(targetRequestId);
      const reqSnap = await reqRef.get();

      if (reqSnap.exists) {
        const reqData = reqSnap.data() || {};
        const isOwner = (reqData.userEmail || '').toLowerCase().trim() === callerEmail;
        const isSuperAdmin = SERVER_CONFIG.SUPER_ADMIN_EMAILS.includes(callerEmail);

        if (!isOwner && !isSuperAdmin) {
          return NextResponse.json(
            { success: false, error: 'Forbidden: You do not own this replacement request.' },
            { status: 403 }
          );
        }

        // Only revert if payment is still pending and it is expired (or cancellation was requested)
        const isPaymentPending = reqData.fulfillmentStatus === 'payment_pending';
        const isExpired = reqData.expireAt ? reqData.expireAt <= now : true;

        if (isPaymentPending && (isExpired || shouldCancel)) {
          const batch = adminDb.batch();
          const targetEmail = (reqData.userEmail || callerEmail).toLowerCase().trim();

          // 1. Delete or cancel pending invoice in payments
          if (reqData.paymentId) {
            const payRef = adminDb.collection('payments').doc(reqData.paymentId);
            batch.delete(payRef);
          }

          // 2. Revert ID card to active Approved state
          const cardRef = adminDb.collection('id_cards').doc(targetEmail);
          batch.update(cardRef, {
            status: 'Approved',
            activeRequestId: null,
            suspendedReason: null,
            suspendedAt: null,
            replacementPaid: null,
            paymentStatus: null,
            fulfillmentStatus: null,
            paidAt: null,
            requestDenied: null,
            denialMessage: null,
            deniedAt: null,
            updated_at: FieldValue.serverTimestamp(),
          });

          // 3. Delete request from id_card_requests
          batch.delete(reqRef);

          // 4. Sweep any other orphan pending requests for this user email
          try {
            const orphanSnap = await adminDb.collection('id_card_requests')
              .where('userEmail', '==', targetEmail)
              .get();
            for (const d of orphanSnap.docs) {
              if (d.id !== targetRequestId) {
                const dData = d.data();
                if (dData.paymentStatus !== 'paid' || dData.fulfillmentStatus === 'payment_pending') {
                  batch.delete(d.ref);
                }
              }
            }
          } catch (sweepErr) {
            console.warn('Notice sweeping orphan requests:', sweepErr);
          }

          await batch.commit();
          revertedCount++;

          return NextResponse.json({
            success: true,
            reverted: true,
            cardReactivated: true,
            message: 'Pending replacement request expired/cancelled. ID card reactivated.',
            requestId: targetRequestId,
          });
        }

        return NextResponse.json({
          success: true,
          reverted: false,
          isPaymentPending,
          isExpired,
          message: isPaymentPending
            ? 'Replacement invoice is still active within payment window.'
            : 'Payment was completed; request is currently queued for fulfillment.',
        });
      }
    }

    // B. Sweep Mode: Look for all expired payment_pending requests
    const expiredSnap = await adminDb
      .collection('id_card_requests')
      .where('fulfillmentStatus', '==', 'payment_pending')
      .get();

    if (!expiredSnap.empty) {
      const batch = adminDb.batch();
      let pendingOps = 0;

      for (const d of expiredSnap.docs) {
        const data = d.data();
        const exp = Number(data.expireAt) || 0;
        if (exp && exp <= now) {
          // Revert user ID card
          const email = (data.userEmail || '').toLowerCase().trim();
          if (email) {
            const cRef = adminDb.collection('id_cards').doc(email);
            batch.update(cRef, {
              status: 'Approved',
              activeRequestId: null,
              suspendedReason: null,
              updated_at: FieldValue.serverTimestamp(),
            });
          }

          // Delete invoice
          if (data.paymentId) {
            const pRef = adminDb.collection('payments').doc(data.paymentId);
            batch.delete(pRef);
          }

          // Delete request
          batch.delete(d.ref);
          pendingOps++;
          revertedCount++;
        }
      }

      if (pendingOps > 0) {
        await batch.commit();
      }
    }

    return NextResponse.json({
      success: true,
      revertedCount,
      message: `Expiry sweep completed. ${revertedCount} expired request(s) cleaned up.`,
    });
  } catch (err: any) {
    console.error('Error in /api/idcard/check-expiry:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to check request expiry.' },
      { status: 500 }
    );
  }
}
