import React from 'react';
import { Image as ImageIcon, Video } from 'lucide-react';

type ProtectedMediaType = 'IMG' | 'VIDEO' | 'VIEW';

interface ProtectedMediaProps {
  src?: string | null;
  alt: string;
  type?: ProtectedMediaType;
  watermark?: string;
  className?: string;
  imgClassName?: string;
  loading?: 'eager' | 'lazy';
  decoding?: 'async' | 'auto' | 'sync';
  sizes?: string;
  onError?: React.ReactEventHandler<HTMLImageElement>;
  children?: React.ReactNode;
}

function preventDefault(event: React.SyntheticEvent) {
  event.preventDefault();
}

export function ProtectedMedia({
  src,
  alt,
  type = 'IMG',
  watermark = 'FUNPACE',
  className = '',
  imgClassName = 'w-full h-full object-cover',
  loading,
  decoding,
  sizes,
  onError,
  children,
}: ProtectedMediaProps) {
  const mark = watermark.trim() || 'FUNPACE';

  return (
    <div
      className={`protected-media relative h-full w-full overflow-hidden select-none ${className}`}
      onContextMenu={preventDefault}
      onDragStart={preventDefault}
      onCopy={preventDefault}
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
          className={`protected-media__asset pointer-events-none ${imgClassName}`}
        />
      ) : (
        <div className="protected-media__asset flex h-full w-full items-center justify-center bg-brutal-black text-white">
          {type === 'VIDEO' ? <Video className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />}
        </div>
      )}

      {children}

      <div className="protected-media__watermark pointer-events-none absolute inset-0">
        {Array.from({ length: 6 }).map((_, row) => (
          <div key={row} className="protected-media__watermark-row">
            {Array.from({ length: 4 }).map((__, col) => (
              <span key={`${row}-${col}`}>{mark}</span>
            ))}
          </div>
        ))}
      </div>

      <div className="protected-media__print-warning hidden">
        Midia protegida. Use o download autorizado apos a compra.
      </div>
    </div>
  );
}
