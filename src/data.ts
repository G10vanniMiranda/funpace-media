import { Product, Photographer } from './types';

export const MOCK_PHOTOGRAPHERS: Photographer[] = [
  {
    id: 'f1',
    name: 'Marcos Silva',
    email: 'marcos@example.com',
    bio: 'Especialista em fotografia esportiva de alto rendimento. Capturando emoções em cada quilômetro.',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?ixlib=rb-4.0.3&auto=format&fit=crop&w=200&q=80',
    verified: true,
    stats: {
      photos: 1250,
      events: 45,
      rating: 4.9,
      totalEarnings: 3450.80,
      pendingEarnings: 120.50,
      salesCount: 184
    }
  },
  {
    id: 'f2',
    name: 'Ana Oliveira',
    email: 'ana@example.com',
    bio: 'Fotógrafa de trilhas e ultra-maratonas. Amante da natureza e do movimento.',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?ixlib=rb-4.0.3&auto=format&fit=crop&w=200&q=80',
    verified: true,
    stats: {
      photos: 850,
      events: 22,
      rating: 4.8,
      totalEarnings: 1890.00,
      pendingEarnings: 45.00,
      salesCount: 92
    }
  }
];

export const MOCK_PHOTOS: Product[] = [
  {
    id: 'p1',
    name: 'KM 10 - Ponte Estaiada',
    bib: '4212',
    event: 'São Paulo City Marathon',
    checkpoint: 'KM 10',
    price: 19.90,
    url: 'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    type: 'IMG',
    vendedorId: 'f1',
  },
  {
    id: 'p2',
    name: 'KM 21 - Ibirapuera',
    bib: '4212',
    event: 'São Paulo City Marathon',
    checkpoint: 'KM 21',
    price: 19.90,
    url: 'https://images.unsplash.com/photo-1571008887538-b36bb32f4571?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    type: 'IMG',
    vendedorId: 'f1',
  },
  {
    id: 'p3',
    name: 'Linha de Chegada',
    bib: '105',
    event: 'Rio Half Marathon',
    checkpoint: 'Chegada',
    price: 24.90,
    url: 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    type: 'IMG',
    vendedorId: 'f2',
  }
];

export const MOCK_VIDEOS: Product[] = [
  {
    id: 'v1',
    name: 'Maratona SP - Checkpoint 10',
    bib: '4212',
    event: 'São Paulo City Marathon',
    checkpoint: 'KM 10',
    price: 49.90,
    url: 'https://assets.mixkit.co/videos/preview/mixkit-marathon-runners-crossing-the-finish-line-34354-large.mp4',
    type: 'VIDEO',
    vendedorId: 'f1',
  }
];
