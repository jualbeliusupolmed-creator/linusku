const ADMIN_EMAILS = [
  'kampuskitaapp@gmail.com',
  'jualbeliusupolmed@gmail.com',
];

export function getAdminAllowlist(): string[] {
  return [...ADMIN_EMAILS];
}

export function isAdminEmailAllowed(
  email: string | undefined,
  allowlist = getAdminAllowlist()
): boolean {
  return Boolean(email && allowlist.includes(email.trim().toLowerCase()));
}
