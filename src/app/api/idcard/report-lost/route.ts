import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminDb, hasAdminCredentials } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { authenticateRequest } from '@/lib/server/auth';
import { DEFAULT_ID_CARD_SETTINGS, generateShortId } from '@/types/idcard';

export async function POST(request: Request) {
  try {
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 32768) {
      return NextResponse.json({ success: false, error: 'Payload too large' }, { status: 413 });
    }

    const body = await request.json().catch(() => ({}));
    const requestedFee = Number(body?.amount ?? body?.replacementFee ?? body?.fee);
    let replacementFee = requestedFee > 0 ? requestedFee : DEFAULT_ID_CARD_SETTINGS.replacementFee;

    if (!hasAdminCredentials()) {
      // Generate authentic Razorpay order for live payment even in client-authenticated mode
      const keyId = process.env.RAZORPAY_KEY_ID;
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      const requestId = generateShortId('REQ');
      const paymentId = generateShortId('PAY');
      let razorpayOrderId = '';

      if (keyId && keySecret) {
        try {
          // @ts-ignore
          const mod = await import('razorpay').catch(() => null);
          const RazorpayConstructor = mod?.default || mod;
          if (RazorpayConstructor) {
            const razorpayInstance = new RazorpayConstructor({
              key_id: keyId,
              key_secret: keySecret,
            });

            const cleanReceipt = `rcpt_${requestId.replace(/[^A-Za-z0-9]/g, '').slice(-10)}_${Date.now().toString().slice(-4)}`;
            const orderPayload: any = {
              amount: Math.round(replacementFee * 100),
              currency: 'INR',
              receipt: cleanReceipt,
              notes: {
                type: 'id_replacement',
                requestId,
                paymentId,
              },
            };

            const order = await razorpayInstance.orders.create(orderPayload);
            if (order?.id) {
              razorpayOrderId = order.id;
            }
          }
        } catch (rzpErr: any) {
          console.error('Razorpay order creation notice in report-lost fallback:', rzpErr);
        }
      }

      const now = Date.now();
      const expireAt = now + 60 * 60 * 1000;

      return NextResponse.json({
        success: true,
        orderId: razorpayOrderId,
        requestId,
        paymentId,
        amount: replacementFee,
        currency: 'INR',
        keyId: keyId || '',
        expireAt,
      }, { status: 200 });
    }

    // 1. Cryptographically verify Firebase ID token
    const { user, errorResponse } = await authenticateRequest(request);
    if (errorResponse) {
      return errorResponse;
    }

    const callerEmail = (user.email || '').toLowerCase().trim();
    if (!callerEmail) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: User email not found in token.' },
        { status: 401 }
      );
    }

    // 2. Fetch the user's ID card record
    let cardDocRef = adminDb.collection('id_cards').doc(callerEmail);
    let cardSnap = await cardDocRef.get();

    if (!cardSnap.exists) {
      const q = await adminDb.collection('id_cards').where('email', '==', callerEmail).limit(1).get();
      if (!q.empty) {
        cardDocRef = q.docs[0].ref;
        cardSnap = q.docs[0];
      }
    }

    if (!cardSnap.exists) {
      return NextResponse.json(
        { success: false, error: 'Active ID card dossier not found. Please complete initial ID card registration first.' },
        { status: 404 }
      );
    }

    const cardData = cardSnap.data() || {};

    // 3. Reject if already suspended
    if (cardData.status === 'suspended') {
      return NextResponse.json(
        {
          success: false,
          error: 'Your ID card is already suspended with an active replacement request.',
          activeRequestId: cardData.activeRequestId || null,
        },
        { status: 400 }
      );
    }

    // 4. Fetch dynamic fee & expiry from config/metadata
    if (requestedFee > 0) {
      replacementFee = requestedFee;
    } else {
      replacementFee = DEFAULT_ID_CARD_SETTINGS.replacementFee;
    }
    let expiryMinutes = DEFAULT_ID_CARD_SETTINGS.expiryMinutes;

    try {
      let metaSnap = await adminDb.collection('config').doc('metadata').get();
      if (!metaSnap.exists) {
        metaSnap = await adminDb.collection('config').doc('club_metadata').get();
      }
      if (metaSnap.exists) {
        const meta = metaSnap.data() || {};
        if (meta.idCardSettings?.replacementFee && Number(meta.idCardSettings.replacementFee) > 0) {
          replacementFee = Number(meta.idCardSettings.replacementFee);
        }
        if (meta.idCardSettings?.expiryMinutes && Number(meta.idCardSettings.expiryMinutes) > 0) {
          expiryMinutes = Number(meta.idCardSettings.expiryMinutes);
        }
      }
    } catch (metaErr) {
      console.warn('Metadata lookup warning in report-lost:', metaErr);
    }

    const now = Date.now();
    const expireAt = now + expiryMinutes * 60 * 1000;
    const expireBySeconds = Math.floor(expireAt / 1000);
    const nowIso = new Date(now).toISOString();

    const requestId = generateShortId('REQ');
    const paymentId = generateShortId('PAY');

    // 5. Create official Razorpay Order
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    let razorpayOrderId = '';

    if (keyId && keySecret) {
      try {
        // @ts-ignore
        const mod = await import('razorpay').catch(() => null);
        const RazorpayConstructor = mod?.default || mod;
        if (RazorpayConstructor) {
          const razorpayInstance = new RazorpayConstructor({
            key_id: keyId,
            key_secret: keySecret,
          });

          const cleanReceipt = `rcpt_${requestId.replace(/[^A-Za-z0-9]/g, '').slice(-10)}_${Date.now().toString().slice(-4)}`;
          const orderPayload: any = {
            amount: Math.round(replacementFee * 100), // paise
            currency: 'INR',
            receipt: cleanReceipt,
            notes: {
              type: 'id_replacement',
              requestId,
              paymentId,
              userEmail: callerEmail,
            },
          };

          const order = await razorpayInstance.orders.create(orderPayload);
          if (order?.id) {
            razorpayOrderId = order.id;
          }
        }
      } catch (rzpErr: any) {
        console.error('Razorpay order creation error in report-lost:', rzpErr);
      }
    }

    if (!razorpayOrderId) {
      razorpayOrderId = generateShortId('ORD');
    }

    // 6. Atomically update Firestore via Batch
    const batch = adminDb.batch();

    // Clean up any old pending request documents for callerEmail before creating the new one
    try {
      const oldReqsSnap = await adminDb.collection('id_card_requests')
        .where('userEmail', '==', callerEmail)
        .get();
      for (const d of oldReqsSnap.docs) {
        const dData = d.data();
        if (dData.paymentStatus !== 'paid' || dData.fulfillmentStatus === 'payment_pending') {
          batch.delete(d.ref);
          if (dData.paymentId) {
            batch.delete(adminDb.collection('payments').doc(dData.paymentId));
          }
        }
      }
    } catch (cleanErr) {
      console.warn('Notice cleaning old requests in report-lost:', cleanErr);
    }

    // a. id_cards/{email}: set status: 'suspended', activeRequestId, suspendedReason, payment pending
    batch.update(cardDocRef, {
      status: 'suspended',
      activeRequestId: requestId,
      suspendedReason: 'lost_replacement',
      suspendedAt: nowIso,
      paymentStatus: 'pending',
      fulfillmentStatus: 'payment_pending',
      replacementPaid: false,
      replacementFee: replacementFee,
      updated_at: FieldValue.serverTimestamp(),
    });

    // b. payments/{paymentId}: create invoice with category 'ID Card Replacement'
    const paymentRef = adminDb.collection('payments').doc(paymentId);
    batch.set(paymentRef, {
      id: paymentId,
      user_id: user.uid,
      user_email: callerEmail,
      candidate_name: cardData.name || callerEmail.split('@')[0],
      registration_number: cardData.registrationNumber || '',
      team: cardData.team || 'General',
      title: 'ID Card Replacement Fee',
      description: 'Official club re-issuance fee for lost or damaged physical VRGC ID Card badge.',
      category: 'ID Card Replacement',
      amount: replacementFee,
      currency: 'INR',
      status: 'Processing',
      due_date: new Date(expireAt).toISOString(),
      razorpay_order_id: razorpayOrderId,
      metadata: {
        type: 'id_replacement',
        requestId: requestId,
        expireAt: expireAt,
      },
      created_at: nowIso,
      updated_at: FieldValue.serverTimestamp(),
    });

    // c. id_card_requests/{requestId}: create request document
    const requestRef = adminDb.collection('id_card_requests').doc(requestId);
    batch.set(requestRef, {
      id: requestId,
      userEmail: callerEmail,
      candidateName: cardData.name || callerEmail.split('@')[0],
      registrationNumber: cardData.registrationNumber || '',
      phone: cardData.phone || '',
      team: cardData.team || 'General',
      position: cardData.position || 'Member',
      photoUrl: cardData.photoUrl || '',
      avatarUrl: cardData.avatarUrl || '',
      feeAmount: replacementFee,
      currency: 'INR',
      paymentId: paymentId,
      razorpayOrderId: razorpayOrderId,
      paymentStatus: 'pending',
      fulfillmentStatus: 'payment_pending',
      reason: 'lost_replacement',
      createdAt: nowIso,
      expireAt: expireAt,
      updatedAt: nowIso,
    });

    await batch.commit();

    return NextResponse.json({
      success: true,
      requestId,
      paymentId,
      orderId: razorpayOrderId,
      amount: replacementFee,
      currency: 'INR',
      keyId: keyId || '',
      expireAt,
      message: 'ID Card suspended successfully. Please complete replacement fee payment.',
    });
  } catch (err: any) {
    console.error('Error in /api/idcard/report-lost:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to process ID card replacement request.' },
      { status: 500 }
    );
  }
}
