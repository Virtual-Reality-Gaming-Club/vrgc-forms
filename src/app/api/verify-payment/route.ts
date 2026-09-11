import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { authenticateRequest } from '@/lib/server/auth';
import { CONFIG } from '@/lib/config';

// Helper to determine if an email belongs to an authorized admin
async function isAuthorizedAdmin(email: string | null): Promise<boolean> {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();

  // 1. Authoritative server configuration lists
  if (
    CONFIG.ADMIN_EMAILS.includes(normalized) ||
    CONFIG.SUPER_ADMIN_EMAILS.includes(normalized) ||
    CONFIG.PAYMENT_ADMIN_EMAILS.includes(normalized)
  ) {
    return true;
  }

  // 2. Dynamic Firestore admin collections
  try {
    const adminDoc = await adminDb.collection('admins').doc(normalized).get();
    if (adminDoc.exists) return true;

    const superDoc = await adminDb.collection('super_admins').doc(normalized).get();
    if (superDoc.exists) return true;
  } catch (err) {
    console.warn('Admin authorization check notice:', err);
  }

  return false;
}

// Helper to log a transaction attempt record to Firestore `payments/{payment_id}/attempts` subcollection (non-blocking)
async function logTransactionToFirestore(tx: {
  payment_id?: string;
  user_email?: string;
  payment_title?: string;
  amount?: number;
  currency?: string;
  status: 'Paid' | 'Failed' | 'Pending' | 'Processing';
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
  payment_method?: string;
  error_description?: string;
  paid_at?: string;
  failed_at?: string;
}) {
  try {
    if (tx.payment_id) {
      const attemptsCol = adminDb.collection('payments').doc(tx.payment_id).collection('attempts');
      const existingSnap = await attemptsCol.get();
      let duplicateDocRef: any = null;

      existingSnap.forEach((dSnap) => {
        const dData = dSnap.data();
        if (
          dData.status === tx.status &&
          ((tx.razorpay_payment_id && dData.razorpay_payment_id === tx.razorpay_payment_id) ||
            (tx.razorpay_order_id && dData.razorpay_order_id === tx.razorpay_order_id))
        ) {
          duplicateDocRef = dSnap.ref;
        }
      });

      if (duplicateDocRef) {
        await duplicateDocRef.update({
          ...tx,
          updated_at: FieldValue.serverTimestamp(),
        });
      } else {
        await attemptsCol.add({
          ...tx,
          user_email: (tx.user_email || 'unknown').toLowerCase(),
          payment_title: tx.payment_title || 'Unknown Payment',
          amount: tx.amount || 0,
          currency: tx.currency || 'INR',
          failed_at: tx.failed_at || (tx.status === 'Failed' ? new Date().toISOString() : ''),
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
          source: 'vrgc-forms',
        });
      }
    }
  } catch (err) {
    console.warn('Transaction log to Firestore attempts collection failed:', err);
  }
}

