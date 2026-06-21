import { supabaseRequest } from './utils.js';

type ReferralSettings = {
  enabled?: boolean;
  rewardRuleType?: 'approval_fixed' | 'first_sale_fixed' | 'recurring_commission';
  approvalRewardAmount?: number;
  firstSaleRewardAmount?: number;
  recurringCommissionPercent?: number;
  recurringCommissionMonths?: number;
};

const defaultReferralSettings: Required<ReferralSettings> = {
  enabled: true,
  rewardRuleType: 'first_sale_fixed',
  approvalRewardAmount: 50,
  firstSaleRewardAmount: 100,
  recurringCommissionPercent: 5,
  recurringCommissionMonths: 3,
};

function normalizeReferralCode(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function getReferralSettings(): Promise<Required<ReferralSettings>> {
  const rows = await supabaseRequest<any[]>(
    '/rest/v1/platform_settings?select=referralSettings&id=eq.default&limit=1',
  ).catch(() => []);
  return { ...defaultReferralSettings, ...(rows[0]?.referralSettings || {}) };
}

export async function ensurePhotographerReferralCode(photographer: { id: string; referralCode?: string | null; username?: string | null; slug?: string | null; displayName?: string | null; name?: string | null }) {
  const existing = normalizeReferralCode(String(photographer.referralCode || ''));
  if (existing) return existing;

  const base = normalizeReferralCode(String(photographer.username || photographer.slug || photographer.displayName || photographer.name || photographer.id));
  for (let index = 0; index < 20; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    const conflict = await supabaseRequest<any[]>(
      `/rest/v1/photographers?select=id&referralCode=eq.${encodeURIComponent(candidate)}&id=neq.${encodeURIComponent(photographer.id)}&limit=1`,
    ).catch(() => []);
    if (conflict.length > 0) continue;
    await supabaseRequest(`/rest/v1/photographers?id=eq.${encodeURIComponent(photographer.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ referralCode: candidate, updatedAt: new Date().toISOString() }),
    }).catch(() => undefined);
    return candidate;
  }

  return `${base}-${Date.now().toString(36)}`;
}

export async function registerPendingReferral(input: {
  referralCode?: string | null;
  referredPhotographerId: string;
  referredEmail: string;
  referredCpf?: string | null;
  referredPhone?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
}) {
  const code = normalizeReferralCode(String(input.referralCode || ''));
  if (!code || !input.referredPhotographerId) return;

  const settings = await getReferralSettings();
  if (!settings.enabled) return;

  const referrers = await supabaseRequest<any[]>(
    `/rest/v1/photographers?select=id,email,cpf,phone,referralCode,username,slug&or=(referralCode.eq.${encodeURIComponent(code)},username.eq.${encodeURIComponent(code)},slug.eq.${encodeURIComponent(code)})&verified=eq.true&limit=1`,
  ).catch(() => []);
  const referrer = referrers[0];
  if (!referrer?.id) return;

  const referredRows = await supabaseRequest<any[]>(
    `/rest/v1/photographers?select=id,email,cpf,phone&id=eq.${encodeURIComponent(input.referredPhotographerId)}&limit=1`,
  ).catch(() => []);
  const referred = referredRows[0];
  const sameEmail = String(referrer.email || '').toLowerCase() === String(input.referredEmail || referred?.email || '').toLowerCase();
  const sameCpf = input.referredCpf && referrer.cpf && String(referrer.cpf) === String(input.referredCpf);
  const samePhone = input.referredPhone && referrer.phone && String(referrer.phone).replace(/\D/g, '') === String(input.referredPhone).replace(/\D/g, '');
  if (referrer.id === input.referredPhotographerId || sameEmail || sameCpf || samePhone) return;

  const now = new Date().toISOString();
  const created = await supabaseRequest<any[]>('/rest/v1/photographer_referrals?on_conflict=referredPhotographerId&select=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      referrerPhotographerId: referrer.id,
      referredPhotographerId: input.referredPhotographerId,
      referralCode: code,
      status: 'pending',
      rewardAmount: 0,
      rewardStatus: 'none',
      audit: {
        referredEmail: input.referredEmail,
        referredCpf: input.referredCpf || null,
        referredPhone: input.referredPhone || null,
        ipHash: input.ipHash || null,
        userAgent: input.userAgent || null,
        createdBy: 'photographer_request',
      },
      createdAt: now,
    }),
  }).catch((error) => {
    console.error('Nao foi possivel registrar indicacao:', error);
    return [] as any[];
  });

  await supabaseRequest(`/rest/v1/photographers?id=eq.${encodeURIComponent(input.referredPhotographerId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      referredByPhotographerId: referrer.id,
      referral_id: created?.[0]?.id || null,
      invited_by: referrer.id,
      updatedAt: now,
    }),
  }).catch(() => undefined);
}

export async function markReferralApproved(referredPhotographerId: string) {
  const settings = await getReferralSettings();
  const now = new Date().toISOString();
  const rewardAmount = settings.rewardRuleType === 'approval_fixed' ? Number(settings.approvalRewardAmount || 0) : 0;
  await supabaseRequest(`/rest/v1/photographer_referrals?referredPhotographerId=eq.${encodeURIComponent(referredPhotographerId)}&status=eq.pending`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'approved',
      approvedAt: now,
      rewardAmount,
      rewardStatus: rewardAmount > 0 ? 'available' : 'none',
    }),
  }).catch((error) => console.error('Nao foi possivel aprovar indicacao:', error));
}

export async function markReferralFirstSale(referredPhotographerId: string, saleAmount = 0) {
  const settings = await getReferralSettings();
  const now = new Date().toISOString();
  const rows = await supabaseRequest<any[]>(
    `/rest/v1/photographer_referrals?select=*&referredPhotographerId=eq.${encodeURIComponent(referredPhotographerId)}&status=in.(pending,approved,active)&limit=1`,
  ).catch(() => []);
  const referral = rows[0];
  if (!referral?.id) return;

  let rewardAmount = Number(referral.rewardAmount || 0);
  if (settings.rewardRuleType === 'first_sale_fixed' && referral.status !== 'active') {
    rewardAmount = Number(settings.firstSaleRewardAmount || 0);
  } else if (settings.rewardRuleType === 'recurring_commission') {
    const start = new Date(referral.approvedAt || referral.createdAt || now).getTime();
    const monthsMs = Math.max(1, Number(settings.recurringCommissionMonths || 1)) * 31 * 24 * 60 * 60 * 1000;
    if (Date.now() - start <= monthsMs) {
      rewardAmount += Number((Number(saleAmount || 0) * Number(settings.recurringCommissionPercent || 0) / 100).toFixed(2));
    }
  }

  await supabaseRequest(`/rest/v1/photographer_referrals?id=eq.${encodeURIComponent(referral.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'active',
      firstSaleAt: referral.firstSaleAt || now,
      rewardAmount,
      rewardStatus: rewardAmount > 0 ? 'available' : 'none',
    }),
  }).catch((error) => console.error('Nao foi possivel ativar indicacao:', error));
}
