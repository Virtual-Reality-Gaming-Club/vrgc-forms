/**
 * Secure API route for member CRUD operations.
 * All operations require a valid Firebase ID token from a Payment Admin.
 *
 * POST   - Create a new member
 * PUT    - Update an existing member
 * DELETE - Delete a member
 */

import { NextResponse } from 'next/server';
import { verifyFirebaseToken, isPaymentAdminEmail } from '@/lib/firebase-server';

// Initialize Firebase client SDK for Firestore operations on the server
// (The project uses client SDK everywhere — no firebase-admin)
import { db } from '@/lib/firebase';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { logMemberAdminAction } from '@/lib/adminLogs';
import type { MemberLogChanges } from '@/lib/adminLogs';

export const dynamic = 'force-dynamic';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Validates and authorizes the request. Returns the verified user or an error response.
 */
async function authorizePaymentAdmin(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: errorResponse('Missing or invalid Authorization header', 401) };
  }

  const idToken = authHeader.slice(7);
  if (!idToken) {
    return { error: errorResponse('Empty token', 401) };
  }

  try {
    const user = await verifyFirebaseToken(idToken);
    if (!user.email) {
      return { error: errorResponse('Token does not contain an email', 401) };
    }

    if (!isPaymentAdminEmail(user.email)) {
      return { error: errorResponse('Unauthorized: Payment Admin access required', 403) };
    }

    return { user };
  } catch (err: any) {
    return { error: errorResponse(err.message || 'Token verification failed', 401) };
  }
}

/** Simple email format validation */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── POST: Create Member ──────────────────────────────────────────────────────

