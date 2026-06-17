import { motion } from 'motion/react';
import { Photographer, Product } from '../types';
import { ArrowLeft, Star, Camera, Calendar, Award, Share2 } from 'lucide-react';
import { PhotoGrid } from './PhotoGrid';

interface PhotographerProfileProps {
  photographer: Photographer;
  photos: Product[];
  onBack: () => void;
  onAddToCart: (product: Product) => void;
  cartItems: Product[];
}

export function PhotographerProfile({ photographer, photos, onBack, onAddToCart, cartItems }: PhotographerProfileProps) {
  return (
    <div className="bg-brutal-white min-h-screen">
      {/* Header / Cover */}
      <div className="relative h-[40vh] bg-brutal-black overflow-hidden border-b-4 border-brutal-black">
        <div className="absolute inset-0 opacity-40">
          <img
            src={photos[0]?.url}
            alt="Cover"
            className="w-full h-full object-cover blur-sm"
          />
        </div>
        <div className="absolute inset-0 bg-linear-to-t from-brutal-black to-transparent" />

        <div className="absolute bottom-0 left-0 w-full p-6 md:p-12">
          <motion.button
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={onBack}
            className="premium-button mb-8 flex items-center gap-2 text-white font-mono text-sm uppercase hover:text-brutal-accent transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para a Galeria
          </motion.button>

          <div className="flex flex-col md:flex-row gap-8 items-start md:items-end">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-32 h-32 md:w-48 md:h-48 brutal-border border-white overflow-hidden bg-white shadow-2xl"
            >
              <img src={photographer.avatar} alt={photographer.name} className="w-full h-full object-cover" />
            </motion.div>

            <div className="flex-1">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="flex items-center gap-3 mb-2"
              >
                <div className="flex text-brutal-accent">
                  {Array(5).fill(0).map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-current" />
                  ))}
                </div>
                <span className="text-white/60 font-mono text-xs uppercase tracking-widest">{photographer.stats.rating} Score</span>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="font-display text-5xl md:text-8xl text-white tracking-tighter"
              >
                {photographer.name}
              </motion.h1>
            </div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 }}
              className="flex gap-4"
            >
              <button className="premium-button bg-white text-brutal-black p-4 brutal-border hover:bg-brutal-accent hover:text-white transition-colors cursor-pointer">
                <Share2 className="w-6 h-6" />
              </button>
              <button className="premium-button bg-brutal-accent text-white px-8 py-4 brutal-border font-display text-sm uppercase tracking-widest transition-all cursor-pointer">
                Seguir Artista
              </button>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Stats and Bio */}
      <div className="max-w-350 mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 text-brutal-black">
          <div className="lg:col-span-2 space-y-8">
            <div>
              <h2 className="font-display text-2xl uppercase mb-4 flex items-center gap-2">
                <Award className="w-6 h-6 text-brutal-accent" />
                Sobre o Fotógrafo
              </h2>
              <p className="font-mono text-lg leading-relaxed text-gray-600">
                {photographer.bio}
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              <div className="premium-card bg-white p-6 brutal-border">
                <Camera className="w-6 h-6 text-brutal-accent mb-2" />
                <p className="font-mono text-[10px] text-gray-400 uppercase tracking-widest">Fotos</p>
                <p className="font-display text-3xl">{photographer.stats.photos}</p>
              </div>
              <div className="premium-card bg-white p-6 brutal-border">
                <Calendar className="w-6 h-6 text-brutal-accent mb-2" />
                <p className="font-mono text-[10px] text-gray-400 uppercase tracking-widest">Eventos</p>
                <p className="font-display text-3xl">{photographer.stats.events}</p>
              </div>
              <div className="premium-card hidden md:block bg-white p-6 brutal-border">
                <Award className="w-6 h-6 text-brutal-accent mb-2" />
                <p className="font-mono text-[10px] text-gray-400 uppercase tracking-widest">Anos</p>
                <p className="font-display text-3xl">8+</p>
              </div>
            </div>
          </div>

          <div className="bg-brutal-accent text-white p-8 brutal-border brutal-shadow">
            <h3 className="font-display text-2xl mb-4">CONTRATE O ARTISTA</h3>
            <p className="font-mono text-sm mb-6">
              Deseja fotos exclusivas para seu evento ou ensaio pessoal? Nossa rede de fotógrafos está disponível para projetos customizados.
            </p>
            <button className="premium-button w-full bg-brutal-black text-white py-4 brutal-border font-mono text-xs font-bold uppercase hover:bg-white hover:text-brutal-black transition-colors cursor-pointer">
              Solicitar Orçamento
            </button>
          </div>
        </div>
      </div>

      {/* Photographer's Photos */}
      <div className="border-t-4 border-brutal-black mt-12 pt-12">
        <PhotoGrid
          title="GALERIA DO ARTISTA"
          subtitle={`Explorando ${photos.length} capturas selecionadas de ${photographer.name}`}
          photos={photos}
          onAddToCart={onAddToCart}
          cartItems={cartItems}
        />
      </div>
    </div>
  );
}
