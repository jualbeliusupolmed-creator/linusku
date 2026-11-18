const DEFAULT_ADMIN_EMAILS = ['kampuskitaapp@gmail.com'];

export function getAdminAllowlist(): string[] {
  const configuredEmails = (process.env.LINUSKU_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return configuredEmails.length > 0
    ? configuredEmails
    : DEFAULT_ADMIN_EMAILS;
}

export function isAdminEmailAllowed(
  email: string | undefined,
  allowlist = getAdminAllowlist()
): boolean {
  return Boolean(email && allowlist.includes(email.trim().toLowerCase()));
}
