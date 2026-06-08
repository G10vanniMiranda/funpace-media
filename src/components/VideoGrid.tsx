import React from 'react';
import { Play, ShoppingCart, Check, Clock, MapPin, Heart, Share2, Video } from 'lucide-react';
import { motion } from 'motion/react';
import { Product } from '../types';
import { copyText, createProductShareUrl } from '../lib/customer-engagement';
import { ProtectedVideoPreview } from './ProtectedVideoPreview';

interface VideoGridProps {
  videos: Product[];
  onAddToCart: (video: Product) => void;
  cartItems: Product[];
  activeView?: 'photos' | 'videos';
  onViewChange?: (view: 'photos' | 'videos') => void;
  favoriteIds?: Set<string>;
  likedIds?: Set<string>;
  heartCounts?: Record<string, number>;
  onToggleFavorite?: (video: Product) => void;
  compact?: boolean;
}

export function VideoGrid({
  videos,
  onAddToCart,
  cartItems,
  activeView,
  onViewChange,
  favoriteIds = new Set(),
  likedIds = new Set(),
  heartCounts = {},
  onToggleFavorite,
  compact = false,
}: VideoGridProps) {
  const isVideoInCart = (id: string) => cartItems.some(item => item.id === id);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const shareVideo = async (video: Product) => {
    const url = createProductShareUrl(video.id);
    if (navigator.share) {
      try {
        const shareText = [video.event, video.bib ? `peito ${video.bib}` : ''].filter(Boolean).join(' - ');
        await navigator.share({ title: video.name, text: shareText, url });
        return;
      } catch {
        // Fallback to clipboard when native sharing is cancelled or unavailable.
      }
    }

    try {
      await copyText(url);
      setCopiedId(video.id);
      window.setTimeout(() => setCopiedId((current) => current === video.id ? null : current), 1800);
    } catch {
      window.prompt('Copie o link da mídia:', url);
    }
  };

  return (
    <section className={`max-w-350 mx-auto px-4 md:px-6 ${compact ? 'py-7 md:py-10' : 'py-12 md:py-20'}`}>
      <div className={`flex flex-col md:flex-row md:items-end justify-between gap-6 ${compact ? 'mb-7' : 'mb-12'}`}>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-12 h-0.5 bg-brutal-accent"></div>
            <h2 className="font-mono text-sm uppercase tracking-[0.3em] text-brutal-accent font-bold">REPLAY DA EMOÇÃO</h2>
          </div>
          <h3 className="font-display text-5xl md:text-7xl tracking-tighter uppercase leading-none">VÍDEOS EM 4K</h3>
          <p className="font-mono text-xs text-gray-500 uppercase tracking-widest max-w-md">
            Sua jornada em movimento. Vídeos editados e prontos para suas redes sociais.
          </p>
        </div>

        {activeView && onViewChange && (
          <div className="flex gap-2">
            <button
              onClick={() => onViewChange('photos')}
              className={`px-6 py-3 font-mono text-sm uppercase brutal-border transition-colors cursor-pointer ${activeView === 'photos'
                  ? 'bg-brutal-black text-white'
                  : 'bg-brutal-white text-brutal-black hover:bg-gray-100'
                }`}
            >
              Fotos
            </button>
            <button
              onClick={() => onViewChange('videos')}
              className={`px-6 py-3 font-mono text-sm uppercase brutal-border transition-colors cursor-pointer ${activeView === 'videos'
                  ? 'bg-brutal-black text-white'
                  : 'bg-brutal-white text-brutal-black hover:bg-gray-100'
                }`}
            >
              Vídeos
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {videos.map((video) => (
          <motion.div
            key={video.id}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="group relative bg-white brutal-border brutal-shadow hover:-translate-x-1 hover:-translate-y-1 hover:shadow-heavy transition-all"
          >
            <div className="relative aspect-video overflow-hidden bg-brutal-black">
              <ProtectedVideoPreview
                src={video.url}
                poster={video.thumbnailUrl || video.watermarkUrl}
                alt={video.name}
                watermark={`FUNPACE ${video.bib || video.id.slice(0, 6)}`}
                imgClassName="w-full h-full object-cover opacity-85 transition-transform duration-500 group-hover:scale-[1.04]"
              />

              <div className="absolute inset-0 bg-linear-to-t from-brutal-black/80 via-transparent to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />

              {/* Video Badge */}
              <div className="absolute top-4 left-4 bg-brutal-accent text-white px-3 py-1 brutal-border font-mono text-[10px] uppercase font-bold tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                VÍDEO
              </div>

              <div className="absolute top-4 right-4 z-10 flex gap-2">
                <button
                  type="button"
                  onClick={() => onToggleFavorite?.(video)}
                  className={`h-10 min-w-10 px-3 brutal-border flex items-center justify-center gap-1 transition-colors cursor-pointer ${favoriteIds.has(video.id) || likedIds.has(video.id) ? 'bg-brutal-accent text-white' : 'bg-white text-brutal-black hover:bg-brutal-accent hover:text-white'
                    }`}
                  title={favoriteIds.has(video.id) ? 'Remover dos favoritos' : 'Favoritar para comprar depois'}
                  aria-label={favoriteIds.has(video.id) ? 'Remover dos favoritos' : 'Favoritar para comprar depois'}
                >
                  <Heart className={`w-4 h-4 ${favoriteIds.has(video.id) || likedIds.has(video.id) ? 'fill-current' : ''}`} />
                  {Number(heartCounts[video.id] || video.favoriteCount || 0) > 0 && (
                    <span className="font-mono text-[10px] font-bold leading-none">
                      {Number(heartCounts[video.id] || video.favoriteCount || 0)}
                    </span>
                  )}
                </button>
              </div>

              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center group/play"
              >
                <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-md brutal-border flex items-center justify-center transform group-hover/play:scale-110 group-hover:opacity-0 transition-all">
                  <Play className="w-8 h-8 text-white fill-white ml-1" />
                </div>
              </div>

              {/* Duration */}
              <div className="absolute bottom-4 right-4 font-mono text-[10px] text-white bg-brutal-black/50 px-2 py-1 backdrop-blur-sm flex items-center gap-1">
                {video.duration ? <Clock className="w-3 h-3" /> : <Video className="w-3 h-3" />}
                {video.duration || 'Preview'}
              </div>
            </div>

            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h4 className="font-display text-xl uppercase leading-tight mb-1">{video.event}</h4>
                  <div className="flex items-center gap-2 text-gray-500">
                    <MapPin className="w-3 h-3" />
                    <p className="font-mono text-[10px] uppercase tracking-widest">{video.checkpoint}</p>
                  </div>
                </div>
                {video.bib && (
                <div className="text-right">
                  <p className="font-mono text-[10px] uppercase text-gray-400 mb-1">Nº PEITO</p>
                  <p className="font-display text-2xl text-brutal-accent leading-none">#{video.bib}</p>
                </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => shareVideo(video)}
                className="mb-4 inline-flex items-center gap-2 text-gray-500 hover:text-brutal-accent transition-colors cursor-pointer font-mono text-[10px] uppercase"
              >
                <Share2 className="w-4 h-4" />
                {copiedId === video.id ? 'Link copiado' : 'Compartilhar video'}
              </button>

              <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <div className="space-y-1">
                  <p className="font-mono text-[10px] text-gray-400 uppercase leading-none">Preço un.</p>
                  <p className="font-display text-2xl">R$ {video.price.toFixed(2)}</p>
                </div>

                <button
                  onClick={() => onAddToCart(video)}
                  disabled={isVideoInCart(video.id)}
                  className={`flex items-center gap-2 px-6 py-3 brutal-border font-display text-sm uppercase tracking-widest transition-all cursor-pointer ${isVideoInCart(video.id)
                      ? 'bg-brutal-white text-gray-400 cursor-default'
                      : 'bg-brutal-black text-white hover:bg-brutal-accent hover:-translate-x-1 hover:-translate-y-1'
                    }`}
                >
                  {isVideoInCart(video.id) ? (
                    <>
                      <Check className="w-4 h-4" />
                      No Carrinho
                    </>
                  ) : (
                    <>
                      <ShoppingCart className="w-4 h-4" />
                      Comprar
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {videos.length === 0 && (
        <div className="bg-white brutal-border p-12 text-center">
          <p className="font-display text-2xl uppercase text-gray-400">Nenhum vídeo encontrado para esta busca.</p>
        </div>
      )}
    </section>
  );
}
