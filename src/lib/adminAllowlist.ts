const ADMIN_EMAILS = [
  'kampuskitaapp@gmail.com',
  'jualbeliusupolmed@gmail.com',
];

export function getAdminAllowlist(): string[] {
  const configured = process.env.ADMIN_EMAILS?.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return configured?.length ? [...new Set(configured)] : [...ADMIN_EMAILS];
}

export function isAdminEmailAllowed(
  email: string | undefined,
  allowlist = getAdminAllowlist()
): boolean {
  return Boolean(email && allowlist.includes(email.trim().toLowerCase()));
}
