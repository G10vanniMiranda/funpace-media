import type { Product, ProductType } from '../types';

export const BULK_PHOTO_DISCOUNT_MIN_PHOTOS = 5;
export const BULK_PHOTO_DISCOUNT_PERCENT = 15;

export type CartPricingItem = Pick<Product, 'id' | 'price' | 'type'>;

export type CartPricingSummary = {
  itemCount: number;
  photoCount: number;
  subtotal: number;
  photoSubtotal: number;
  automaticDiscountTotal: number;
  automaticDiscountPercent: number;
  automaticDiscountActive: boolean;
  total: number;
};

export function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function isPhotoType(type: ProductType | string | undefined | null) {
  return type === 'IMG';
}

export function calculateBulkPhotoDiscount(input: { photoCount: number; photoSubtotal: number }) {
  if (input.photoCount < BULK_PHOTO_DISCOUNT_MIN_PHOTOS) return 0;
  return roundMoney(Math.max(0, input.photoSubtotal) * BULK_PHOTO_DISCOUNT_PERCENT / 100);
}

export function calculateCartPricing(items: CartPricingItem[]): CartPricingSummary {
  const subtotal = roundMoney(items.reduce((sum, item) => sum + Number(item.price || 0), 0));
  const photoItems = items.filter((item) => isPhotoType(item.type));
  const photoSubtotal = roundMoney(photoItems.reduce((sum, item) => sum + Number(item.price || 0), 0));
  const automaticDiscountTotal = calculateBulkPhotoDiscount({
    photoCount: photoItems.length,
    photoSubtotal,
  });

  return {
    itemCount: items.length,
    photoCount: photoItems.length,
    subtotal,
    photoSubtotal,
    automaticDiscountTotal,
    automaticDiscountPercent: automaticDiscountTotal > 0 ? BULK_PHOTO_DISCOUNT_PERCENT : 0,
    automaticDiscountActive: automaticDiscountTotal > 0,
    total: roundMoney(subtotal - automaticDiscountTotal),
  };
}

export function formatPromotionLabel(summary: Pick<CartPricingSummary, 'automaticDiscountActive' | 'automaticDiscountPercent'>) {
  return summary.automaticDiscountActive
    ? `Desconto (${summary.automaticDiscountPercent}%)`
    : 'Desconto';
}
