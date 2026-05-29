import { Search } from 'lucide-react';
import React, { FormEvent } from 'react';

interface HeroProps {
  eventQuery: string;
  onEventQueryChange: (query: string) => void;
}

export function Hero({
  eventQuery,
  onEventQueryChange,
}: HeroProps) {
  const handleEventSubmit = (event: FormEvent) => {
    event.preventDefault();
  };

  return (
    <section className="relative overflow-hidden bg-brutal-white border-b-4 border-brutal-black">
      <div className="absolute top-0 w-full overflow-hidden bg-brutal-accent text-brutal-black py-2 border-b-2 border-brutal-black z-0 flex whitespace-nowrap">
        <div className="animate-marquee flex items-center">
          {Array(15).fill('ENCONTRE SEU RITMO - MEMÓRIAS EM MOVIMENTO ').map((text, i) => (
            <span key={i} className="font-display text-lg px-8 shrink-0 tracking-wider">
              {text}
            </span>
          ))}
        </div>
        <div className="animate-marquee flex items-center">
          {Array(15).fill('ENCONTRE SEU RITMO - MEMÓRIAS EM MOVIMENTO ').map((text, i) => (
            <span key={i} className="font-display text-lg px-8 shrink-0 tracking-wider">
              {text}
            </span>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 pt-20 pb-20 relative z-10 flex flex-col items-center text-center">
        <span className="font-mono text-[10px] md:text-sm tracking-widest text-brutal-accent mb-4 block uppercase bg-brutal-black px-3 py-1 brutal-border">
          O Marketplace do Corredor
        </span>

        <h1 className="text-[12vw] md:text-[90px] lg:text-[110px] leading-[0.8] md:leading-[0.85] mb-8 relative">
          <span className="block">LEVE, JUNTO</span>
          <span className="block text-brutal-accent" style={{ WebkitTextStroke: '1px #050505' }}>E FUN</span>
        </h1>

        <p className="max-w-xl font-mono text-sm md:text-lg mb-12 text-gray-700">
          Encontre o evento e acesse suas fotos em uma cobertura organizada.
        </p>

        <div className="w-full max-w-2xl bg-brutal-white p-4 md:p-6 brutal-border brutal-shadow flex flex-col gap-4">
          <form onSubmit={handleEventSubmit} className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="BUSCAR EVENTO..."
                value={eventQuery}
                onChange={(event) => onEventQueryChange(event.target.value)}
                className="w-full h-14 pl-12 pr-4 bg-gray-100 brutal-border font-mono text-base md:text-lg focus:outline-none focus:ring-0 focus:bg-white transition-colors uppercase placeholder:text-gray-400 placeholder:normal-case placeholder:font-mono"
              />
            </div>
            <button
              type="submit"
              className="h-14 px-8 bg-brutal-black text-brutal-white brutal-border font-display text-lg hover:bg-brutal-accent hover:text-brutal-white transition-colors brutal-shadow-hover flex items-center justify-center sm:min-w-35"
            >
              BUSCAR
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