export async function POST(req: Request) {
  const authResult = await authorizePaymentAdmin(req);
  if ('error' in authResult) return authResult.error;
  const admin = authResult.user;

  try {
    const body = await req.json();
    const { name, registrationNumber, email, phone, team, position, photoUrl } = body;

    // Validation
    if (!name?.trim()) return errorResponse('Name is required', 400);
    if (!registrationNumber?.trim()) return errorResponse('Registration number is required', 400);
    if (!email?.trim()) return errorResponse('Email is required', 400);
    if (!isValidEmail(email.trim())) return errorResponse('Invalid email format', 400);
    if (!team?.trim()) return errorResponse('Team is required', 400);

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedRegNo = registrationNumber.trim().toUpperCase();

    // Check for duplicate registration number
    const regQuery = query(
      collection(db, 'members'),
      where('registrationNumber', '==', normalizedRegNo)
    );
    const regSnap = await getDocs(regQuery);
    if (!regSnap.empty) {
      return errorResponse(`A member with registration number ${normalizedRegNo} already exists`, 409);
    }

    // Check for duplicate email
    const emailQuery = query(
      collection(db, 'members'),
      where('email', '==', normalizedEmail)
    );
    const emailSnap = await getDocs(emailQuery);
    if (!emailSnap.empty) {
      return errorResponse(`A member with email ${normalizedEmail} already exists`, 409);
    }

    // Create member document
    const memberData = {
      name: name.trim(),
      registrationNumber: normalizedRegNo,
      email: normalizedEmail,
      phone: phone?.trim() || '',
      team: team.trim(),
      position: (position?.trim()) || 'Member',
      photoUrl: photoUrl?.trim() || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const docRef = await addDoc(collection(db, 'members'), memberData);

    // Audit log
    await logMemberAdminAction({
      adminEmail: admin.email,
      adminName: admin.displayName,
      action: 'MEMBER_CREATED',
      targetId: docRef.id,
      targetName: memberData.name,
      targetEmail: memberData.email,
      targetRegNo: memberData.registrationNumber,
      details: `Created member ${memberData.name} (${memberData.registrationNumber}) in ${memberData.team}`,
    });

    return NextResponse.json({
      success: true,
      id: docRef.id,
      message: `Member ${memberData.name} created successfully`,
    });
  } catch (err: any) {
    console.error('[API/admin/members] POST error:', err);
    return errorResponse('Failed to create member. Please try again.', 500);
  }
}

// ─── PUT: Update Member ───────────────────────────────────────────────────────

export async function PUT(req: Request) {
  const authResult = await authorizePaymentAdmin(req);
  if ('error' in authResult) return authResult.error;
  const admin = authResult.user;

  try {
    const body = await req.json();
    const { id, _changes, ...updateFields } = body;

    if (!id?.trim()) return errorResponse('Member ID is required', 400);

    // Verify member exists
    const memberRef = doc(db, 'members', id);
    const memberSnap = await getDoc(memberRef);
    if (!memberSnap.exists()) {
      return errorResponse('Member not found', 404);
    }

    const existingData = memberSnap.data();

    // Validate email if being changed
    if (updateFields.email) {
      const normalizedEmail = updateFields.email.trim().toLowerCase();
      if (!isValidEmail(normalizedEmail)) {
        return errorResponse('Invalid email format', 400);
      }
      // Check for duplicate email (excluding current member)
      if (normalizedEmail !== (existingData.email || '').toLowerCase()) {
        const emailQuery = query(
          collection(db, 'members'),
          where('email', '==', normalizedEmail)
        );
        const emailSnap = await getDocs(emailQuery);
        if (!emailSnap.empty) {
          return errorResponse(`A member with email ${normalizedEmail} already exists`, 409);
        }
      }
      updateFields.email = normalizedEmail;
    }

    // Validate registration number if being changed
    if (updateFields.registrationNumber) {
      const normalizedRegNo = updateFields.registrationNumber.trim().toUpperCase();
      if (normalizedRegNo !== (existingData.registrationNumber || '').toUpperCase()) {
        const regQuery = query(
          collection(db, 'members'),
          where('registrationNumber', '==', normalizedRegNo)
        );
        const regSnap = await getDocs(regQuery);
        if (!regSnap.empty) {
          return errorResponse(`A member with registration number ${normalizedRegNo} already exists`, 409);
        }
      }
      updateFields.registrationNumber = normalizedRegNo;
    }

    // Clean and prepare update data (only update provided fields)
    const cleanUpdate: Record<string, any> = {};
    const allowedFields = ['name', 'registrationNumber', 'email', 'phone', 'team', 'position', 'photoUrl'];

    for (const field of allowedFields) {
      if (updateFields[field] !== undefined) {
        cleanUpdate[field] = typeof updateFields[field] === 'string'
          ? updateFields[field].trim()
          : updateFields[field];
      }
    }

    if (Object.keys(cleanUpdate).length === 0) {
      return errorResponse('No fields to update', 400);
    }

    cleanUpdate.updatedAt = new Date().toISOString();

    await updateDoc(memberRef, cleanUpdate);

    // Audit log with changes
    const changes: MemberLogChanges = _changes || {};
    await logMemberAdminAction({
      adminEmail: admin.email,
      adminName: admin.displayName,
      action: 'MEMBER_UPDATED',
      targetId: id,
      targetName: cleanUpdate.name || existingData.name || 'Unknown',
      targetEmail: cleanUpdate.email || existingData.email,
      targetRegNo: cleanUpdate.registrationNumber || existingData.registrationNumber,
      changes,
      details: `Updated member ${existingData.name || 'Unknown'} (${existingData.registrationNumber || id})`,
    });

    return NextResponse.json({
      success: true,
      message: `Member updated successfully`,
    });
  } catch (err: any) {
    console.error('[API/admin/members] PUT error:', err);
    return errorResponse('Failed to update member. Please try again.', 500);
  }
}

// ─── DELETE: Delete Member ────────────────────────────────────────────────────

export async function DELETE(req: Request) {
  const authResult = await authorizePaymentAdmin(req);
  if ('error' in authResult) return authResult.error;
  const admin = authResult.user;

  try {
    const body = await req.json();
    const { id } = body;

    if (!id?.trim()) return errorResponse('Member ID is required', 400);

    // Verify member exists and get their data for the audit log
    const memberRef = doc(db, 'members', id);
    const memberSnap = await getDoc(memberRef);
    if (!memberSnap.exists()) {
      return errorResponse('Member not found', 404);
    }

    const memberData = memberSnap.data();

    // Delete the member
    await deleteDoc(memberRef);

    // Audit log
    await logMemberAdminAction({
      adminEmail: admin.email,
      adminName: admin.displayName,
      action: 'MEMBER_DELETED',
      targetId: id,
      targetName: memberData.name || 'Unknown',
      targetEmail: memberData.email,
      targetRegNo: memberData.registrationNumber,
      details: `Deleted member ${memberData.name || 'Unknown'} (${memberData.registrationNumber || id}) from ${memberData.team || 'Unknown Team'}`,
    });

    return NextResponse.json({
      success: true,
      message: `Member ${memberData.name || ''} deleted successfully`,
    });
  } catch (err: any) {
    console.error('[API/admin/members] DELETE error:', err);
    return errorResponse('Failed to delete member. Please try again.', 500);
  }
}
