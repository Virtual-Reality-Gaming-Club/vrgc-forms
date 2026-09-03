/**
 * Client-side service for member CRUD operations.
 * Calls secure server-side API routes with the user's Firebase ID token.
 */
import { auth } from './firebase';
import type { MemberLogChanges } from './adminLogs';

export interface MemberFormData {
  name: string;
  registrationNumber: string;
  email: string;
  phone?: string;
  team: string;
  position: string;
  photoUrl?: string;
}

export interface MemberDocument extends MemberFormData {
  id: string;
  createdAt?: string;
  updatedAt?: string;
}

interface ApiResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Gets the current user's Firebase ID token for authenticated API calls.
 */
async function getIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Not authenticated');
  }
  return user.getIdToken(true);
}

/**
 * Creates a new member via the secure API route.
 */
export async function createMember(data: MemberFormData): Promise<ApiResult<{ id: string }>> {
  try {
    const token = await getIdToken();
    const res = await fetch('/api/admin/members', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });

    const result = await res.json();
    if (!res.ok) {
      return { success: false, error: result.error || 'Failed to create member' };
    }
    return { success: true, data: result };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error' };
  }
}

/**
 * Updates an existing member via the secure API route.
 * Sends only the changed fields along with the member ID.
 */
export async function updateMember(
  id: string,
  data: Partial<MemberFormData>,
  changes?: MemberLogChanges
): Promise<ApiResult> {
  try {
    const token = await getIdToken();
    const res = await fetch('/api/admin/members', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id, ...data, _changes: changes }),
    });

    const result = await res.json();
    if (!res.ok) {
      return { success: false, error: result.error || 'Failed to update member' };
    }
    return { success: true, data: result };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error' };
  }
}

/**
 * Deletes a member via the secure API route.
 */
export async function deleteMember(id: string): Promise<ApiResult> {
  try {
    const token = await getIdToken();
    const res = await fetch('/api/admin/members', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id }),
    });

    const result = await res.json();
    if (!res.ok) {
      return { success: false, error: result.error || 'Failed to delete member' };
    }
    return { success: true, data: result };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error' };
  }
}
