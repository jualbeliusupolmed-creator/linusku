import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAdminAllowlist } from './adminAllowlist';

describe('admin email allowlist', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the configured superadmin when no server allowlist is set', () => {
    vi.stubEnv('LINUSKU_ADMIN_EMAILS', '');

    expect(getAdminAllowlist()).toEqual(['kampuskitaapp@gmail.com']);
  });

  it('uses configured emails instead of the default', () => {
    vi.stubEnv('LINUSKU_ADMIN_EMAILS', 'Admin@Example.com, driver@example.com ');

    expect(getAdminAllowlist()).toEqual([
      'admin@example.com',
      'driver@example.com',
    ]);
  });
});
