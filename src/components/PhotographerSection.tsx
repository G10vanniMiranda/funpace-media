import { motion } from 'motion/react';
import { Photographer } from '../types';
import { Star, Camera, Calendar, ArrowRight } from 'lucide-react';

interface PhotographerSectionProps {
  photographers: Photographer[];
  onSelectPhotographer: (id: string) => void;
}

export function PhotographerSection({ photographers, onSelectPhotographer }: PhotographerSectionProps) {
  return (
    <section id="photographers" className="py-24 bg-brutal-white border-b-4 border-brutal-black px-6">
      <div className="max-w-350 mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-16">
          <div className="max-w-2xl">
            <h2 className="font-display text-5xl md:text-7xl tracking-tighter mb-6">
              NOSSOS <span className="text-brutal-accent">VISUAL STORYTELLERS</span>
            </h2>
            <p className="font-mono text-lg text-gray-600">
              Conheça os profissionais que transformam seu esforço em arte eterna. Cada clique é uma história de superação.
            </p>
          </div>
          <div className="bg-brutal-black text-white p-6 brutal-border brutal-shadow flex items-center gap-4">
            <Camera className="w-8 h-8 text-brutal-accent" />
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-gray-400">Total de Fotos</p>
              <p className="font-display text-2xl">24.500+</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8">
          {photographers.map((photographer, index) => (
            <motion.div
              key={photographer.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              viewport={{ once: true }}
              onClick={() => onSelectPhotographer(photographer.id)}
              className="group bg-white brutal-border brutal-shadow-hover p-8 cursor-pointer transition-all hover:-translate-x-1 hover:-translate-y-1"
            >
              <div className="flex flex-col sm:flex-row gap-8 items-start sm:items-center">
                <div className="relative">
                  <div className="w-32 h-32 brutal-border overflow-hidden grayscale group-hover:grayscale-0 transition-all">
                    <img
                      src={photographer.avatar}
                      alt={photographer.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="absolute -bottom-4 -right-4 bg-brutal-accent text-white p-2 brutal-border">
                    <Star className="w-5 h-5 fill-current" />
                  </div>
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-[10px] uppercase bg-brutal-black text-white px-2 py-0.5">Verified Artist</span>
                    <div className="flex text-brutal-accent">
                      <Star className="w-3 h-3 fill-current" />
                      <Star className="w-3 h-3 fill-current" />
                      <Star className="w-3 h-3 fill-current" />
                      <Star className="w-3 h-3 fill-current" />
                      <Star className="w-3 h-3 fill-current" />
                    </div>
                  </div>
                  <h3 className="font-display text-3xl mb-3 group-hover:text-brutal-accent transition-colors">
                    {photographer.name}
                  </h3>
                  <p className="font-mono text-sm text-gray-500 mb-6 line-clamp-2">
                    {photographer.bio}
                  </p>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2 text-sm font-mono">
                      <Camera className="w-4 h-4 text-gray-400" />
                      <span>{photographer.stats.photos} FOTOS</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-mono">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <span>{photographer.stats.events} EVENTOS</span>
                    </div>
                  </div>
                </div>

                <div className="hidden sm:flex self-stretch items-center justify-center pl-4 border-l-2 border-dashed border-gray-100">
                  <ArrowRight className="w-8 h-8 text-gray-200 group-hover:text-brutal-accent group-hover:translate-x-2 transition-all" />
                </div>
              </div>
            </motion.div>
          ))}

          {/* Future slot placeholder */}
          <div className="bg-gray-50 brutal-border border-dashed p-8 flex flex-col items-center justify-center text-center group cursor-help">
            <div className="w-20 h-20 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center mb-4 group-hover:bg-white transition-colors">
              <Camera className="w-8 h-8 text-gray-300" />
            </div>
            <h3 className="font-display text-xl text-gray-400 mb-2 uppercase tracking-tighter">O Próximo Criador</h3>
            <p className="font-mono text-xs text-gray-400 max-w-50">
              Estamos expandindo nosso time de artistas visuais em breve.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
