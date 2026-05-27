import { Product } from '../types';

export const favoriteProductsStorageKey = 'funpace:favorites:v1';
export const likedProductsStorageKey = 'funpace:likes:v1';

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
    throw new Error('Nao foi possivel copiar o link automaticamente.');
  }
}
