import { CalendarDays, Camera, Image as ImageIcon, MapPin, Search, UserCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import React, { FormEvent } from 'react';
import type { Photographer, Product } from '../types';

export interface HeroPhotographerResult {
  photographer: Photographer;
  eventCount: number;
  photoCount: number;
}

export interface HeroEventResult {
  name: string;
  city: string;
  photoCount: number;
}

export interface HeroSearchResults {
  photographers: HeroPhotographerResult[];
  events: HeroEventResult[];
  photos: Product[];
}

interface HeroProps {
  eventQuery: string;
  onEventQueryChange: (query: string) => void;
  searchResults: HeroSearchResults;
  isSearching?: boolean;
  onSelectPhotographer: (photographer: Photographer) => void;
  onSelectEvent: (eventName: string) => void;
  onSelectPhoto: (product: Product) => void;
}

const heroTickerText = 'ENCONTRE SEU RITMO - MEMORIAS EM MOVIMENTO - 5+ FOTOS = 15% OFF AUTOMATICO ';

export function Hero({
  eventQuery,
  onEventQueryChange,
  searchResults,
  isSearching,
  onSelectPhotographer,
  onSelectEvent,
  onSelectPhoto,
}: HeroProps) {
  const handleEventSubmit = (event: FormEvent) => {
    event.preventDefault();
  };
  const hasQuery = eventQuery.trim().length > 0;
  const hasResults = searchResults.photographers.length > 0 || searchResults.events.length > 0 || searchResults.photos.length > 0;

  return (
    <section className="relative overflow-hidden bg-brutal-white border-b-4 border-brutal-black">
      <div className="absolute top-0 w-full overflow-hidden bg-brutal-accent text-brutal-black py-2 border-b-2 border-brutal-black z-0 flex whitespace-nowrap opacity-95">
        <div className="animate-marquee flex items-center">
          {Array(15).fill(heroTickerText).map((text, i) => (
            <span key={i} className="font-display text-lg px-8 shrink-0 tracking-wider">
              {text}
            </span>
          ))}
        </div>
        <div className="animate-marquee flex items-center">
          {Array(15).fill(heroTickerText).map((text, i) => (
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
                placeholder="Buscar fotógrafo, evento, cidade ou número de peito"
                value={eventQuery}
                onChange={(event) => onEventQueryChange(event.target.value)}
                className="premium-input w-full h-14 pl-12 pr-4 bg-gray-100 brutal-border font-mono text-base md:text-lg focus:outline-none focus:ring-0 focus:bg-white uppercase placeholder:text-gray-400 placeholder:normal-case placeholder:font-mono"
              />
            </div>
            <button
              type="submit"
              className="premium-button h-14 px-8 bg-brutal-black text-brutal-white brutal-border font-display text-lg hover:bg-brutal-accent hover:text-brutal-white transition-colors flex items-center justify-center sm:min-w-35"
            >
              BUSCAR
            </button>
          </form>
          <AnimatePresence>
          {hasQuery && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="bg-white brutal-border text-left"
            >
              {isSearching ? (
                <p className="p-4 font-mono text-xs uppercase tracking-widest text-gray-400">Buscando...</p>
              ) : hasResults ? (
                <div className="grid gap-4 p-3 sm:p-4">
                  {searchResults.photographers.length > 0 && (
                    <SearchGroup title="Fotógrafos">
                      {searchResults.photographers.map(({ photographer, eventCount, photoCount }) => {
                        const displayName = photographer.displayName || photographer.name;
                        const profilePhoto = photographer.profilePhoto || photographer.avatar;
                        return (
                          <button
                            key={photographer.id}
                            type="button"
                            onClick={() => onSelectPhotographer(photographer)}
                            className="premium-button flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-gray-100"
                          >
                            <div className="h-12 w-12 shrink-0 overflow-hidden brutal-border bg-gray-100">
                              {profilePhoto ? (
                                <img src={profilePhoto} alt={displayName} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center">
                                  <UserCircle className="h-7 w-7 text-gray-300" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-display text-lg uppercase leading-none">{displayName}</p>
                              <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-widest text-gray-500">
                                @{photographer.username || photographer.slug || displayName} - {eventCount} eventos - {photoCount} fotos
                              </p>
                            </div>
                            <span className="hidden font-display text-xs uppercase text-brutal-accent sm:block">Perfil</span>
                          </button>
                        );
                      })}
                    </SearchGroup>
                  )}

                  {searchResults.events.length > 0 && (
                    <SearchGroup title="Eventos">
                      {searchResults.events.map((event) => (
                        <button
                          key={event.name}
                          type="button"
                          onClick={() => onSelectEvent(event.name)}
                          className="premium-button flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-gray-100"
                        >
                          <CalendarDays className="h-5 w-5 shrink-0 text-brutal-accent" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-display text-lg uppercase leading-none">{event.name}</p>
                            <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-widest text-gray-500">{event.city || 'Local a confirmar'} - {event.photoCount} fotos</p>
                          </div>
                        </button>
                      ))}
                    </SearchGroup>
                  )}

                  {searchResults.photos.length > 0 && (
                    <SearchGroup title="Fotos">
                      {searchResults.photos.map((photo) => (
                        <button
                          key={photo.id}
                          type="button"
                          onClick={() => onSelectPhoto(photo)}
                          className="premium-button flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-gray-100"
                        >
                          <div className="h-12 w-12 shrink-0 overflow-hidden brutal-border bg-gray-100">
                            {photo.thumbnailUrl || photo.url ? (
                              <img src={photo.thumbnailUrl || photo.url} alt={photo.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <ImageIcon className="h-6 w-6 text-gray-300" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-display text-base uppercase leading-none">{photo.name}</p>
                            <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-widest text-gray-500">
                              {photo.bib ? `Peito ${photo.bib} - ` : ''}{photo.event}
                            </p>
                          </div>
                          <Camera className="hidden h-4 w-4 text-brutal-accent sm:block" />
                        </button>
                      ))}
                    </SearchGroup>
                  )}
                </div>
              ) : (
                <p className="p-4 font-mono text-xs uppercase tracking-widest text-gray-400">Nenhum resultado encontrado.</p>
              )}
            </motion.div>
          )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

function SearchGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-gray-500">
        <MapPin className="h-3 w-3 text-brutal-accent" />
        {title}
      </p>
      <div className="divide-y divide-gray-100">{children}</div>
    </div>
  );
}

