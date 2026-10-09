import { NextResponse } from 'next/server';
import { SERVER_CONFIG } from '@/lib/server/config';

export async function GET() {
  return NextResponse.json(
    {
      adminRoles: SERVER_CONFIG.ADMIN_ROLES,
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    }
  );
}