export async function POST(request: Request) {
  try {
    // 1. Cryptographically verify Firebase ID token
    const { user, errorResponse } = await authenticateRequest(request);
    if (errorResponse) {
      return errorResponse;
    }

    const body = await request.json().catch(() => ({}));
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      paymentId,
      paymentMethod = 'Razorpay Online',
      userEmail,
      paymentTitle,
      amount,
      currency = 'INR',
    } = body;

    // Validate required fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json(
        { success: false, error: 'Missing required Razorpay verification parameters.' },
        { status: 400 }
      );
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return NextResponse.json(
        { success: false, error: 'Razorpay secret key missing on server.' },
        { status: 500 }
      );
    }

    // 2. Lookup payment doc in Firestore for ownership, idempotency, and amount/order verification
    let paymentDocSnap: any = null;
    let paymentDocRef: any = null;

    if (paymentId) {
      paymentDocRef = adminDb.collection('payments').doc(String(paymentId));
      paymentDocSnap = await paymentDocRef.get();
    } else if (razorpay_order_id) {
      const querySnap = await adminDb
        .collection('payments')
        .where('razorpay_order_id', '==', razorpay_order_id)
        .limit(1)
        .get();
      if (!querySnap.empty) {
        paymentDocSnap = querySnap.docs[0];
        paymentDocRef = paymentDocSnap.ref;
      }
    }

    if (!paymentDocSnap || !paymentDocSnap.exists) {
      return NextResponse.json(
        { success: false, error: 'Invoice or payment record not found in database.' },
        { status: 404 }
      );
    }

    const paymentData = paymentDocSnap.data() || {};
    const callerEmail = (user.email || '').toLowerCase().trim();
    const callerUid = user.uid;

    // 3. Verify payment ownership against the cryptographically verified caller or admin
    const paymentEmail = (paymentData.user_email || '').toLowerCase().trim();
    const paymentUserId = paymentData.user_id ? String(paymentData.user_id).trim() : null;

    const isOwner = Boolean(
      (paymentEmail && paymentEmail === callerEmail) ||
      (paymentUserId && paymentUserId === callerUid)
    );
    const isAdmin = await isAuthorizedAdmin(callerEmail);

    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { success: false, error: "Forbidden: You are not authorized to verify another user's payment." },
        { status: 403 }
      );
    }

    // 4. Idempotency Check: already marked Paid
    if (paymentData.status === 'Paid') {
      return NextResponse.json({
        success: true,
        message: 'Payment already verified and processed.',
        razorpay_payment_id: paymentData.razorpay_payment_id || razorpay_payment_id,
        razorpay_order_id: paymentData.razorpay_order_id || razorpay_order_id,
      });
    }

    // 5. Razorpay Order ID Verification
    if (paymentData.razorpay_order_id && paymentData.razorpay_order_id !== razorpay_order_id) {
      return NextResponse.json(
        { success: false, error: 'Razorpay order ID mismatch with invoice record.' },
        { status: 400 }
      );
    }

    // 6. Razorpay Order Amount Verification via API
    const keyId = process.env.RAZORPAY_KEY_ID;
    if (keyId && keySecret) {
      try {
        // @ts-ignore
        const mod = await import('razorpay').catch(() => null);
        const RazorpayConstructor = mod?.default || mod;
        if (RazorpayConstructor) {
          const instance = new RazorpayConstructor({ key_id: keyId, key_secret: keySecret });
          const fetchedOrder = await instance.orders.fetch(razorpay_order_id);
          const expectedAmountInPaise = Math.round(Number(paymentData.amount) * 100);

          if (fetchedOrder && fetchedOrder.amount && fetchedOrder.amount !== expectedAmountInPaise) {
            return NextResponse.json(
              { success: false, error: 'Paid Razorpay order amount does not match invoice amount.' },
              { status: 400 }
            );
          }
        }
      } catch (orderFetchErr) {
        console.warn('Could not verify Razorpay order amount via SDK:', orderFetchErr);
      }
    }

    // Derive authoritative payment details from Firestore document
    const actualPaymentId = paymentDocRef.id;
    const targetEmail = paymentData.user_email || callerEmail || userEmail;
    const targetTitle = paymentData.title || paymentTitle || 'Payment Verified';
    const targetAmount = typeof paymentData.amount === 'number' ? paymentData.amount : amount;
    const targetCurrency = paymentData.currency || currency || 'INR';

    // 7. Generated Signature Verification using HMAC-SHA256
    const text = `${razorpay_order_id}|${razorpay_payment_id}`;
    const generatedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(text)
      .digest('hex');

    let isValidSignature = false;
    try {
      const genBuf = Buffer.from(generatedSignature, 'utf8');
      const sigBuf = Buffer.from(razorpay_signature, 'utf8');
      if (genBuf.length === sigBuf.length) {
        isValidSignature = crypto.timingSafeEqual(genBuf, sigBuf);
      }
    } catch {
      isValidSignature = generatedSignature === razorpay_signature;
    }

    if (!isValidSignature) {
      console.warn(`Signature Mismatch! Expected: ${generatedSignature}, Received: ${razorpay_signature}`);

      // Update Firestore `payments` doc to Failed
      const nowIso = new Date().toISOString();
      try {
        await paymentDocRef.update({
          status: 'Failed',
          failed_at: nowIso,
          razorpay_order_id,
          razorpay_payment_id,
          updated_at: FieldValue.serverTimestamp(),
        });
      } catch (dbErr) {
        console.error('Failed to update Firestore payment status to Failed:', dbErr);
      }

      // Log failed transaction to Firestore attempts collection
      await logTransactionToFirestore({
        payment_id: actualPaymentId,
        user_email: targetEmail,
        payment_title: targetTitle,
        amount: targetAmount,
        currency: targetCurrency,
        status: 'Failed',
        failed_at: nowIso,
        razorpay_order_id,
        razorpay_payment_id,
        payment_method: paymentMethod,
        error_description: 'Signature verification failed',
      });

      return NextResponse.json(
        { success: false, error: 'Payment signature verification failed. Mismatch detected.' },
        { status: 400 }
      );
    }

    // Signature matches -> Update Firestore `payments` doc to Paid
    const timestamp = new Date().toISOString();

    try {
      await paymentDocRef.update({
        status: 'Paid',
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        payment_method: paymentMethod,
        paid_at: timestamp,
        updated_at: FieldValue.serverTimestamp(),
      });
    } catch (dbErr) {
      console.error('Failed to update Firestore payment status to Paid:', dbErr);
    }

    // Log successful transaction to Firestore attempts collection
    await logTransactionToFirestore({
      payment_id: actualPaymentId,
      user_email: targetEmail,
      payment_title: targetTitle,
      amount: targetAmount,
      currency: targetCurrency,
      status: 'Paid',
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      payment_method: paymentMethod,
      paid_at: timestamp,
    });

    // Log successful transaction to admin_logs for live Tx Logs panel updates
    try {
      await adminDb.collection('admin_logs').add({
        adminEmail: callerEmail || 'system',
        action: 'VERIFY',
        targetEmail: (targetEmail || '').toLowerCase(),
        targetName: targetTitle,
        details: `Paid ₹${targetAmount || 0} ${targetCurrency} via ${paymentMethod || 'Razorpay Online'} (Tx: ${razorpay_payment_id})`,
        timestamp: FieldValue.serverTimestamp(),
      });
    } catch (logErr) {
      console.warn('Failed to write to admin_logs on payment verification:', logErr);
    }

    return NextResponse.json({
      success: true,
      message: 'Payment verified and status updated to Paid successfully in Firestore 🎉',
      razorpay_payment_id,
      razorpay_order_id,
    });
  } catch (error: any) {
    console.error('Error verifying Razorpay payment:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Internal server error verifying payment',
      },
      { status: 500 }
    );
  }
}

