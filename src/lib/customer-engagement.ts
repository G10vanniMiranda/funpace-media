import { Product } from '../types';

export const favoriteProductsStorageKey = 'funpace:favorites:v1';
export const likedProductsStorageKey = 'funpace:likes:v1';
const engagementVisitorStorageKey = 'funpace:engagement-visitor:v1';

function apiUrl(path: string) {
  const baseUrl = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
  if (!baseUrl) return path;
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export function loadFavoriteProducts(): Product[] {
  try {
    const raw = localStorage.getItem(favoriteProductsStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item?.id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveFavoriteProducts(products: Product[]) {
  localStorage.setItem(favoriteProductsStorageKey, JSON.stringify(products));
}

export function loadLikedProductIds(): Set<string> {
  try {
    const raw = localStorage.getItem(likedProductsStorageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

export function saveLikedProductIds(ids: Set<string>) {
  localStorage.setItem(likedProductsStorageKey, JSON.stringify(Array.from(ids)));
}

export function getEngagementVisitorId() {
  try {
    const existing = localStorage.getItem(engagementVisitorStorageKey);
    if (existing && existing.length <= 80) return existing;

    const id = crypto.randomUUID();
    localStorage.setItem(engagementVisitorStorageKey, id);
    return id;
  } catch {
    return 'anonymous';
  }
}

export async function fetchProductEngagementCounts(productIds: string[]) {
  const ids = Array.from(new Set(productIds.filter(Boolean))).slice(0, 200);
  if (ids.length === 0) return {};

  const params = new URLSearchParams({ ids: ids.join(',') });
  const response = await fetch(apiUrl(`/api/products/engagement?${params.toString()}`));
  if (!response.ok) return {};

  const payload = await response.json().catch(() => ({}));
  return (payload?.counts && typeof payload.counts === 'object') ? payload.counts as Record<string, number> : {};
}

export async function setProductHeart(productId: string, liked: boolean) {
  const response = await fetch(apiUrl(`/api/products/${encodeURIComponent(productId)}/favorite`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      liked,
      visitorId: getEngagementVisitorId(),
    }),
  });

  if (!response.ok) throw new Error('Não foi possível atualizar a curtida.');
  const payload = await response.json().catch(() => ({}));
  return Number(payload?.count || 0);
}

export function createProductSharePath(productId: string) {
  return `/?media=${encodeURIComponent(productId)}`;
}

export function createProductShareUrl(productId: string) {
  return `${window.location.origin}${createProductSharePath(productId)}`;
}

export async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Some browsers block clipboard outside strict user-activation contexts.
    }
  }

  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', 'true');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  document.body.appendChild(input);
  input.focus();
  input.select();
  const copied = document.execCommand('copy');
  input.remove();

  if (!copied) {
    throw new Error('Não foi possível copiar o link automaticamente.');
  }
}
