import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/firebase';
import { doc, updateDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';

// Helper to log a transaction record to Firestore `invoices` collection (non-blocking)
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
}) {
  try {
    await addDoc(collection(db, 'invoices'), {
      ...tx,
      user_email: (tx.user_email || 'unknown').toLowerCase(),
      payment_title: tx.payment_title || 'Unknown Payment',
      amount: tx.amount || 0,
      currency: tx.currency || 'INR',
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      source: 'vrgc-forms',
    });
  } catch (err) {
    console.warn('Transaction log to Firestore invoices collection failed:', err);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
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

    // Generated Signature Verification using HMAC-SHA256
    const text = `${razorpay_order_id}|${razorpay_payment_id}`;
    const generatedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(text)
      .digest('hex');

    const isValidSignature = generatedSignature === razorpay_signature;

    if (!isValidSignature) {
      console.warn(`Signature Mismatch! Expected: ${generatedSignature}, Received: ${razorpay_signature}`);
      
      // Update Firestore `payments` doc to Failed if paymentId is provided
      if (paymentId) {
        try {
          const docRef = doc(db, 'payments', paymentId);
          await updateDoc(docRef, {
            status: 'Failed',
            razorpay_order_id,
            razorpay_payment_id,
            updated_at: serverTimestamp(),
          });
        } catch (dbErr) {
          console.error('Failed to update Firestore payment status to Failed:', dbErr);
        }
      }

      // Log failed transaction to Firestore `invoices` collection
      await logTransactionToFirestore({
        payment_id: paymentId,
        user_email: userEmail,
        payment_title: paymentTitle,
        amount,
        currency,
        status: 'Failed',
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

    if (paymentId) {
      try {
        const docRef = doc(db, 'payments', paymentId);
        await updateDoc(docRef, {
          status: 'Paid',
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature,
          payment_method: paymentMethod,
          paid_at: timestamp,
          updated_at: serverTimestamp(),
        });
      } catch (dbErr) {
        console.error('Failed to update Firestore payment status to Paid:', dbErr);
      }
    }

    // Log successful transaction to Firestore `invoices` collection
    await logTransactionToFirestore({
      payment_id: paymentId,
      user_email: userEmail,
      payment_title: paymentTitle,
      amount,
      currency,
      status: 'Paid',
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      payment_method: paymentMethod,
      paid_at: timestamp,
    });

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
