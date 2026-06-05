import React from 'react';
import { CalendarDays, Camera, MapPin, Video } from 'lucide-react';
import { Event, Product } from '../types';
import { ProtectedMedia } from './ProtectedMedia';

interface EventGridProps {
  products: Product[];
  registeredEvents?: Event[];
  query: string;
  onSelectEvent: (eventName: string) => void;
}

interface MediaEvent {
  name: string;
  checkpoint: string;
  coverUrl: string | null;
  date?: string;
  createdAt?: string;
  sortTime: number;
  photos: number;
  videos: number;
  items: number;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getTimestamp(value?: string | null) {
  if (!value) return 0;
  const timestamp = new Date(value.includes('T') ? value : `${value}T12:00:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function findEventDetail(eventName: string, products: Product[], registeredEvents: Event[]) {
  const normalizedName = normalizeText(eventName);
  const matchingEvents = registeredEvents.filter((eventItem) =>
    eventItem.isPublished !== false && normalizeText(eventItem.name || '') === normalizedName,
  );
  if (matchingEvents.length <= 1) return matchingEvents[0] || null;

  const sellerIds = new Set(products.map((product) => product.vendedorId).filter(Boolean));
  const sellerEvent = matchingEvents.find((eventItem) =>
    eventItem.photographerId && sellerIds.has(eventItem.photographerId),
  );
  if (sellerEvent) return sellerEvent;

  return [...matchingEvents].sort((left, right) => {
    const leftTime = getTimestamp(left.createdAt) || getTimestamp(left.date);
    const rightTime = getTimestamp(right.createdAt) || getTimestamp(right.date);
    return rightTime - leftTime;
  })[0] || null;
}

function buildEvents(products: Product[], registeredEvents: Event[] = []) {
  const events = new Map<string, MediaEvent>();
  const productGroups = new Map<string, Product[]>();

  products.forEach((product) => {
    const name = String(product.event || 'Evento sem nome').trim();
    const key = normalizeText(name);
    const group = productGroups.get(key) ?? [];
    group.push(product);
    productGroups.set(key, group);
  });

  for (const groupProducts of productGroups.values()) {
    const name = String(groupProducts[0]?.event || 'Evento sem nome').trim();
    const eventDetail = findEventDetail(name, groupProducts, registeredEvents);
    const coverProduct = groupProducts.find((product) => product.thumbnailUrl);
    const fallbackDate = groupProducts.reduce<string | undefined>((latest, product) => {
      if (!product.createdAt) return latest;
      if (!latest) return product.createdAt;
      return product.createdAt > latest ? product.createdAt : latest;
    }, undefined);
    const fallbackSortTime = groupProducts.reduce((earliest, product) => {
      const timestamp = getTimestamp(product.createdAt);
      return timestamp && (!earliest || timestamp < earliest) ? timestamp : earliest;
    }, 0);
    const createdAt = eventDetail?.createdAt || fallbackDate;

    events.set(normalizeText(name), {
      name,
      checkpoint: eventDetail?.checkpoint || eventDetail?.location || groupProducts[0]?.checkpoint || 'Local a confirmar',
      coverUrl: eventDetail?.coverImage || coverProduct?.thumbnailUrl || null,
      date: eventDetail?.date || fallbackDate,
      createdAt,
      sortTime: getTimestamp(eventDetail?.createdAt) || fallbackSortTime,
      photos: groupProducts.filter((product) => product.type === 'IMG').length,
      videos: groupProducts.filter((product) => product.type === 'VIDEO' || product.type === 'VIEW').length,
      items: groupProducts.length,
    });
  }

  for (const eventItem of registeredEvents) {
    if (eventItem.isPublished === false) continue;

    const name = String(eventItem.name || 'Evento sem nome').trim();
    const key = normalizeText(name);
    if (events.has(key)) {
      continue;
    }

    events.set(key, {
      name,
      checkpoint: eventItem.checkpoint || eventItem.location || 'Local a confirmar',
      coverUrl: eventItem.coverImage || null,
      date: eventItem.date,
      createdAt: eventItem.createdAt,
      sortTime: getTimestamp(eventItem.createdAt) || getTimestamp(eventItem.date),
      photos: 0,
      videos: 0,
      items: 0,
    });
  }

  return Array.from(events.values()).sort((left, right) => {
    if (left.items === 0 && right.items > 0) return 1;
    if (right.items === 0 && left.items > 0) return -1;
    return right.sortTime - left.sortTime || left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' });
  });
}

export function EventGrid({ products, registeredEvents = [], query, onSelectEvent }: EventGridProps) {
  const events = React.useMemo(() => buildEvents(products, registeredEvents), [products, registeredEvents]);
  React.useEffect(() => {
    console.info('[event-cover] event-grid:covers', {
      count: events.length,
      covers: events.map((event) => ({
        name: event.name,
        coverUrl: event.coverUrl,
      })),
    });
  }, [events]);
  const filteredEvents = React.useMemo(() => {
    const normalizedQuery = normalizeText(query.trim());
    if (!normalizedQuery) return events;

    return events.filter((event) =>
      normalizeText(`${event.name} ${event.checkpoint}`).includes(normalizedQuery),
    );
  }, [events, query]);

  return (
    <section className="pt-10 pb-8 md:py-20 px-4 md:px-6 max-w-350 mx-auto">
      <div className="mb-10 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-0.5 bg-brutal-accent" />
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-brutal-accent font-bold">
              Escolha o evento
            </p>
          </div>
          <h2 className="text-4xl md:text-6xl mb-2">EVENTOS</h2>
          <p className="font-mono text-xs md:text-sm text-gray-600 uppercase tracking-widest">
            Fotos e videos organizados por cobertura
          </p>
          {query.trim() && (
            <p className="mt-3 font-mono text-xs uppercase tracking-widest text-gray-400">
              Filtrando por: {query}
            </p>
          )}
        </div>
      </div>

      {filteredEvents.length === 0 ? (
        <div className="bg-white brutal-border p-12 text-center">
          <p className="font-display text-2xl uppercase text-gray-400">Nenhum evento encontrado.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-8">
          {filteredEvents.map((event) => (
            <button
              key={event.name}
              type="button"
              onClick={() => onSelectEvent(event.name)}
              className="group flex h-full flex-col bg-white brutal-border brutal-shadow-hover overflow-hidden text-left transition-all"
            >
              <div className="relative aspect-[4/3] w-full shrink-0 bg-brutal-black overflow-hidden border-b-2 border-brutal-black">
                {event.coverUrl ? (
                  <ProtectedMedia
                    src={event.coverUrl}
                    alt={event.name}
                    watermark={`FUNPACE ${event.name.slice(0, 12)}`}
                    eventName={event.name}
                    loading="lazy"
                    decoding="async"
                    sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    imgClassName="block w-full h-full object-cover object-center opacity-85 group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                    <CalendarDays className="w-16 h-16 text-gray-300" />
                  </div>
                )}
                <div className="absolute inset-0 bg-linear-to-t from-brutal-black/80 via-transparent to-transparent" />
                <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 bg-white text-brutal-black px-2 py-1 brutal-border font-mono text-[10px] uppercase font-bold">
                    <Camera className="w-3 h-3" />
                    {event.photos}
                  </span>
                  <span className="inline-flex items-center gap-1 bg-white text-brutal-black px-2 py-1 brutal-border font-mono text-[10px] uppercase font-bold">
                    <Video className="w-3 h-3" />
                    {event.videos}
                  </span>
                </div>
              </div>

              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-center gap-2 text-gray-500 mb-3">
                  <MapPin className="w-4 h-4 text-brutal-accent shrink-0" />
                  <p className="font-mono text-[10px] uppercase tracking-widest truncate">
                    {event.checkpoint}
                  </p>
                </div>
                <h3 className="font-display text-xl uppercase leading-tight min-h-[4.5rem]">
                  {event.name}
                </h3>
                <div className="mt-auto pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-400">
                    {event.items} midias
                  </p>
                  <span className="font-display text-sm uppercase text-brutal-accent">
                    Ver evento
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
