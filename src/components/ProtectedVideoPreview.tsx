import React from 'react';
import { Loader2, Play, Video } from 'lucide-react';
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
  const [generatedPoster, setGeneratedPoster] = React.useState('');
  const safePoster = poster || generatedPoster;
  const hasPoster = Boolean(safePoster);

  React.useEffect(() => {
    setCanPreview(Boolean(src));
    setIsActive(false);
    setIsLoading(false);
    setGeneratedPoster('');
  }, [poster, src]);

  React.useEffect(() => {
    if (poster || !src) return;

    let cancelled = false;
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = src;

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
    };

    const captureFrame = () => {
      if (cancelled || !video.videoWidth || !video.videoHeight) return;

      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        setGeneratedPoster(canvas.toDataURL('image/jpeg', 0.82));
      } catch {
        setGeneratedPoster('');
      } finally {
        cleanup();
      }
    };

    video.onloadedmetadata = () => {
      const targetTime = Number.isFinite(video.duration)
        ? Math.min(Math.max(0.5, video.duration > 3 ? 2 : video.duration * 0.35), Math.max(0.5, video.duration - 0.1))
        : 0.5;

      try {
        video.currentTime = targetTime;
      } catch {
        captureFrame();
      }
    };
    video.onseeked = captureFrame;
    video.onloadeddata = () => {
      if (!video.duration || video.currentTime > 0) captureFrame();
    };
    video.onerror = cleanup;

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [poster, src]);

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
      src={safePoster || null}
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
          poster={safePoster || undefined}
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

      {!hasPoster && !isActive && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_35%,rgba(255,78,0,0.28),transparent_34%),linear-gradient(135deg,#111827,#050505_55%,#1f2937)] text-white">
          <div className="mb-3 grid h-16 w-16 place-items-center rounded-full border border-white/20 bg-white/10 backdrop-blur-sm">
            <Video className="h-8 w-8 text-brutal-accent" />
          </div>
          <span className="font-display text-lg uppercase tracking-normal">Preview do vídeo</span>
          <span className="mt-1 font-mono text-[9px] uppercase tracking-widest text-white/55">Funpace Media</span>
        </div>
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
        <span className="inline-flex items-center gap-2 bg-brutal-black/75 px-3 py-2 text-white backdrop-blur-sm brutal-border-thin font-mono text-[10px] uppercase transition-transform duration-300 hover:scale-105">
          {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 fill-current" />}
          {canPreview ? 'Preview 4s' : 'Preview do vídeo'}
        </span>
      </button>
    </ProtectedMedia>
  );
}
