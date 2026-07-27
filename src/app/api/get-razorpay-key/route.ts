import { NextResponse } from 'next/server';

export async function GET() {
  const keyId = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '';
  return NextResponse.json({ keyId });
}
