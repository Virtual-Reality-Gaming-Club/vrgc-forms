export const PRIMARY_ADMIN_EMAILS = [
  'anmol.25bai10263@vitbhopal.ac.in',
  'vrgc@vitbhopal.ac.in',
  'vrgcdev@gmail.com',
];

export function isMemberAdminUser(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();

  return (
    normalized === 'vrgcdev@gmail.com' ||
    normalized === 'vrgc@vitbhopal.ac.in' ||
    normalized === 'anmol.25bai10263@vitbhopal.ac.in' ||
    normalized.startsWith('anmol.25bai10263')
  );
}
