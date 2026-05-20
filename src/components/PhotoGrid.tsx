import { ShoppingCart, Plus, Check } from 'lucide-react';
import { useState } from 'react';
import { Product } from '../types';

interface PhotoGridProps {
  title: string;
  subtitle: string;
  photos: Product[];
  onAddToCart: (photo: Product) => void;
  cartItems: Product[];
  activeView?: 'photos' | 'videos';
  onViewChange?: (view: 'photos' | 'videos') => void;
}

export function PhotoGrid({ 
  title, 
  subtitle, 
  photos, 
  onAddToCart, 
  cartItems, 
  activeView, 
  onViewChange 
}: PhotoGridProps) {
  const isInCart = (id: string) => cartItems.some(item => item.id === id);

  return (
    <section className="py-12 md:py-20 px-4 md:px-6 max-w-[1400px] mx-auto">
      <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="max-w-2xl">
          <h2 className="text-4xl md:text-6xl mb-2">{title}</h2>
          <p className="font-mono text-xs md:text-sm text-gray-600 uppercase tracking-widest">{subtitle}</p>
        </div>
        
        {activeView && onViewChange && (
          <div className="flex gap-2">
            <button 
              onClick={() => onViewChange('photos')}
              className={`flex-1 md:flex-none px-6 py-3 font-mono text-sm uppercase brutal-border transition-colors cursor-pointer ${
                activeView === 'photos' 
                  ? 'bg-brutal-black text-white' 
                  : 'bg-brutal-white text-brutal-black hover:bg-gray-100'
              }`}
            >
              Fotos
            </button>
            <button 
              onClick={() => onViewChange('videos')}
              className={`flex-1 md:flex-none px-6 py-3 font-mono text-sm uppercase brutal-border transition-colors cursor-pointer ${
                activeView === 'videos' 
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
        {photos.map(photo => (
          <div key={photo.id} className="group relative">
            <div className="aspect-[3/4] bg-gray-200 brutal-border overflow-hidden relative brutal-shadow transition-transform duration-300">
              <img 
                src={photo.url} 
                alt={photo.id} 
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
              />
              
              {/* Fake Watermark */}
              <div className="absolute inset-0 flex flex-col items-center justify-center opacity-30 pointer-events-none rotate-[-30deg]">
                {Array(5).fill('FUNPACE').map((text, i) => (
                  <span key={i} className="font-display text-4xl whitespace-nowrap text-white outline-text tracking-widest my-8">
                    {text}
                  </span>
                ))}
              </div>

              {/* Badges */}
              <div className="absolute top-4 left-4 flex gap-2">
                <span className="bg-brutal-white text-brutal-black px-2 py-1 font-mono text-xs font-bold brutal-border">
                  PEITO {photo.bib}
                </span>
                <span className="bg-brutal-accent text-brutal-white px-2 py-1 font-mono text-xs font-bold brutal-border">
                  R$ {photo.price.toFixed(2).replace('.', ',')}
                </span>
              </div>

              {/* Hover Actions */}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center pointer-events-none">
                <button 
                  onClick={() => onAddToCart(photo)}
                  disabled={isInCart(photo.id)}
                  className={`pointer-events-auto flex items-center gap-2 px-6 py-3 font-display uppercase tracking-widest transition-all brutal-shadow-hover ${
                    isInCart(photo.id) 
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
            <div className="mt-4 flex justify-between items-start font-mono text-sm uppercase">
              <div>
                <p className="font-bold">{photo.event}</p>
                <p className="text-gray-500">Ponto: {photo.checkpoint}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
