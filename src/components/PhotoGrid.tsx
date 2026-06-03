import { Check, Heart, Plus, Share2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Product } from '../types';
import { copyText, createProductShareUrl } from '../lib/customer-engagement';
import { ProtectedMedia } from './ProtectedMedia';

interface PhotoGridProps {
  title: string;
  subtitle: string;
  photos: Product[];
  onAddToCart: (photo: Product) => void;
  cartItems: Product[];
  activeView?: 'photos' | 'videos';
  onViewChange?: (view: 'photos' | 'videos') => void;
  favoriteIds?: Set<string>;
  likedIds?: Set<string>;
  heartCounts?: Record<string, number>;
  onToggleFavorite?: (photo: Product) => void;
}

const initialVisiblePhotos = 48;
const visiblePhotosStep = 48;

export function PhotoGrid({
  title,
  subtitle,
  photos,
  onAddToCart,
  cartItems,
  activeView,
  onViewChange,
  favoriteIds = new Set(),
  likedIds = new Set(),
  heartCounts = {},
  onToggleFavorite,
}: PhotoGridProps) {
  const isInCart = (id: string) => cartItems.some(item => item.id === id);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(initialVisiblePhotos);
  const visiblePhotos = useMemo(() => photos.slice(0, visibleCount), [photos, visibleCount]);
  const remainingPhotos = Math.max(0, photos.length - visiblePhotos.length);

  useEffect(() => {
    setVisibleCount(initialVisiblePhotos);
  }, [photos]);

  const sharePhoto = async (photo: Product) => {
    const url = createProductShareUrl(photo.id);
    if (navigator.share) {
      try {
        const shareText = [photo.event, photo.bib ? `peito ${photo.bib}` : ''].filter(Boolean).join(' - ');
        await navigator.share({ title: photo.name, text: shareText, url });
        return;
      } catch {
        // Fallback to clipboard when native sharing is cancelled or unavailable.
      }
    }

    try {
      await copyText(url);
      setCopiedId(photo.id);
      window.setTimeout(() => setCopiedId((current) => current === photo.id ? null : current), 1800);
    } catch {
      window.prompt('Copie o link da midia:', url);
    }
  };

  return (
    <section className="py-12 md:py-20 px-4 md:px-6 max-w-350 mx-auto">
      <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="max-w-2xl">
          <h2 className="text-4xl md:text-6xl mb-2">{title}</h2>
          <p className="font-mono text-xs md:text-sm text-gray-600 uppercase tracking-widest">{subtitle}</p>
        </div>

        {activeView && onViewChange && (
          <div className="flex gap-2">
            <button
              onClick={() => onViewChange('photos')}
              className={`flex-1 md:flex-none px-6 py-3 font-mono text-sm uppercase brutal-border transition-colors cursor-pointer ${activeView === 'photos'
                  ? 'bg-brutal-black text-white'
                  : 'bg-brutal-white text-brutal-black hover:bg-gray-100'
                }`}
            >
              Fotos
            </button>
            <button
              onClick={() => onViewChange('videos')}
              className={`flex-1 md:flex-none px-6 py-3 font-mono text-sm uppercase brutal-border transition-colors cursor-pointer ${activeView === 'videos'
                  ? 'bg-brutal-black text-white'
                  : 'bg-brutal-white text-brutal-black hover:bg-gray-100'
                }`}
            >
              Vídeos
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-8">
        {visiblePhotos.map((photo, index) => (
          <div
            key={photo.id}
            className="group relative"
            style={{ contentVisibility: 'auto', containIntrinsicSize: '360px 560px' }}
          >
            <div className="aspect-3/4 bg-gray-200 brutal-border overflow-hidden relative brutal-shadow transition-transform duration-300">
              <ProtectedMedia
                src={photo.thumbnailUrl || null}
                alt={photo.id}
                type={photo.type}
                watermark={`FUNPACE ${photo.bib || photo.id.slice(0, 6)}`}
                mediaId={photo.id}
                eventName={photo.event}
                loading={index < 8 ? 'eager' : 'lazy'}
                decoding="async"
                sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                imgClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />

              {/* Badges */}
              <div className="absolute top-4 left-4 flex gap-2">
                {photo.bib && (
                  <span className="bg-brutal-white text-brutal-black px-2 py-1 font-mono text-xs font-bold brutal-border">
                    PEITO {photo.bib}
                  </span>
                )}
                <span className="bg-brutal-accent text-brutal-white px-2 py-1 font-mono text-xs font-bold brutal-border">
                  R$ {photo.price.toFixed(2).replace('.', ',')}
                </span>
              </div>

              {/* Hover Actions */}
              <div className="absolute top-4 right-4 z-10 flex gap-2">
                <button
                  type="button"
                  onClick={() => onToggleFavorite?.(photo)}
                  className={`h-10 min-w-10 px-3 brutal-border flex items-center justify-center gap-1 transition-colors cursor-pointer ${favoriteIds.has(photo.id) || likedIds.has(photo.id) ? 'bg-brutal-accent text-white' : 'bg-white text-brutal-black hover:bg-brutal-accent hover:text-white'
                    }`}
                  title={favoriteIds.has(photo.id) ? 'Remover dos favoritos' : 'Favoritar para comprar depois'}
                  aria-label={favoriteIds.has(photo.id) ? 'Remover dos favoritos' : 'Favoritar para comprar depois'}
                >
                  <Heart className={`w-4 h-4 ${favoriteIds.has(photo.id) || likedIds.has(photo.id) ? 'fill-current' : ''}`} />
                  {Number(heartCounts[photo.id] || photo.favoriteCount || 0) > 0 && (
                    <span className="font-mono text-[10px] font-bold leading-none">
                      {Number(heartCounts[photo.id] || photo.favoriteCount || 0)}
                    </span>
                  )}
                </button>
              </div>

              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center pointer-events-none">
                <button
                  onClick={() => onAddToCart(photo)}
                  disabled={isInCart(photo.id)}
                  className={`pointer-events-auto flex items-center gap-2 px-6 py-3 font-display uppercase tracking-widest transition-all brutal-shadow-hover ${isInCart(photo.id)
                      ? 'bg-green-500 text-brutal-white brutal-border cursor-not-allowed'
                      : 'bg-brutal-white text-brutal-black brutal-border hover:bg-brutal-accent hover:text-white'
                    }`}
                >
                  {isInCart(photo.id) ? (
                    <>
                      <Check className="w-5 h-5" />
                      <span>No Carrinho</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-5 h-5" />
                      <span>Comprar Foto</span>
                    </>
                  )}
                </button>
              </div>
            </div>
            <div className="mt-4 space-y-3 font-mono text-sm uppercase">
              <div className="flex justify-between items-start gap-3">
                <div className="min-w-0">
                  <p className="font-bold truncate">{photo.event}</p>
                  <p className="text-gray-500 truncate">Ponto: {photo.checkpoint}</p>
                </div>
                <button
                  type="button"
                  onClick={() => sharePhoto(photo)}
                  className="inline-flex shrink-0 items-center gap-1 text-gray-500 hover:text-brutal-accent transition-colors cursor-pointer"
                >
                  <Share2 className="w-4 h-4" />
                  <span className="text-[10px]">{copiedId === photo.id ? 'Link copiado' : 'Compartilhar'}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => onAddToCart(photo)}
                disabled={isInCart(photo.id)}
                className={`sm:hidden min-h-11 w-full brutal-border font-display text-xs uppercase tracking-widest inline-flex items-center justify-center gap-2 transition-colors ${isInCart(photo.id)
                    ? 'bg-green-500 text-white cursor-not-allowed'
                    : 'bg-brutal-black text-white hover:bg-brutal-accent cursor-pointer'
                  }`}
              >
                {isInCart(photo.id) ? (
                  <>
                    <Check className="w-4 h-4" />
                    No Carrinho
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Comprar Foto
                  </>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      {remainingPhotos > 0 && (
        <div className="mt-10 flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount((current) => current + visiblePhotosStep)}
            className="min-h-12 px-6 bg-brutal-black text-white brutal-border font-display text-sm uppercase tracking-widest hover:bg-brutal-accent transition-colors"
          >
            Carregar mais {Math.min(remainingPhotos, visiblePhotosStep)} de {remainingPhotos}
          </button>
        </div>
      )}
    </section>
  );
}
