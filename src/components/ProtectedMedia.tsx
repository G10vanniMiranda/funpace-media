import React from 'react';
import { Image as ImageIcon, Video } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ContentProtectionAttempt, getContentProtectionMessage } from '../hooks/useContentProtection';

type ProtectedMediaType = 'IMG' | 'VIDEO' | 'VIEW';

interface ProtectedMediaProps {
  src?: string | null;
  alt: string;
  type?: ProtectedMediaType;
  watermark?: string;
  mediaId?: string | null;
  eventName?: string | null;
  blurPreview?: boolean;
  className?: string;
  imgClassName?: string;
  loading?: 'eager' | 'lazy';
  decoding?: 'async' | 'auto' | 'sync';
  sizes?: string;
  onError?: React.ReactEventHandler<HTMLImageElement>;
  onProtectionAttempt?: (input: {
    type: ContentProtectionAttempt;
    message?: string;
    mediaId?: string | null;
    eventName?: string | null;
    metadata?: Record<string, unknown>;
  }) => void;
  children?: React.ReactNode;
}

function maskEmail(email?: string | null) {
  if (!email || !email.includes('@')) return null;
  const [local, domain] = email.split('@');
  const prefix = local.slice(0, Math.min(2, local.length));
  return `${prefix || 'u'}***@${domain}`;
}

export function ProtectedMedia({
  src,
  alt,
  type = 'IMG',
  watermark = 'FUNPACE',
  mediaId,
  eventName,
  blurPreview = true,
  className = '',
  imgClassName = 'w-full h-full object-cover',
  loading,
  decoding,
  sizes,
  onError,
  onProtectionAttempt,
  children,
}: ProtectedMediaProps) {
  const { user } = useAuth();
  const mark = watermark.trim() || 'FUNPACE';
  const userEmail = maskEmail(user?.email);
  const userId = user?.id || user?.uid || '';
  const viewedAt = React.useMemo(() => {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
  }, []);
  const watermarkLines = [
    'FUNPACE.MEDIA',
    'PRÉVIA NÃO LICENCIADA',
    mediaId ? `FOTO ${mediaId.slice(0, 10)}` : mark,
    eventName ? eventName.slice(0, 42) : null,
    userEmail ? `USUARIO ${userEmail}` : null,
    userId ? `ID ${userId.slice(0, 8)}` : null,
    `VIEW ${viewedAt}`,
  ].filter(Boolean);
  const watermarkText = watermarkLines.join('  /  ');
  const handleProtectionEvent = React.useCallback((type: ContentProtectionAttempt, event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onProtectionAttempt?.({
      type,
      message: getContentProtectionMessage(type),
      mediaId,
      eventName,
      metadata: { mediaType: type === 'context_menu' ? 'right_click' : type },
    });
  }, [eventName, mediaId, onProtectionAttempt]);

  return (
    <div
      className={`protected-media relative h-full w-full overflow-hidden select-none ${className}`}
      onContextMenu={(event) => handleProtectionEvent('context_menu', event)}
      onDragStart={(event) => handleProtectionEvent('dragstart', event)}
      onCopy={(event) => handleProtectionEvent('copy', event)}
      style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } as React.CSSProperties}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          draggable={false}
          loading={loading}
          decoding={decoding}
          sizes={sizes}
          onError={onError}
          className={`protected-media__asset ${blurPreview ? 'protected-media__asset--preview' : ''} pointer-events-none ${imgClassName}`}
        />
      ) : (
        <div className="protected-media__asset flex h-full w-full items-center justify-center bg-brutal-black text-white">
          {type === 'VIDEO' ? <Video className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />}
        </div>
      )}

      <div
        aria-hidden="true"
        className="protected-media__shield pointer-events-auto absolute inset-0"
        onContextMenu={(event) => handleProtectionEvent('context_menu', event)}
        onDragStart={(event) => handleProtectionEvent('dragstart', event)}
      />

      {children}

      <div className="protected-media__watermark pointer-events-none absolute inset-0">
        {Array.from({ length: 9 }).map((_, row) => (
          <div key={row} className="protected-media__watermark-row">
            {Array.from({ length: 3 }).map((__, col) => (
              <span key={`${row}-${col}`}>{watermarkText}</span>
            ))}
          </div>
        ))}
      </div>

      <div className="protected-media__watermark-center pointer-events-none absolute inset-0 flex items-center justify-center">
        <span>
          FUNPACE.MEDIA
          <strong>PRÉVIA NÃO LICENCIADA</strong>
          {mediaId ? <em>ID {mediaId.slice(0, 10)}</em> : null}
        </span>
      </div>

      <div className="protected-media__print-warning hidden">
        Mídia protegida. Use o download autorizado após a compra.
      </div>
    </div>
  );
}
