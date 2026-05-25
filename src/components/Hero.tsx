import { Search, Image as ImageIcon, Loader2 } from 'lucide-react';
import React, { useState, FormEvent, useRef } from 'react';

interface HeroProps {
  onSearch: (bib: string) => void;
  onSelfieSearch: (file: File) => void;
}

export function Hero({ onSearch, onSelfieSearch }: HeroProps) {
  const [bib, setBib] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (bib.trim()) {
      onSearch(bib.trim());
    }
  };

  const handleSelfieClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onSelfieSearch(file);
    }
  };

  return (
    <section className="relative overflow-hidden bg-brutal-white border-b-4 border-brutal-black">
      {/* Marquee Background Top */}
      <div className="absolute top-0 w-full overflow-hidden bg-brutal-accent text-brutal-black py-2 border-b-2 border-brutal-black z-0 flex whitespace-nowrap">
        <div className="animate-marquee flex items-center">
          {Array(15).fill('ENCONTRE SEU RITMO • MEMÓRIAS EM MOVIMENTO • ULTRAPASSE • ').map((text, i) => (
            <span key={i} className="font-display text-lg px-8 flex-shrink-0 tracking-wider">
              {text}
            </span>
          ))}
        </div>
        <div className="animate-marquee flex items-center">
          {Array(15).fill('ENCONTRE SEU RITMO • MEMÓRIAS EM MOVIMENTO • ULTRAPASSE • ').map((text, i) => (
            <span key={i} className="font-display text-lg px-8 flex-shrink-0 tracking-wider">
              {text}
            </span>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 pt-24 pb-20 relative z-10 flex flex-col items-center text-center">
        <span className="font-mono text-[10px] md:text-sm tracking-widest text-brutal-accent mb-4 block uppercase bg-brutal-black px-3 py-1 text-white brutal-border">
          O Marketplace do Corredor
        </span>
        
        <h1 className="text-[12vw] md:text-[90px] lg:text-[110px] leading-[0.8] md:leading-[0.85] mb-8 relative">
          <span className="block">LEVE, JUNTO</span>
          <span className="block text-brutal-accent" style={{ WebkitTextStroke: '1px #050505' }}>E FUN</span>
        </h1>
        
        <p className="max-w-xl font-mono text-sm md:text-lg mb-12 text-gray-700">
          Fotografia profissional de corrida. Encontre suas fotos pelo número de peito.
        </p>

        {/* Search Box */}
        <div className="w-full max-w-2xl bg-brutal-white p-4 md:p-6 brutal-border brutal-shadow flex flex-col gap-4">
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input 
                type="text" 
                placeholder="NÚMERO DE PEITO..."
                value={bib}
                onChange={(e) => setBib(e.target.value)}
                className="w-full h-14 pl-12 pr-4 bg-gray-100 brutal-border font-mono text-base md:text-lg focus:outline-none focus:ring-0 focus:bg-white transition-colors uppercase placeholder:text-gray-400 placeholder:normal-case placeholder:font-mono"
              />
            </div>
            <button 
              type="submit"
              className="h-14 px-8 bg-brutal-black text-brutal-white brutal-border font-display text-lg hover:bg-brutal-accent hover:text-brutal-white transition-colors brutal-shadow-hover flex items-center justify-center sm:min-w-[140px]"
            >
              BUSCAR
            </button>
          </form>
          
          <div className="flex items-center justify-center gap-4">
            <div className="h-[1px] flex-1 bg-gray-200 block md:hidden"></div>
            <div className="font-mono text-xs md:text-sm text-gray-400 uppercase tracking-widest">OU</div>
            <div className="h-[1px] flex-1 bg-gray-200 block md:hidden"></div>
          </div>
          
          <button 
            type="button"
            onClick={handleSelfieClick}
            className="h-14 px-6 bg-brutal-white text-brutal-black brutal-border hover:bg-gray-100 transition-colors flex items-center justify-center gap-2 brutal-shadow-hover whitespace-nowrap group cursor-pointer"
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              accept="image/*" 
              className="hidden" 
            />
            <ImageIcon className="w-5 h-5 group-hover:text-brutal-accent transition-colors" />
            <span className="font-mono text-sm font-bold mt-0.5">ENVIAR SELFIE</span>
          </button>
        </div>
      </div>
    </section>
  );
}
