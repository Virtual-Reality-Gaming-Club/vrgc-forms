/**
 * SERVER_CONFIG — server-only configuration.
 *
 * This module must NEVER be imported from client-side code ("use client" files,
 * browser-executed modules, or any file that does not run exclusively on the server).
 *
 * ARCHITECTURE:
 * - SUPER_ADMIN_EMAILS is the ONLY env-var-controlled role. It is part of the
 *   intentional hidden Super Admin mechanism. Do not remove or rename it.
 * - ALL other roles (Admin, Payment Admin, Technical, etc.) are managed exclusively
 *   through Firebase/Firestore via the Super Admin Console. There are no env-var
 *   fallbacks, bootstraps, or failsafes for normal roles.
 */

if (typeof window !== 'undefined') {
  throw new Error(
    '[SERVER_CONFIG] This module must only be used in server-side environments. ' +
    'Import it only from Next.js API route handlers or server utilities.'
  );
}

export const SERVER_CONFIG = {
  /**
   * Super Admin email list — read from SUPER_ADMIN_EMAILS env var.
   */
  SUPER_ADMIN_EMAILS: (process.env.SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  /**
   * Base authorized admin roles — read from ADMIN_ROLES env var.
   */
  ADMIN_ROLES: (process.env.ADMIN_ROLES || 'Super Administrator,Admin,Technical')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean),
};

export function isServerSuperAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  return SERVER_CONFIG.SUPER_ADMIN_EMAILS.includes(clean);
}

export function isServerAdminRole(role: string | null | undefined): boolean {
  if (!role) return false;
  const clean = role.trim().toLowerCase();
  return SERVER_CONFIG.ADMIN_ROLES.some((r) => r.toLowerCase() === clean);
}

