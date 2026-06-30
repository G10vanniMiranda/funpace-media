import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('admin approval links pending photographer records to Supabase Auth before activating', () => {
  const action = readFileSync('server/api/admin/photographers/action.ts', 'utf8');
  const dashboard = readFileSync('src/components/AdminDashboard.tsx', 'utf8');
  const services = readFileSync('src/lib/services.ts', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');
  const login = readFileSync('src/components/PhotographerLogin.tsx', 'utf8');

  assert.match(action, /findAuthUserByEmail/);
  assert.match(action, /auth_user_id/);
  assert.match(action, /id: authUser\.id/);
  assert.match(action, /approved: true/);
  assert.match(action, /status: 'active'/);
  assert.match(action, /logApprovalStep\('approval_started'/);
  assert.match(action, /logApprovalStep\('approval_completed'/);
  assert.match(action, /AUTH_USER_MISSING/);

  assert.match(dashboard, /setPhotographerAdminStatus\(id, 'reactivate'\)/);
  assert.doesNotMatch(dashboard, /handleVerifyPhotographer[\s\S]{0,160}verifyPhotographer\(id\)/);
  assert.match(services, /\/api\/admin\/photographers\/\$\{encodeURIComponent\(id\)\}\/\$\{action\}/);

  assert.match(login, /\/api\/photographers\/claim/);
  assert.match(app, /getPhotographerById\(photographerId\)/);
  assert.match(app, /currentPhotographer\?\.verified/);
});

