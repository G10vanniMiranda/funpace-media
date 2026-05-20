import React from 'react';
import { Play, Pause, ShoppingCart, Check, Expand, Clock, MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Product } from '../types';

interface VideoGridProps {
  videos: Product[];
  onAddToCart: (video: Product) => void;
  cartItems: Product[];
  activeView?: 'photos' | 'videos';
  onViewChange?: (view: 'photos' | 'videos') => void;
}

export function VideoGrid({ videos, onAddToCart, cartItems, activeView, onViewChange }: VideoGridProps) {
  const isVideoInCart = (id: string) => cartItems.some(item => item.id === id);

  return (
    <section className="max-w-[1400px] mx-auto px-6 py-12 md:py-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
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
              className={`px-6 py-3 font-mono text-sm uppercase brutal-border transition-colors cursor-pointer ${
                activeView === 'photos' 
                  ? 'bg-brutal-black text-white' 
                  : 'bg-brutal-white text-brutal-black hover:bg-gray-100'
              }`}
            >
              Fotos
            </button>
            <button 
              onClick={() => onViewChange('videos')}
              className={`px-6 py-3 font-mono text-sm uppercase brutal-border transition-colors cursor-pointer ${
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
              <img
                src={video.thumbnailUrl || video.url}
                alt={video.name}
                className="w-full h-full object-cover opacity-80"
              />
              
              <div className="absolute inset-0 bg-gradient-to-t from-brutal-black/80 via-transparent to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />

              {/* Video Badge */}
              <div className="absolute top-4 left-4 bg-brutal-accent text-white px-3 py-1 brutal-border font-mono text-[10px] uppercase font-bold tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                4K UHD
              </div>

              {/* Play Button Overlay */}
              <div
                className="absolute inset-0 flex items-center justify-center group/play"
              >
                <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-md brutal-border flex items-center justify-center transform group-hover/play:scale-110 transition-transform">
                  <Play className="w-8 h-8 text-white fill-white ml-1" />
                </div>
              </div>

              {/* Duration */}
              <div className="absolute bottom-4 right-4 font-mono text-[10px] text-white bg-brutal-black/50 px-2 py-1 backdrop-blur-sm flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {video.duration}
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
                <div className="text-right">
                  <p className="font-mono text-[10px] uppercase text-gray-400 mb-1">Nº PEITO</p>
                  <p className="font-display text-2xl text-brutal-accent leading-none">#{video.bib}</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <div className="space-y-1">
                  <p className="font-mono text-[10px] text-gray-400 uppercase leading-none">Preço un.</p>
                  <p className="font-display text-2xl">R$ {video.price.toFixed(2)}</p>
                </div>
                
                <button 
                  onClick={() => onAddToCart(video)}
                  disabled={isVideoInCart(video.id)}
                  className={`flex items-center gap-2 px-6 py-3 brutal-border font-display text-sm uppercase tracking-widest transition-all cursor-pointer ${
                    isVideoInCart(video.id) 
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
