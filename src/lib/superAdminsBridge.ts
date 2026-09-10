// Client-side helper with memory cache to retrieve Super Admins via the API bridge
import { CONFIG } from '@/lib/config';
import { getAuthHeaders } from '@/lib/auth-client';

let cachedSuperAdmins: string[] | null = null;
let fetchPromise: Promise<string[]> | null = null;

export async function getSuperAdminEmails(): Promise<string[]> {
  if (cachedSuperAdmins && cachedSuperAdmins.length > 0) {
    return cachedSuperAdmins;
  }

  if (fetchPromise) {
    return fetchPromise;
  }

  fetchPromise = (async () => {
    const fallbackList = (CONFIG.SUPER_ADMIN_EMAILS || []).map((e) => e.toLowerCase().trim());
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/auth/super-admins', {
        headers: authHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.superAdmins) && data.superAdmins.length > 0) {
          const combined = Array.from(
            new Set([...data.superAdmins.map((e: string) => e.toLowerCase().trim()), ...fallbackList])
          ).filter(Boolean);
          cachedSuperAdmins = combined;
          return combined;
        }
      }
    } catch (err) {
      console.warn('Failed to fetch super admins via API bridge, using fallback:', err);
    } finally {
      fetchPromise = null;
    }
    cachedSuperAdmins = fallbackList;
    return fallbackList;
  })();

  return fetchPromise;
}