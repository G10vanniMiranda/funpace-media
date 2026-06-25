import React from 'react';
import { getCurrentAccessToken } from '../lib/supabase';

export type ContentProtectionAttempt =
  | 'context_menu'
  | 'dragstart'
  | 'copy'
  | 'keyboard_devtools'
  | 'view_source'
  | 'devtools_open';

type ReportInput = {
  type: ContentProtectionAttempt;
  message?: string;
  mediaId?: string | null;
  eventName?: string | null;
  metadata?: Record<string, unknown>;
};

interface UseContentProtectionOptions {
  enabled?: boolean;
  scope?: string;
}

const rightClickMessage = [
  'Tudo bem, campeão! 😎',
  '',
  'As fotos estão protegidas para garantir os direitos do fotógrafo.',
  '',
  "Adquira sua foto para obter a versão original em alta qualidade e sem marca d'água.",
].join('\n');

const protectedMessage = 'Desculpe, conteúdo protegido.';

function isBlockedShortcut(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  const ctrlOrMeta = event.ctrlKey || event.metaKey;
  const macDevtools = event.metaKey && event.altKey && key === 'i';

  return event.key === 'F12' ||
    (ctrlOrMeta && event.shiftKey && ['i', 'j', 'c'].includes(key)) ||
    (ctrlOrMeta && key === 'u') ||
    macDevtools;
}

function getShortcutAttempt(event: KeyboardEvent): ContentProtectionAttempt {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'u' ? 'view_source' : 'keyboard_devtools';
}

function isTouchOrMobileViewport() {
  if (typeof window === 'undefined') return false;
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
  const smallViewport = window.innerWidth <= 900;
  const touchDevice = navigator.maxTouchPoints > 0;
  return Boolean(coarsePointer || touchDevice || smallViewport);
}

function shouldRunDevtoolsDetection() {
  if (typeof window === 'undefined') return false;
  if (isTouchOrMobileViewport()) return false;
  return window.innerWidth >= 1024 && window.innerHeight >= 600;
}

export function getContentProtectionMessage(type: ContentProtectionAttempt) {
  return type === 'context_menu' ? rightClickMessage : protectedMessage;
}

export function useContentProtection({ enabled = true, scope = 'public-gallery' }: UseContentProtectionOptions = {}) {
  const [notice, setNotice] = React.useState<string | null>(null);
  const [devtoolsOpen, setDevtoolsOpen] = React.useState(false);
  const devtoolsWasOpen = React.useRef(false);
  const lastLogAt = React.useRef<Record<string, number>>({});

  const reportAttempt = React.useCallback((input: ReportInput) => {
    if (!enabled) return;

    const message = input.message || getContentProtectionMessage(input.type);
    setNotice(message);

    const key = `${input.type}:${input.mediaId || 'global'}`;
    const now = Date.now();
    if (now - (lastLogAt.current[key] || 0) < 2500) return;
    lastLogAt.current[key] = now;
    void getCurrentAccessToken()
      .catch(() => null)
      .then((token) => fetch('/api/content-protection/log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        keepalive: true,
        body: JSON.stringify({
          type: input.type,
          scope,
          mediaId: input.mediaId || null,
          eventName: input.eventName || null,
          path: window.location.pathname,
          metadata: input.metadata || {},
          occurredAt: new Date().toISOString(),
        }),
      }))
      .catch((error) => {
        console.warn('Não foi possível registrar tentativa de proteção de conteúdo:', error);
      });
  }, [enabled, scope]);

  React.useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isBlockedShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      reportAttempt({
        type: getShortcutAttempt(event),
        metadata: {
          key: event.key,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
        },
      });
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [enabled, reportAttempt]);

  React.useEffect(() => {
    if (!enabled) return;
    if (!shouldRunDevtoolsDetection()) {
      setDevtoolsOpen(false);
      devtoolsWasOpen.current = false;
      return;
    }

    const interval = window.setInterval(() => {
      if (!shouldRunDevtoolsDetection()) {
        setDevtoolsOpen(false);
        devtoolsWasOpen.current = false;
        return;
      }
      const widthGap = Math.abs(window.outerWidth - window.innerWidth);
      const heightGap = Math.abs(window.outerHeight - window.innerHeight);
      const opened = widthGap > 260 || heightGap > 260;
      setDevtoolsOpen(opened);

      if (opened && !devtoolsWasOpen.current) {
        devtoolsWasOpen.current = true;
        reportAttempt({
          type: 'devtools_open',
          metadata: { widthGap, heightGap },
        });
      }

      if (!opened) {
        devtoolsWasOpen.current = false;
      }
    }, 900);

    return () => window.clearInterval(interval);
  }, [enabled, reportAttempt]);

  return {
    notice,
    devtoolsOpen,
    reportAttempt,
    clearNotice: () => setNotice(null),
  };
}
