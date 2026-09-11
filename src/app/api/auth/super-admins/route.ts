import { NextResponse } from 'next/server';
import { SERVER_CONFIG } from '@/lib/server/config';

export async function GET() {
  const superAdmins = SERVER_CONFIG.SUPER_ADMIN_EMAILS;

  return NextResponse.json(
    { superAdmins },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    }
  );
}