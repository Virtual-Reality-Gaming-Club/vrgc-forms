import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { supabase } from '@/lib/supabase';

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

    // Robust Razorpay constructor initialization
    const RazorpayConstructor = typeof Razorpay === 'function' ? Razorpay : (Razorpay as any).default || Razorpay;

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

    // If paymentId is a valid UUID, safely update status to Processing in Supabase
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (paymentId && uuidRegex.test(String(paymentId))) {
      try {
        await supabase
          .from('payments')
          .update({
            razorpay_order_id: order.id,
            status: 'Processing',
            updated_at: new Date().toISOString(),
          })
          .eq('id', paymentId);
      } catch (dbErr) {
        console.warn('Supabase status update warning during order creation:', dbErr);
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
