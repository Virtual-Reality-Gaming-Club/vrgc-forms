import { auth } from '@/lib/firebase';

/**
 * Retrieves the currently signed-in Firebase user's ID token.
 * Returns null if no user is signed in.
 */
export async function getClientAuthToken(forceRefresh = false): Promise<string | null> {
  const currentUser = auth.currentUser;
  if (!currentUser) return null;
  return currentUser.getIdToken(forceRefresh);
}

/**
 * Generates an Authorization header object with the current user's Bearer token.
 * Returns an empty object if no user is authenticated.
 */
export async function getAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const token = await getClientAuthToken(forceRefresh);
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
