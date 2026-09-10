import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { currency = 'INR', receipt, paymentId, title, userEmail } = body;

    if (!paymentId) {
      return NextResponse.json(
        { success: false, error: 'paymentId is required to create a payment order.' },
        { status: 400 }
      );
    }

    // Fetch actual payment document from Firestore to prevent client amount tampering
    const paymentDocRef = doc(db, 'payments', String(paymentId));
    const paymentDocSnap = await getDoc(paymentDocRef);

    if (!paymentDocSnap.exists()) {
      return NextResponse.json(
        { success: false, error: 'Invoice or payment record not found in database.' },
        { status: 404 }
      );
    }

    const paymentData = paymentDocSnap.data();

    // Prevent duplicate order creation if already paid
    if (paymentData.status === 'Paid') {
      return NextResponse.json(
        { success: false, error: 'This payment record has already been paid and verified.' },
        { status: 400 }
      );
    }

    // Prevent Razorpay order creation for expired invoices
    if (paymentData.due_date && paymentData.status !== 'Paid') {
      const dueMs = new Date(paymentData.due_date).getTime();
      if (!isNaN(dueMs) && Date.now() > dueMs) {
        return NextResponse.json(
          { success: false, error: 'This invoice has expired (payment deadline has passed) and can no longer be paid.' },
          { status: 400 }
        );
      }
    }

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
    const safeReceipt = (receipt || `rcpt_${paymentId}`).slice(0, 36);

    const options = {
      amount: amountInPaise,
      currency: currency || paymentData.currency || 'INR',
      receipt: safeReceipt,
      notes: {
        paymentId: String(paymentId),
        userEmail: userEmail ? String(userEmail) : (paymentData.user_email || ''),
        title: title ? String(title) : (paymentData.title || ''),
      },
    };

    const order = await instance.orders.create(options);

    // Update payment status to 'Processing' in Firestore payments collection
    try {
      await updateDoc(paymentDocRef, {
        razorpay_order_id: order.id,
        status: 'Processing',
        updated_at: serverTimestamp(),
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

