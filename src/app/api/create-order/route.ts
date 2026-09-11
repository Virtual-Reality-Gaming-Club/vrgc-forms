import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { authenticateRequest } from '@/lib/server/auth';

export async function POST(request: Request) {
  try {
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 32768) {
      return NextResponse.json({ success: false, error: 'Payload too large' }, { status: 413 });
    }

    const body = await request.json().catch(() => ({}));
    const { currency = 'INR', receipt, paymentId, title } = body;

    if (!paymentId || typeof paymentId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'paymentId is required to create a payment order.' },
        { status: 400 }
      );
    }

    const cleanPaymentId = paymentId.trim();
    if (!cleanPaymentId || cleanPaymentId.length > 128 || cleanPaymentId.includes('/')) {
      return NextResponse.json(
        { success: false, error: 'Invalid paymentId format.' },
        { status: 400 }
      );
    }

    // 1. Cryptographically verify Firebase ID token in Authorization header
    const { user, errorResponse } = await authenticateRequest(request);
    if (errorResponse) {
      return errorResponse;
    }

    // 2. Fetch actual payment document from Firestore to prevent client tampering
    const paymentDocRef = adminDb.collection('payments').doc(cleanPaymentId);
    const paymentDocSnap = await paymentDocRef.get();

    if (!paymentDocSnap.exists) {
      return NextResponse.json(
        { success: false, error: 'Invoice or payment record not found in database.' },
        { status: 404 }
      );
    }

    const paymentData = paymentDocSnap.data() || {};

    // 3. Verify payment ownership against the cryptographically verified caller
    const paymentEmail = (paymentData.user_email || '').toLowerCase().trim();
    const callerEmail = (user.email || '').toLowerCase().trim();
    const paymentUserId = paymentData.user_id ? String(paymentData.user_id).trim() : null;
    const callerUid = user.uid;

    const isOwner = Boolean(
      (paymentEmail && paymentEmail === callerEmail) ||
      (paymentUserId && paymentUserId === callerUid)
    );
    if (!isOwner) {
      return NextResponse.json(
        { success: false, error: "Forbidden: You are not authorized to create a payment order for another user's invoice." },
        { status: 403 }
      );
    }

    // 4. Prevent duplicate order creation if already paid
    if (paymentData.status === 'Paid') {
      return NextResponse.json(
        { success: false, error: 'This payment record has already been paid and verified.' },
        { status: 400 }
      );
    }

    // 5. Prevent Razorpay order creation for expired invoices
    if (paymentData.due_date && paymentData.status !== 'Paid') {
      const dueMs = new Date(paymentData.due_date).getTime();
      if (!isNaN(dueMs) && Date.now() > dueMs) {
        return NextResponse.json(
          { success: false, error: 'This invoice has expired (payment deadline has passed) and can no longer be paid.' },
          { status: 400 }
        );
      }
    }

    // 6. Authoritative amount strictly derived from the server payment record
    const actualAmount = Number(paymentData.amount);
    if (!actualAmount || isNaN(actualAmount) || actualAmount < 1) {
      return NextResponse.json(
        { success: false, error: 'Invalid payment amount found in invoice record.' },
        { status: 400 }
      );
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      console.error('Missing Razorpay API credentials in environment variables.');
      return NextResponse.json(
        { success: false, error: 'Razorpay credentials not properly configured in environment variables.' },
        { status: 500 }
      );
    }

    let RazorpayConstructor: any;
    try {
      // @ts-ignore
      const mod = await import('razorpay').catch(() => null);
      RazorpayConstructor = mod?.default || mod;
    } catch {
      RazorpayConstructor = null;
    }

    if (!RazorpayConstructor) {
      return NextResponse.json(
        { success: false, error: 'Razorpay SDK is currently unavailable.' },
        { status: 500 }
      );
    }

    const instance = new RazorpayConstructor({
      key_id: keyId,
      key_secret: keySecret,
    });

    const amountInPaise = Math.round(actualAmount * 100);

    const cleanReceipt = typeof receipt === 'string' && receipt.trim()
      ? receipt.trim().slice(0, 36)
      : `rcpt_${cleanPaymentId}`.slice(0, 36);

    const safeCurrency = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency.trim())
      ? currency.trim().toUpperCase()
      : 'INR';

    const options = {
      amount: amountInPaise,
      currency: paymentData.currency || safeCurrency,
      receipt: cleanReceipt,
      notes: {
        paymentId: cleanPaymentId,
        userEmail: callerEmail,
        title: String(paymentData.title || (typeof title === 'string' ? title.slice(0, 128) : '') || ''),
      },
    };

    const order = await instance.orders.create(options);

    // 7. Update payment status to 'Processing' in Firestore only after authorization and order creation succeed
    try {
      await paymentDocRef.update({
        razorpay_order_id: order.id,
        status: 'Processing',
        updated_at: FieldValue.serverTimestamp(),
      });
    } catch (dbErr) {
      console.warn('Firestore status update warning during order creation:', dbErr);
    }

    return NextResponse.json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: keyId,
    });
  } catch (error: any) {
    console.error('Error creating Razorpay order:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.error?.description || error?.description || error?.message || 'Failed to create Razorpay order',
      },
      { status: 500 }
    );
  }
}


