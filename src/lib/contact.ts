export const FUNPACE_CONTACT_EMAIL = 'funpacerunclub@gmail.com';
export const FUNPACE_WHATSAPP_NUMBER = '5569992565155';
export const FUNPACE_WHATSAPP_DISPLAY = '(69) 99256-5155';

export function buildMailtoUrl(input?: { subject?: string; body?: string }) {
  const params = new URLSearchParams();
  if (input?.subject) params.set('subject', input.subject);
  if (input?.body) params.set('body', input.body);
  const query = params.toString();
  return `mailto:${FUNPACE_CONTACT_EMAIL}${query ? `?${query}` : ''}`;
}

export function buildWhatsappUrl(message?: string) {
  const params = new URLSearchParams();
  if (message) params.set('text', message);
  const query = params.toString();
  return `https://wa.me/${FUNPACE_WHATSAPP_NUMBER}${query ? `?${query}` : ''}`;
}
