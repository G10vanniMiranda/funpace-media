export function onlyWhatsappDigits(value: string | null | undefined) {
  const digits = (value ?? '').replace(/\D/g, '');
  const withoutCountryCode = digits.length > 11 && digits.startsWith('55') ? digits.slice(2) : digits;

  return withoutCountryCode.slice(0, 11);
}

export function formatWhatsapp(value: string | null | undefined) {
  const digits = onlyWhatsappDigits(value);

  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}
