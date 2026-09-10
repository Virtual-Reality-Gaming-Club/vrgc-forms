import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp, getDocs } from 'firebase/firestore';

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
      const attemptsCol = collection(db, 'payments', tx.payment_id, 'attempts');
      const existingSnap = await getDocs(attemptsCol);
      let duplicateDocRef = null;

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
        await updateDoc(duplicateDocRef, {
          ...tx,
          updated_at: serverTimestamp(),
        });
      } else {
        await addDoc(attemptsCol, {
          ...tx,
          user_email: (tx.user_email || 'unknown').toLowerCase(),
          payment_title: tx.payment_title || 'Unknown Payment',
          amount: tx.amount || 0,
          currency: tx.currency || 'INR',
          failed_at: tx.failed_at || (tx.status === 'Failed' ? new Date().toISOString() : ''),
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
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

    // Lookup payment doc in Firestore for Idempotency and Amount/Order verification
    let paymentDocSnap: any = null;
    let paymentDocRef: any = null;

    if (paymentId) {
      paymentDocRef = doc(db, 'payments', String(paymentId));
      paymentDocSnap = await getDoc(paymentDocRef);

      if (paymentDocSnap.exists()) {
        const paymentData = paymentDocSnap.data();

        // Finding 6: Idempotency Check
        if (paymentData.status === 'Paid') {
          return NextResponse.json({
            success: true,
            message: 'Payment already verified and processed.',
            razorpay_payment_id: paymentData.razorpay_payment_id || razorpay_payment_id,
            razorpay_order_id: paymentData.razorpay_order_id || razorpay_order_id,
          });
        }

        // Finding 3: Razorpay Order ID Verification
        if (paymentData.razorpay_order_id && paymentData.razorpay_order_id !== razorpay_order_id) {
          return NextResponse.json(
            { success: false, error: 'Razorpay order ID mismatch with invoice record.' },
            { status: 400 }
          );
        }

        // Finding 3: Razorpay Order Amount Verification via API
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
      }
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
      const nowIso = new Date().toISOString();
      if (paymentDocRef) {
        try {
          await updateDoc(paymentDocRef, {
            status: 'Failed',
            failed_at: nowIso,
            razorpay_order_id,
            razorpay_payment_id,
            updated_at: serverTimestamp(),
          });
        } catch (dbErr) {
          console.error('Failed to update Firestore payment status to Failed:', dbErr);
        }
      }

      // Log failed transaction to Firestore attempts collection
      await logTransactionToFirestore({
        payment_id: paymentId,
        user_email: userEmail,
        payment_title: paymentTitle,
        amount,
        currency,
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

    if (paymentDocRef) {
      try {
        await updateDoc(paymentDocRef, {
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

    // Log successful transaction to Firestore attempts collection
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

    // Log successful transaction to admin_logs for live Tx Logs panel updates
    try {
      await addDoc(collection(db, 'admin_logs'), {
        adminEmail: (userEmail || 'system').toLowerCase(),
        action: 'VERIFY',
        targetEmail: (userEmail || '').toLowerCase(),
        targetName: paymentTitle || 'Payment Verified',
        details: `Paid ₹${amount || 0} INR via ${paymentMethod || 'Razorpay Online'} (Tx: ${razorpay_payment_id})`,
        timestamp: serverTimestamp(),
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

