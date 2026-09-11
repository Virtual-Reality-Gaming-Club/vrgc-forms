import { NextResponse } from 'next/server';

export async function GET() {
  const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();

  if (!keyId) {
    return NextResponse.json(
      { keyId: '', error: 'Razorpay public Key ID is not configured on server.' },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { keyId },
    {
      headers: {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    }
  );
}

