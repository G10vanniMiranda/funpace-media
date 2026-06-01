import React from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { ProtectedMedia } from './ProtectedMedia';

interface ProtectedVideoPreviewProps {
  src?: string | null;
  poster?: string | null;
  alt: string;
  watermark: string;
  className?: string;
  imgClassName?: string;
  maxPreviewSeconds?: number;
}

export function ProtectedVideoPreview({
  src,
  poster,
  alt,
  watermark,
  className = '',
  imgClassName = 'w-full h-full object-cover',
  maxPreviewSeconds = 4,
}: ProtectedVideoPreviewProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [isActive, setIsActive] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [canPreview, setCanPreview] = React.useState(Boolean(src));
  const hasPoster = Boolean(poster);

  React.useEffect(() => {
    setCanPreview(Boolean(src));
    setIsActive(false);
    setIsLoading(false);
  }, [src]);

  const stopPreview = React.useCallback(() => {
    setIsActive(false);
    setIsLoading(false);
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
  }, []);

  const startPreview = React.useCallback(() => {
    if (!src || !canPreview) return;
    setIsActive(true);
    setIsLoading(true);

    const video = videoRef.current;
    if (!video) return;

    video.currentTime = 0;
    void video.play().catch(() => {
      setCanPreview(false);
      stopPreview();
    });
  }, [canPreview, src, stopPreview]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.currentTime >= maxPreviewSeconds) {
      video.currentTime = 0;
      void video.play().catch(() => setCanPreview(false));
    }
  };

  return (
    <ProtectedMedia
      src={poster || null}
      alt={alt}
      type="VIDEO"
      watermark={watermark}
      className={className}
      imgClassName={`${imgClassName} ${isActive && canPreview ? 'opacity-0' : ''}`}
    >
      {src && canPreview && (
        <video
          ref={videoRef}
          src={src}
          poster={poster || undefined}
          muted
          playsInline
          preload="metadata"
          controls={false}
          disablePictureInPicture
          controlsList="nodownload noplaybackrate noremoteplayback"
          draggable={false}
          onContextMenu={(event) => event.preventDefault()}
          onLoadedMetadata={() => setIsLoading(false)}
          onLoadedData={() => setIsLoading(false)}
          onCanPlay={() => setIsLoading(false)}
          onError={() => {
            setCanPreview(false);
            stopPreview();
          }}
          onTimeUpdate={handleTimeUpdate}
          className={`protected-media__asset absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-0'}`}
        />
      )}

      {!hasPoster && !isActive && canPreview && (
        <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-brutal-black/70 via-brutal-black/15 to-transparent" />
      )}

      <button
        type="button"
        onPointerEnter={startPreview}
        onPointerLeave={stopPreview}
        onFocus={startPreview}
        onBlur={stopPreview}
        onClick={() => (isActive ? stopPreview() : startPreview())}
        className="absolute inset-0 z-10 flex items-end justify-start p-4 text-left"
        aria-label="Ver preview curto do video"
      >
        <span className="inline-flex items-center gap-2 bg-brutal-black/75 px-3 py-2 text-white backdrop-blur-sm brutal-border-thin font-mono text-[10px] uppercase">
          {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
          {canPreview ? 'Preview 4s' : 'Preview indisponivel'}
        </span>
      </button>
    </ProtectedMedia>
  );
}
