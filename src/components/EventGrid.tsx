import React from 'react';
import { CalendarDays, Camera, MapPin, Video } from 'lucide-react';
import { Event, Product } from '../types';

interface EventGridProps {
  products: Product[];
  registeredEvents?: Event[];
  eventMediaCounts?: Record<string, EventMediaCount>;
  query: string;
  onSelectEvent: (eventName: string) => void;
}

type EventMediaCount = {
  photos: number;
  videos: number;
  items: number;
  eventName: string;
};

interface MediaEvent {
  name: string;
  checkpoint: string;
  coverUrl: string | null;
  coverPosition: string;
  date?: string;
  createdAt?: string;
  eventTime: number;
  createdTime: number;
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

function buildEvents(products: Product[], registeredEvents: Event[] = [], eventMediaCounts: Record<string, EventMediaCount> = {}) {
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
    const fallbackCreatedAt = groupProducts.reduce<string | undefined>((latest, product) => {
      if (!product.createdAt) return latest;
      if (!latest) return product.createdAt;
      return product.createdAt > latest ? product.createdAt : latest;
    }, undefined);
    const fallbackCreatedTime = groupProducts.reduce((latest, product) => {
      const timestamp = getTimestamp(product.createdAt);
      return timestamp > latest ? timestamp : latest;
    }, 0);
    const createdAt = eventDetail?.createdAt || fallbackCreatedAt || fallbackDate;
    const date = eventDetail?.date || fallbackDate;
    const mediaCount = eventDetail?.id ? eventMediaCounts[eventDetail.id] : null;

    events.set(normalizeText(name), {
      name,
      checkpoint: eventDetail?.checkpoint || eventDetail?.location || groupProducts[0]?.checkpoint || 'Local a confirmar',
      coverUrl: eventDetail?.coverImage || coverProduct?.thumbnailUrl || null,
      coverPosition: eventDetail?.cover_position || 'center center',
      date,
      createdAt,
      eventTime: getTimestamp(date),
      createdTime: getTimestamp(createdAt) || fallbackCreatedTime,
      photos: mediaCount?.photos ?? groupProducts.filter((product) => product.type === 'IMG').length,
      videos: mediaCount?.videos ?? groupProducts.filter((product) => product.type === 'VIDEO' || product.type === 'VIEW').length,
      items: mediaCount?.items ?? groupProducts.length,
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
      coverPosition: eventItem.cover_position || 'center center',
      date: eventItem.date,
      createdAt: eventItem.createdAt,
      eventTime: getTimestamp(eventItem.date),
      createdTime: getTimestamp(eventItem.createdAt),
      photos: eventMediaCounts[eventItem.id]?.photos ?? 0,
      videos: eventMediaCounts[eventItem.id]?.videos ?? 0,
      items: eventMediaCounts[eventItem.id]?.items ?? 0,
    });
  }

  return Array.from(events.values()).sort((left, right) => {
    const leftTime = left.eventTime || left.createdTime;
    const rightTime = right.eventTime || right.createdTime;
    return rightTime - leftTime ||
      right.createdTime - left.createdTime ||
      left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' });
  });
}

export function EventGrid({ products, registeredEvents = [], eventMediaCounts = {}, query, onSelectEvent }: EventGridProps) {
  const events = React.useMemo(() => buildEvents(products, registeredEvents, eventMediaCounts), [products, registeredEvents, eventMediaCounts]);
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
    <section id="eventos" data-events-section className="mx-auto box-border w-[calc(100dvw-2rem)] max-w-[calc(100dvw-2rem)] px-0 pt-10 pb-8 md:w-full md:max-w-[87.5rem] md:px-6 md:py-18">
      <div className="mb-9 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div className="max-w-3xl">
          <h2 className="text-3xl md:text-5xl mb-2">EVENTOS</h2>
          <p className="font-mono text-xs text-gray-600 uppercase tracking-widest">
            Fotos e vídeos organizados por cobertura
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-7">
          {filteredEvents.map((event, eventIndex) => (
            <button
              key={event.name}
              type="button"
              onClick={() => onSelectEvent(event.name)}
              className="premium-card group flex h-full min-w-0 flex-col overflow-hidden bg-white text-left brutal-border"
            >
              <div className="relative aspect-video w-full shrink-0 overflow-hidden border-b-2 border-brutal-black bg-[#111318]">
                {event.coverUrl ? (
                  <img
                    src={event.coverUrl}
                    alt={event.name}
                    loading={eventIndex < 8 ? 'eager' : 'lazy'}
                    decoding="async"
                    sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    style={{ objectPosition: event.coverPosition || 'center center' }}
                    onLoad={(event) => event.currentTarget.classList.add('media-fade-in')}
                    className="block h-full w-full object-contain object-center transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                    <CalendarDays className="w-16 h-16 text-gray-300" />
                  </div>
                )}
                <div className="absolute inset-0 z-[2] bg-linear-to-t from-brutal-black/70 via-transparent to-transparent transition-opacity duration-200 group-hover:opacity-90" />
                <div className="absolute bottom-3 left-3 right-3 z-[3] flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 bg-white text-brutal-black px-2 py-1 brutal-border font-mono text-[9px] uppercase font-bold">
                    <Camera className="w-3 h-3" />
                    {event.photos}
                  </span>
                  <span className="inline-flex items-center gap-1 bg-white text-brutal-black px-2 py-1 brutal-border font-mono text-[9px] uppercase font-bold">
                    <Video className="w-3 h-3" />
                    {event.videos}
                  </span>
                </div>
              </div>

              <div className="flex min-w-0 flex-1 flex-col p-4">
                <div className="flex items-center gap-2 text-gray-500 mb-3">
                  <MapPin className="w-4 h-4 text-brutal-accent shrink-0" />
                  <p className="font-mono text-[9px] uppercase tracking-widest truncate">
                    {event.checkpoint}
                  </p>
                </div>
                <h3 className="min-h-[3.8rem] max-w-64 break-words font-display text-base uppercase leading-snug sm:max-w-full sm:text-lg">
                  {event.name}
                </h3>
                <div className="mt-auto flex min-w-0 flex-col items-start justify-between gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center">
                  <p className="font-mono text-[9px] uppercase tracking-widest text-gray-400">
                    {event.items === 1 ? '1 mídia' : `${event.items} mídias`}
                  </p>
                  <span className="shrink-0 whitespace-nowrap font-display text-xs uppercase text-brutal-accent opacity-80 transition-opacity duration-200 group-hover:opacity-100">
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
