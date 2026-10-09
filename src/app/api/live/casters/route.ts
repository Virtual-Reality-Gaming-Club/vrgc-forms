import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { SERVER_CONFIG, isServerSuperAdmin } from '@/lib/server/config';

// ── GET: Fetch Active Casters & Caster Managers ──────────────────────────────
export async function GET() {
  try {
    // 1. Fetch permissions config
    const permSnap = await adminDb.collection('config').doc('permissions').get();
    const permData = permSnap.exists ? permSnap.data() : {};
    const allowedCasterManagerRoles: string[] =
      permData?.allowedCasterManagerRoles || ['Admin', 'Technical'];
    const allowedCasterManagerEmails: string[] =
      permData?.allowedCasterManagerEmails || [];

    // 2. Fetch casters from live_casters collection
    const castersSnap = await adminDb.collection('live_casters').get();
    const castersList: Array<{
      email: string;
      name?: string;
      assignedBy?: string;
      assignedAt?: string;
    }> = [];

    castersSnap.forEach((doc) => {
      const data = doc.data();
      castersList.push({
        email: data.email || doc.id,
        name: data.name || '',
        assignedBy: data.assignedBy || 'System',
        assignedAt: data.assignedAt || '',
      });
    });

    return NextResponse.json({
      adminRoles: SERVER_CONFIG.ADMIN_ROLES,
      allowedCasterManagerRoles,
      allowedCasterManagerEmails,
      casters: castersList,
    });
  } catch (err: any) {
    console.error('Error fetching casters list:', err);
    return NextResponse.json(
      { error: 'Failed to fetch casters data', details: err?.message },
      { status: 500 }
    );
  }
}

// ── POST: Grant or Revoke Caster Role ────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { callerEmail, targetEmail, targetName, action } = body;

    if (!callerEmail || !targetEmail || !action) {
      return NextResponse.json(
        { error: 'Missing required parameters: callerEmail, targetEmail, action' },
        { status: 400 }
      );
    }

    const cleanCaller = callerEmail.trim().toLowerCase();
    const cleanTarget = targetEmail.trim().toLowerCase();

    // 1. Authorization check: Is caller a SuperAdmin or Caster Manager?
    const isSuperAdmin = isServerSuperAdmin(cleanCaller);

    let isCasterManager = false;
    if (!isSuperAdmin) {
      const permSnap = await adminDb.collection('config').doc('permissions').get();
      const permData = permSnap.exists ? permSnap.data() : {};
      const allowedRoles = (permData?.allowedCasterManagerRoles || ['Admin', 'Technical']).map(
        (r: string) => r.trim().toLowerCase()
      );
      const allowedEmails = (permData?.allowedCasterManagerEmails || []).map((e: string) =>
        e.trim().toLowerCase()
      );

      if (allowedEmails.includes(cleanCaller)) {
        isCasterManager = true;
      } else {
        // Check caller's role in roles collection
        const roleSnap = await adminDb.collection('roles').doc(cleanCaller).get();
        if (roleSnap.exists) {
          const role = (roleSnap.data()?.role || '').trim().toLowerCase();
          if (allowedRoles.includes(role)) {
            isCasterManager = true;
          }
        }
      }
    }

    if (!isSuperAdmin && !isCasterManager) {
      return NextResponse.json(
        { error: 'Operation Denied: You do not have permission to manage casters.' },
        { status: 403 }
      );
    }

    const nowIso = new Date().toISOString();

    if (action === 'grant') {
      // Grant Caster Role
      await adminDb.collection('roles').doc(cleanTarget).set(
        {
          id: cleanTarget,
          email: cleanTarget,
          role: 'Caster',
          assignedBy: cleanCaller,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      await adminDb.collection('admins').doc(cleanTarget).set(
        {
          id: cleanTarget,
          email: cleanTarget,
          role: 'Caster',
          addedBy: cleanCaller,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      await adminDb.collection('live_casters').doc(cleanTarget).set(
        {
          email: cleanTarget,
          name: targetName || cleanTarget.split('@')[0],
          assignedBy: cleanCaller,
          assignedAt: nowIso,
        },
        { merge: true }
      );

      return NextResponse.json({
        success: true,
        message: `Granted Caster role to ${cleanTarget}`,
      });
    } else if (action === 'revoke') {
      // Revoke Caster Role
      await adminDb.collection('live_casters').doc(cleanTarget).delete();

      // Reset role if it is currently 'Caster'
      const roleDoc = await adminDb.collection('roles').doc(cleanTarget).get();
      if (roleDoc.exists && roleDoc.data()?.role === 'Caster') {
        await adminDb.collection('roles').doc(cleanTarget).delete();
      }

      const adminDoc = await adminDb.collection('admins').doc(cleanTarget).get();
      if (adminDoc.exists && adminDoc.data()?.role === 'Caster') {
        await adminDb.collection('admins').doc(cleanTarget).delete();
      }

      return NextResponse.json({
        success: true,
        message: `Revoked Caster role from ${cleanTarget}`,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    console.error('Error handling caster action:', err);
    return NextResponse.json(
      { error: 'Failed to process caster role operation', details: err?.message },
      { status: 500 }
    );
  }
}

// ── PUT: Super Admin Updates Caster Delegation Authority ─────────────────────
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { callerEmail, allowedCasterManagerRoles, allowedCasterManagerEmails } = body;

    const cleanCaller = (callerEmail || '').trim().toLowerCase();

    // Strictly requires Super Admin
    if (!isServerSuperAdmin(cleanCaller)) {
      return NextResponse.json(
        {
          error:
            'Operation Denied: Only Super Administrators can configure caster delegation permissions.',
        },
        { status: 403 }
      );
    }

    const updatePayload: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };
    if (Array.isArray(allowedCasterManagerRoles)) {
      updatePayload.allowedCasterManagerRoles = allowedCasterManagerRoles;
    }
    if (Array.isArray(allowedCasterManagerEmails)) {
      updatePayload.allowedCasterManagerEmails = allowedCasterManagerEmails.map((e) =>
        e.trim().toLowerCase()
      );
    }

    await adminDb.collection('config').doc('permissions').set(updatePayload, { merge: true });

    return NextResponse.json({
      success: true,
      message: 'Caster delegation permissions updated successfully',
    });
  } catch (err: any) {
    console.error('Error updating caster manager config:', err);
    return NextResponse.json(
      { error: 'Failed to update caster delegation configuration', details: err?.message },
      { status: 500 }
    );
  }
}

