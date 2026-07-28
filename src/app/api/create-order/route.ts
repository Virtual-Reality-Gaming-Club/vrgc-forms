import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { amount, currency = 'INR', receipt, paymentId, title, userEmail } = body;

    const parsedAmount = Number(amount);
    if (!parsedAmount || isNaN(parsedAmount) || parsedAmount < 1) {
      return NextResponse.json(
        { success: false, error: 'Amount must be at least 1 INR (100 paise).' },
        { status: 400 }
      );
    }

    const keyId = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
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

    const amountInPaise = Math.round(parsedAmount * 100);
    const safeReceipt = (receipt || (paymentId ? `rcpt_${paymentId}` : `rcpt_${Date.now()}`)).slice(0, 36);

    const options = {
      amount: amountInPaise,
      currency: currency || 'INR',
      receipt: safeReceipt,
      notes: {
        paymentId: paymentId ? String(paymentId) : '',
        userEmail: userEmail ? String(userEmail) : '',
        title: title ? String(title) : '',
      },
    };

    const order = await instance.orders.create(options);

    // Update payment status to 'Processing' in Firestore payments collection
    if (paymentId) {
      try {
        const docRef = doc(db, 'payments', String(paymentId));
        await updateDoc(docRef, {
          razorpay_order_id: order.id,
          status: 'Processing',
          updated_at: serverTimestamp(),
        });
      } catch (dbErr) {
        console.warn('Firestore status update warning during order creation:', dbErr);
      }
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
