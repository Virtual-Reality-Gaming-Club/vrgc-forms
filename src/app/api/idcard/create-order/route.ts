import { NextResponse } from 'next/server';
import { adminDb, hasAdminCredentials } from '@/lib/firebase-admin';
import { DEFAULT_ID_CARD_SETTINGS, generateShortId } from '@/types/idcard';

export async function POST(request: Request) {
  try {
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 32768) {
      return NextResponse.json({ success: false, error: 'Payload too large' }, { status: 413 });
    }

    const body = await request.json().catch(() => ({}));
    const {
      amount,
      requestId = generateShortId('REQ'),
      paymentId = generateShortId('PAY'),
      userEmail = '',
      candidateName = '',
    } = body;

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return NextResponse.json(
        { success: false, error: 'Razorpay credentials not configured in environment variables.' },
        { status: 500 }
      );
    }

    // 1. Determine dynamic fee from config/metadata if not explicitly provided
    let finalFee = Number(amount);
    if (!finalFee || isNaN(finalFee) || finalFee <= 0) {
      finalFee = DEFAULT_ID_CARD_SETTINGS.replacementFee;
      if (hasAdminCredentials()) {
        try {
          let metaSnap = await adminDb.collection('config').doc('metadata').get();
          if (!metaSnap.exists) {
            metaSnap = await adminDb.collection('config').doc('club_metadata').get();
          }
          if (metaSnap.exists) {
            const meta = metaSnap.data() || {};
            if (meta.idCardSettings?.replacementFee && Number(meta.idCardSettings.replacementFee) > 0) {
              finalFee = Number(meta.idCardSettings.replacementFee);
            }
          }
        } catch (mErr) {
          console.warn('Metadata lookup notice in create-order:', mErr);
        }
      }
    }

    // 2. Initialize official Razorpay SDK
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

    const cleanReceipt = `rcpt_${requestId.replace(/[^A-Za-z0-9]/g, '').slice(-10)}_${Date.now().toString().slice(-4)}`;

    // 3. Create authentic Razorpay order with the dynamic amount
    const order = await instance.orders.create({
      amount: Math.round(finalFee * 100), // in paise
      currency: 'INR',
      receipt: cleanReceipt,
      notes: {
        type: 'id_replacement',
        requestId: String(requestId),
        paymentId: String(paymentId),
        userEmail: String(userEmail),
        candidateName: String(candidateName),
      },
    });

    if (!order || !order.id) {
      throw new Error('Failed to obtain order ID from Razorpay API.');
    }

    // 4. Update order ID in Firestore if adminDb is available
    if (hasAdminCredentials()) {
      try {
        if (requestId) {
          const reqRef = adminDb.collection('id_card_requests').doc(String(requestId));
          const reqSnap = await reqRef.get();
          if (reqSnap.exists) {
            await reqRef.update({
              razorpayOrderId: order.id,
              orderId: order.id,
              feeAmount: finalFee,
              amount: finalFee,
            });
          }
        }
        if (paymentId) {
          const payRef = adminDb.collection('payments').doc(String(paymentId));
          const paySnap = await payRef.get();
          if (paySnap.exists) {
            await payRef.update({
              razorpay_order_id: order.id,
              amount: finalFee,
            });
          }
        }
      } catch (dbErr) {
        console.warn('Firestore update warning in idcard create-order:', dbErr);
      }
    }

    return NextResponse.json({
      success: true,
      orderId: order.id,
      order_id: order.id,
      amount: finalFee,
      currency: 'INR',
      keyId: keyId,
      requestId,
      paymentId,
    });
  } catch (err: any) {
    console.error('Error in /api/idcard/create-order:', err);
    return NextResponse.json(
      {
        success: false,
        error: err?.error?.description || err?.message || 'Failed to create Razorpay order for ID card.',
      },
      { status: 500 }
    );
  }
}
