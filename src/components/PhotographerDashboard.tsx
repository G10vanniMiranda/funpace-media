import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard,
  Image as ImageIcon,
  DollarSign,
  Settings,
  LogOut,
  Upload,
  Bell,
  CalendarDays,
  ChevronDown,
  MapPin,
  Plus,
  TrendingUp,
  Users,
  ChevronRight,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Tag,
  Star,
  Video as VideoIcon,
  Trash2,
  X
} from 'lucide-react';
import { Event, Product, Photographer, PhotographerDashboardMetrics, PhotographerProductPerformance, PhotographerSale, WithdrawalRequest } from '../types';
import { eventService, photographerDashboardService, productService, withdrawalService } from '../lib/services';
import { isMockMode } from '../lib/config';
import { getCurrentUser } from '../lib/supabase';

interface PhotographerDashboardProps {
  photographer: Photographer;
  onLogout: () => void;
}

type UploadItem = {
  file: File;
  price: number;
  name: string;
  description: string;
  bib: string;
  previewUrl: string;
};

type ProductEditForm = {
  name: string;
  price: string;
  event: string;
  checkpoint: string;
  bib: string;
  status: NonNullable<Product['status']>;
};

type ProductTypeFilter = 'all' | Product['type'];
type ProductStatusFilter = 'all' | NonNullable<Product['status']>;
type PhotographerPeriodKey = 'today' | 'week' | 'month' | 'custom';
type PhotographerTab = 'overview' | 'events' | 'products' | 'earnings';

type PhotographerCatalogEvent = {
  name: string;
  checkpoint: string;
  coverUrl: string | null;
  dateLabel: string;
  createdAtLabel: string;
  photos: number;
  videos: number;
  items: number;
};

type EventFormState = {
  id: string | null;
  name: string;
  date: string;
  location: string;
  checkpoint: string;
  description: string;
  status: Event['status'];
  isPublished: boolean;
  coverImage: string;
  bannerImage: string;
};

const PHOTOGRAPHER_PERIOD_OPTIONS: Array<{ key: PhotographerPeriodKey; label: string }> = [
  { key: 'today', label: 'Hoje' },
  { key: 'week', label: 'Esta semana' },
  { key: 'month', label: 'Este mes' },
  { key: 'custom', label: 'Personalizado' },
];

const defaultUploadMaxBytes = 300 * 1024 * 1024;
const clientUploadMaxBytes = Number(import.meta.env.VITE_MEDIA_UPLOAD_MAX_BYTES || defaultUploadMaxBytes);
const imageCompressionMaxBytes = 900 * 1024;
const imageCompressionMaxSide = 2200;
const minImageCompressionSide = 900;
const imageCompressionQualities = [0.82, 0.74, 0.66, 0.58, 0.5, 0.42];

const withdrawalStatusLabels: Record<WithdrawalRequest['status'], string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  paid: 'Pago',
  rejected: 'Recusado',
  cancelled: 'Cancelado',
};

function getInitialDashboardMetrics(photographer: Photographer): PhotographerDashboardMetrics {
  return {
    totalEarnings: Number(photographer.stats.totalEarnings) || 0,
    pendingEarnings: Number(photographer.stats.pendingEarnings) || 0,
    salesCount: Number(photographer.stats.salesCount) || 0,
    todaySalesCount: 0,
    publishedMediaCount: Number(photographer.stats.photos) || 0,
    photoCount: Number(photographer.stats.photos) || 0,
    videoCount: 0,
    rating: Number(photographer.stats.rating) || 5,
    downloads: Number(photographer.stats.salesCount) || 0,
    platformFeePercent: 30,
    monthlyEarnings: 0,
    availableBalance: Number(photographer.stats.pendingEarnings) || 0,
    monthlyGoal: 5000,
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function normalizeCatalogText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function formatCatalogDate(value?: string) {
  if (!value) return 'DATA A CONFIRMAR';

  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return 'DATA A CONFIRMAR';

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date).replace('.', '').toUpperCase();
}

function getTimestamp(value?: string | null) {
  if (!value) return 0;
  const timestamp = new Date(value.includes('T') ? value : `${value}T12:00:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatCreatedOrderLabel(value?: string | null) {
  const timestamp = getTimestamp(value);
  if (!timestamp) return 'Criacao nao registrada';

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function formatEventSaveError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();

  if (message.includes('events_slug_key') || normalized.includes('duplicate key value') && normalized.includes('slug')) {
    return 'Ja existe um evento com este nome e data. Salve novamente para criar uma variacao automatica ou altere o nome.';
  }

  return message || 'Nao foi possivel salvar o evento.';
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1).replace('.', ',')} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateInput(value: string, fallback: Date) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return fallback;

  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function getPhotographerPeriodRange(period: PhotographerPeriodKey, customStart: string, customEnd: string) {
  const now = new Date();
  let start = startOfDay(now);
  let end = endOfDay(now);

  if (period === 'week') {
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset));
    end = endOfDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6));
  }

  if (period === 'month') {
    start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    end = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  }

  if (period === 'custom') {
    start = startOfDay(parseDateInput(customStart, now));
    end = endOfDay(parseDateInput(customEnd, start));
    if (start.getTime() > end.getTime()) {
      [start, end] = [startOfDay(end), endOfDay(start)];
    }
  }

  return { start, end };
}

function isWithinPeriod(value: string | undefined, start: Date, end: Date) {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= start.getTime() && time <= end.getTime();
}

function formatPeriodLabel(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat('pt-BR');
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function formatSaleDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function SaleThumbnail({ sale }: { sale: PhotographerSale }) {
  const [failed, setFailed] = React.useState(false);
  const source = sale.thumbnailUrl || sale.url;

  if (!source || failed) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#080d14] text-gray-500">
        {sale.type === 'VIDEO' ? <VideoIcon className="w-5 h-5 mb-1" /> : <ImageIcon className="w-5 h-5 mb-1" />}
        <span className="font-mono text-[8px] uppercase">{sale.type}</span>
      </div>
    );
  }

  return (
    <img
      src={source}
      alt={sale.name}
      className="w-full h-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

async function generateVideoThumbnail(file: File): Promise<File | null> {
  if (!file.type.startsWith('video')) return null;

  return new Promise((resolve) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
    };

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    video.onloadedmetadata = () => {
      const targetTime = Math.min(1, Math.max(0, (video.duration || 1) / 4));
      video.currentTime = targetTime;
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      const maxSide = 640;
      const videoWidth = video.videoWidth || 1280;
      const videoHeight = video.videoHeight || 720;
      const scale = Math.min(1, maxSide / Math.max(videoWidth, videoHeight));
      canvas.width = Math.max(1, Math.round(videoWidth * scale));
      canvas.height = Math.max(1, Math.round(videoHeight * scale));
      const context = canvas.getContext('2d');

      if (!context) {
        cleanup();
        resolve(null);
        return;
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        cleanup();

        if (!blob) {
          resolve(null);
          return;
        }

        const thumbnailName = file.name.replace(/\.[^.]+$/, '') || 'video';
        resolve(new File([blob], `${thumbnailName}-thumb.jpg`, { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.7);
    };
  });
}

async function generateImageThumbnail(file: File): Promise<File | null> {
  if (!file.type.startsWith('image')) return null;

  return new Promise((resolve) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const maxSide = 520;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');

      if (!context) {
        resolve(null);
        return;
      }

      context.drawImage(image, 0, 0, width, height);
      context.save();
      context.translate(width / 2, height / 2);
      context.rotate(-Math.PI / 6);
      context.font = `900 ${Math.max(18, Math.round(width / 12))}px Arial, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = 'rgba(255,255,255,0.26)';
      context.strokeStyle = 'rgba(0,0,0,0.32)';
      context.lineWidth = Math.max(2, width / 220);
      context.strokeText('FUNPACE', 0, 0);
      context.fillText('FUNPACE', 0, 0);
      context.restore();
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(null);
          return;
        }

        const thumbnailName = file.name.replace(/\.[^.]+$/, '') || 'foto';
        resolve(new File([blob], `${thumbnailName}-preview.jpg`, { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.68);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };

    image.src = objectUrl;
  });
}

async function prepareImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image')) return file;

  if (file.size <= Math.min(imageCompressionMaxBytes, clientUploadMaxBytes)) return file;

  return new Promise((resolve) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = async () => {
      URL.revokeObjectURL(objectUrl);
      const maxBytes = Math.min(clientUploadMaxBytes, Math.max(imageCompressionMaxBytes, Math.floor(clientUploadMaxBytes * 0.92)));
      const originalMaxSide = Math.max(image.width, image.height);
      const sideTargets = [
        Math.min(imageCompressionMaxSide, originalMaxSide),
        1800,
        1500,
        1200,
        minImageCompressionSide,
      ].filter((value, index, values) => value >= minImageCompressionSide && values.indexOf(value) === index);

      for (const maxSide of sideTargets) {
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');

        if (!context) {
          resolve(file);
          return;
        }

        context.drawImage(image, 0, 0, width, height);

        for (const quality of imageCompressionQualities) {
          const blob = await new Promise<Blob | null>((blobResolve) => {
            canvas.toBlob(blobResolve, 'image/jpeg', quality);
          });

          if (blob && blob.size <= maxBytes) {
            const compressedName = `${(file.name.replace(/\.[^.]+$/, '') || 'foto')}.jpg`;
            resolve(new File([blob], compressedName, { type: 'image/jpeg' }));
            return;
          }
        }
      }

      resolve(file);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    image.src = objectUrl;
  });
}

function assertFileFitsUploadLimit(file: File) {
  if (file.size <= clientUploadMaxBytes) return;

  if (file.type.startsWith('video')) {
    throw new Error(`Video muito grande para este deploy (${formatFileSize(file.size)}). O limite atual e ${formatFileSize(clientUploadMaxBytes)}. Comprima o MP4 ou publique um video menor.`);
  }

  if (file.type.startsWith('image')) {
    throw new Error(`Imagem muito grande para este deploy mesmo apos a compressao (${formatFileSize(file.size)}). O limite atual e ${formatFileSize(clientUploadMaxBytes)}. Reduza a resolucao antes de publicar.`);
  }

  throw new Error(`Arquivo muito grande para este deploy (${formatFileSize(file.size)}). O limite atual e ${formatFileSize(clientUploadMaxBytes)}.`);
}

function getSelectionBlockReason(file: File) {
  if (file.type.startsWith('image')) return '';
  if (file.size <= clientUploadMaxBytes) return '';

  if (file.type.startsWith('video')) {
    return `Video ${file.name} tem ${formatFileSize(file.size)} e excede o limite atual de ${formatFileSize(clientUploadMaxBytes)}. Comprima o MP4 antes de selecionar.`;
  }

  return `Arquivo ${file.name} tem ${formatFileSize(file.size)} e excede o limite atual de ${formatFileSize(clientUploadMaxBytes)}.`;
}

function formatUploadErrorMessage(message: string, file?: File) {
  if (/FUNCTION_PAYLOAD_TOO_LARGE|Request Entity Too Large|payload too large|entity too large/i.test(message)) {
    if (file?.type.startsWith('video')) {
      return `Video muito grande para envio neste deploy. O limite atual e ${formatFileSize(clientUploadMaxBytes)}. Comprima o MP4 ou publique um video menor.`;
    }

    if (file?.type.startsWith('image')) {
      return 'Arquivo muito grande para envio. A foto foi comprimida automaticamente, mas ainda excedeu o limite do servidor. Tente uma imagem menor ou reduza a resolucao antes de publicar.';
    }

    return `Arquivo muito grande para envio neste deploy. O limite atual e ${formatFileSize(clientUploadMaxBytes)}.`;
  }

  if (/sess[aÃ£]o expirada/i.test(message)) {
    return 'Credencial do bucket expirada ou invalida. Gere um novo BUCKET_API_TOKEN no provedor, atualize o .env/deploy e reinicie o backend.';
  }

  return message;
}

function waitForPreviewReady(file: File, previewUrl: string): Promise<void> {
  if (file.type.startsWith('video')) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        cleanup();
        resolve();
      };
      const cleanup = () => {
        video.removeAttribute('src');
        video.load();
      };
      const timeout = window.setTimeout(finish, 12000);

      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.onloadedmetadata = finish;
      video.onerror = finish;
      video.src = previewUrl;
    });
  }

  if (file.type.startsWith('image')) {
    return new Promise((resolve) => {
      const image = new Image();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve();
      };
      const timeout = window.setTimeout(finish, 12000);
      image.onload = finish;
      image.onerror = finish;
      image.src = previewUrl;
    });
  }

  return Promise.resolve();
}

async function generateMediaThumbnail(file: File): Promise<File | null> {
  return file.type.startsWith('image')
    ? generateImageThumbnail(file)
    : generateVideoThumbnail(file);
}

export function PhotographerDashboard({ photographer, onLogout }: PhotographerDashboardProps) {
  const [activeTab, setActiveTab] = useState<PhotographerTab>('overview');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [dashboardMetrics, setDashboardMetrics] = useState<PhotographerDashboardMetrics>(() => getInitialDashboardMetrics(photographer));
  const [recentSales, setRecentSales] = useState<PhotographerSale[]>([]);
  const [productPerformance, setProductPerformance] = useState<PhotographerProductPerformance[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState({ done: 0, total: 0 });
  const [isPreparingFiles, setIsPreparingFiles] = useState(false);
  const [filePrepareProgress, setFilePrepareProgress] = useState({ done: 0, total: 0 });
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false);
  const [withdrawalPixKey, setWithdrawalPixKey] = useState(photographer.cpf ?? '');
  const [withdrawalError, setWithdrawalError] = useState('');
  const [isRequestingWithdrawal, setIsRequestingWithdrawal] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<UploadItem[]>([]);
  const [availableEvents, setAvailableEvents] = useState<Event[]>([]);
  const [eventForm, setEventForm] = useState<EventFormState>(() => ({
    id: null,
    name: '',
    date: formatDateInput(new Date()),
    location: '',
    checkpoint: 'Ponto Principal',
    description: '',
    status: 'scheduled',
    isPublished: true,
    coverImage: '',
    bannerImage: '',
  }));
  const [eventError, setEventError] = useState('');
  const [isSavingEvent, setIsSavingEvent] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [batchPriceInput, setBatchPriceInput] = useState('19.90');
  const [previewIndex, setPreviewIndex] = useState(0);
  const [eventInput, setEventInput] = useState('');
  const [checkpointInput, setCheckpointInput] = useState('Ponto Principal');
  const [productSearch, setProductSearch] = useState('');
  const [productTypeFilter, setProductTypeFilter] = useState<ProductTypeFilter>('all');
  const [productStatusFilter, setProductStatusFilter] = useState<ProductStatusFilter>('all');
  const [selectedProductEventName, setSelectedProductEventName] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(() => new Set());
  const [isBulkRemovingProducts, setIsBulkRemovingProducts] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<PhotographerPeriodKey>('week');
  const [customPeriodStart, setCustomPeriodStart] = useState(() => formatDateInput(startOfDay(new Date())));
  const [customPeriodEnd, setCustomPeriodEnd] = useState(() => formatDateInput(endOfDay(new Date())));
  const [showPeriodMenu, setShowPeriodMenu] = useState(false);
  const periodMenuRef = React.useRef<HTMLDivElement | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState<ProductEditForm>({
    name: '',
    price: '',
    event: '',
    checkpoint: '',
    bib: '',
    status: 'published',
  });
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const currentPreview = selectedFiles[previewIndex];
  const eventCoverCandidates = React.useMemo(() => {
    const normalizedEventName = normalizeCatalogText(eventForm.name.trim());
    if (!normalizedEventName) return [];

    return products
      .filter((product) => (
        (product.status ?? 'published') !== 'removed' &&
        normalizeCatalogText(product.event || '') === normalizedEventName &&
        Boolean(product.thumbnailUrl || product.url)
      ))
      .sort((left, right) => {
        const leftTime = getTimestamp(left.createdAt);
        const rightTime = getTimestamp(right.createdAt);
        return rightTime - leftTime || String(left.name || '').localeCompare(String(right.name || ''), 'pt-BR', { sensitivity: 'base' });
      })
      .slice(0, 24);
  }, [products, eventForm.name]);

  React.useEffect(() => {
    if (!showPeriodMenu) return undefined;

    function handleClickOutside(event: MouseEvent) {
      if (!periodMenuRef.current) return;
      if (event.target instanceof Node && !periodMenuRef.current.contains(event.target)) {
        setShowPeriodMenu(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPeriodMenu]);

  const filteredProducts = React.useMemo(() => {
    const normalizedSearch = productSearch.trim().toLowerCase();

    return products.filter((product) => {
      const productStatus = product.status ?? 'published';
      if (productStatus === 'removed') return false;

      const matchesSearch = !normalizedSearch || [
        product.name,
        product.event,
        product.checkpoint,
        product.bib,
        product.id,
      ].some((value) => value?.toLowerCase().includes(normalizedSearch));
      const matchesType = productTypeFilter === 'all' || product.type === productTypeFilter;
      const matchesStatus = productStatusFilter === 'all' || productStatus === productStatusFilter;

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [products, productSearch, productTypeFilter, productStatusFilter]);

  const groupedFilteredProducts = React.useMemo(() => {
    const groups = new Map<string, Product[]>();
    const eventDetails = new Map<string, Event>();

    availableEvents.forEach((eventItem) => {
      eventDetails.set(normalizeCatalogText(eventItem.name), eventItem);
    });

    for (const product of filteredProducts) {
      const eventName = product.event?.trim() || 'Geral';
      const group = groups.get(eventName) ?? [];
      group.push(product);
      groups.set(eventName, group);
    }

    return Array.from(groups.entries())
      .sort(([eventA, productsA], [eventB, productsB]) => {
        if (eventA === 'Geral') return 1;
        if (eventB === 'Geral') return -1;

        const detailA = eventDetails.get(normalizeCatalogText(eventA));
        const detailB = eventDetails.get(normalizeCatalogText(eventB));
        const fallbackA = productsA.reduce((earliest, product) => {
          const timestamp = getTimestamp(product.createdAt);
          return timestamp && (!earliest || timestamp < earliest) ? timestamp : earliest;
        }, 0);
        const fallbackB = productsB.reduce((earliest, product) => {
          const timestamp = getTimestamp(product.createdAt);
          return timestamp && (!earliest || timestamp < earliest) ? timestamp : earliest;
        }, 0);
        const createdA = getTimestamp(detailA?.createdAt) || fallbackA;
        const createdB = getTimestamp(detailB?.createdAt) || fallbackB;

        if (createdA !== createdB) return createdB - createdA;
        return eventA.localeCompare(eventB, 'pt-BR', { sensitivity: 'base' });
      })
      .map(([eventName, products]) => ({
        eventName,
        products: products.sort((left, right) => {
          const parseBibNumber = (value?: string) => {
            if (!value) return NaN;
            const match = value.match(/\d+/);
            return match ? Number(match[0]) : NaN;
          };

          const leftBib = parseBibNumber(left.bib);
          const rightBib = parseBibNumber(right.bib);
          const leftHasBib = Number.isFinite(leftBib);
          const rightHasBib = Number.isFinite(rightBib);

          if (leftHasBib && rightHasBib) {
            if (leftBib !== rightBib) return leftBib - rightBib;
          } else if (leftHasBib) {
            return -1;
          } else if (rightHasBib) {
            return 1;
          }

          return String(left.name || '').localeCompare(String(right.name || ''), 'pt-BR', { sensitivity: 'base' });
        }),
      }));
  }, [filteredProducts, availableEvents]);
  const productEventCards = React.useMemo<PhotographerCatalogEvent[]>(() => {
    const eventDetails = new Map<string, Event>();
    availableEvents.forEach((eventItem) => {
      eventDetails.set(normalizeCatalogText(eventItem.name), eventItem);
    });

    return groupedFilteredProducts.map(({ eventName, products: groupProducts }) => {
      const eventDetail = eventDetails.get(normalizeCatalogText(eventName));
      const coverProduct = groupProducts.find((product) => product.thumbnailUrl || product.url);
      const fallbackDate = groupProducts.reduce<string | undefined>((latest, product) => {
        if (!product.createdAt) return latest;
        if (!latest) return product.createdAt;
        return product.createdAt > latest ? product.createdAt : latest;
      }, undefined);

      return {
        name: eventName,
        checkpoint: eventDetail?.checkpoint || eventDetail?.location || groupProducts[0]?.checkpoint || 'Local a confirmar',
        coverUrl: eventDetail?.coverImage || coverProduct?.thumbnailUrl || coverProduct?.url || null,
        dateLabel: formatCatalogDate(eventDetail?.date || fallbackDate),
        createdAtLabel: formatCreatedOrderLabel(eventDetail?.createdAt || fallbackDate),
        photos: groupProducts.filter((product) => product.type === 'IMG').length,
        videos: groupProducts.filter((product) => product.type === 'VIDEO' || product.type === 'VIEW').length,
        items: groupProducts.length,
      };
    });
  }, [groupedFilteredProducts, availableEvents]);
  const visibleGroupedProducts = React.useMemo(() => {
    if (!selectedProductEventName) return groupedFilteredProducts;
    return groupedFilteredProducts.filter(({ eventName }) => eventName === selectedProductEventName);
  }, [groupedFilteredProducts, selectedProductEventName]);
  const selectedProducts = React.useMemo(
    () => products.filter((product) => selectedProductIds.has(product.id) && (product.status ?? 'published') !== 'removed'),
    [products, selectedProductIds],
  );
  const allFilteredProductsSelected = filteredProducts.length > 0 &&
    filteredProducts.every((product) => selectedProductIds.has(product.id));
  const upcomingEvents = React.useMemo(() => {
    return availableEvents
      .filter((eventItem) => eventItem.status !== 'closed')
      .slice(0, 3)
      .map((eventItem) => ({
        id: eventItem.id,
        title: eventItem.name,
        date: eventItem.date ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${eventItem.date}T12:00:00`)) : 'Sem data',
        time: eventItem.location || eventItem.checkpoint || 'Evento ativo',
        isPublished: eventItem.isPublished !== false,
      }));
  }, [availableEvents]);
  const publishableEvents = React.useMemo(() => (
    availableEvents.filter((eventItem) => eventItem.status !== 'closed' && eventItem.isPublished !== false)
  ), [availableEvents]);
  const visibleProductStats = React.useMemo(() => {
    const activeProducts = products.filter((product) => (product.status ?? 'published') !== 'removed');
    return {
      total: activeProducts.length,
      photos: activeProducts.filter((product) => product.type === 'IMG').length,
      videos: activeProducts.filter((product) => product.type === 'VIDEO').length,
      drafts: activeProducts.filter((product) => (product.status ?? 'published') === 'draft').length,
    };
  }, [products]);
  const periodRange = React.useMemo(
    () => getPhotographerPeriodRange(selectedPeriod, customPeriodStart, customPeriodEnd),
    [selectedPeriod, customPeriodStart, customPeriodEnd],
  );
  const periodLabel = React.useMemo(
    () => formatPeriodLabel(periodRange.start, periodRange.end),
    [periodRange],
  );
  const periodProducts = React.useMemo(
    () => products.filter((product) => isWithinPeriod(product.createdAt, periodRange.start, periodRange.end)),
    [products, periodRange],
  );
  const periodSales = React.useMemo(
    () => recentSales.filter((sale) => isWithinPeriod(sale.orderCreatedAt, periodRange.start, periodRange.end)),
    [recentSales, periodRange],
  );
  const periodWithdrawals = React.useMemo(
    () => withdrawals.filter((withdrawal) => isWithinPeriod(withdrawal.createdAt, periodRange.start, periodRange.end)),
    [withdrawals, periodRange],
  );
  const periodMetrics = React.useMemo<PhotographerDashboardMetrics>(() => {
    const releaseWindowMs = 7 * 24 * 60 * 60 * 1000;
    const totalEarnings = periodSales.reduce((total, sale) => total + Number(sale.netAmount || 0), 0);
    const pendingEarnings = periodSales
      .filter((sale) => Date.now() - new Date(sale.orderCreatedAt).getTime() < releaseWindowMs)
      .reduce((total, sale) => total + Number(sale.netAmount || 0), 0);

    return {
      ...dashboardMetrics,
      totalEarnings,
      pendingEarnings,
      salesCount: periodSales.length,
      todaySalesCount: periodSales.filter((sale) => isWithinPeriod(sale.orderCreatedAt, startOfDay(new Date()), endOfDay(new Date()))).length,
      publishedMediaCount: periodProducts.filter((product) => (product.status ?? 'published') === 'published').length,
      photoCount: periodProducts.filter((product) => product.type === 'IMG').length,
      videoCount: periodProducts.filter((product) => product.type === 'VIDEO' || product.type === 'VIEW').length,
      monthlyEarnings: periodSales
        .filter((sale) => sale.orderCreatedAt.slice(0, 7) === new Date().toISOString().slice(0, 7))
        .reduce((total, sale) => total + Number(sale.netAmount || 0), 0),
    };
  }, [dashboardMetrics, periodProducts, periodSales]);
  const periodProductPerformance = React.useMemo<PhotographerProductPerformance[]>(() => {
    const downloadsByProduct = new Map(productPerformance.map((item) => [item.productId, item.downloads]));
    const performanceByProduct = new Map<string, PhotographerProductPerformance>();

    for (const sale of periodSales) {
      const current = performanceByProduct.get(sale.productId) ?? {
        productId: sale.productId,
        name: sale.name,
        type: sale.type,
        event: sale.event,
        bib: sale.bib,
        thumbnailUrl: sale.thumbnailUrl,
        salesCount: 0,
        downloads: downloadsByProduct.get(sale.productId) ?? 0,
        grossRevenue: 0,
        netRevenue: 0,
      };
      current.salesCount += 1;
      current.grossRevenue += Number(sale.price || 0);
      current.netRevenue += Number(sale.netAmount || 0);
      performanceByProduct.set(sale.productId, current);
    }

    return Array.from(performanceByProduct.values())
      .sort((a, b) => b.netRevenue - a.netRevenue || b.downloads - a.downloads)
      .slice(0, 8);
  }, [periodSales, productPerformance]);
  const periodTopPhotoPerformance = React.useMemo(() => (
    periodProductPerformance
      .filter((item) => item.type === 'IMG')
      .sort((a, b) => b.salesCount - a.salesCount || b.netRevenue - a.netRevenue || b.downloads - a.downloads)
      .slice(0, 5)
  ), [periodProductPerformance]);
  const photographerNotifications = React.useMemo(() => {
    const draftCount = products.filter((product) => (product.status ?? 'published') === 'draft').length;
    const openWithdrawalCount = withdrawals.filter((withdrawal) => (
      withdrawal.status === 'pending' || withdrawal.status === 'approved'
    )).length;
    const notifications: Array<{ id: string; title: string; detail: string; tab: typeof activeTab }> = [];

    if (periodSales.length > 0) {
      notifications.push({
        id: 'period-sales',
        title: `${periodSales.length} venda(s) no periodo`,
        detail: `${formatCurrency(periodMetrics.totalEarnings)} liquidos confirmados`,
        tab: 'earnings',
      });
    }

    if (openWithdrawalCount > 0) {
      notifications.push({
        id: 'open-withdrawals',
        title: `${openWithdrawalCount} saque(s) em processamento`,
        detail: 'Acompanhe o status dos repasses',
        tab: 'earnings',
      });
    }

    if (draftCount > 0) {
      notifications.push({
        id: 'draft-products',
        title: `${draftCount} rascunho(s) no catalogo`,
        detail: 'Revise e publique quando estiver pronto',
        tab: 'products',
      });
    }

    if (dashboardMetrics.availableBalance > 0) {
      notifications.push({
        id: 'available-balance',
        title: 'Saldo disponivel para saque',
        detail: formatCurrency(dashboardMetrics.availableBalance),
        tab: 'earnings',
      });
    }

    return notifications;
  }, [dashboardMetrics.availableBalance, periodMetrics.totalEarnings, periodSales.length, products, withdrawals]);
  const pendingWithdrawalTotal = periodWithdrawals
    .filter((withdrawal) => withdrawal.status === 'pending' || withdrawal.status === 'approved')
    .reduce((sum, withdrawal) => sum + Number(withdrawal.amount || 0), 0);
  const paidWithdrawalTotal = periodWithdrawals
    .filter((withdrawal) => withdrawal.status === 'paid')
    .reduce((sum, withdrawal) => sum + Number(withdrawal.amount || 0), 0);
  const monthlyGoalPercent = Math.min(100, Math.round((periodMetrics.monthlyEarnings / periodMetrics.monthlyGoal) * 100));
  const filePreparePercent = filePrepareProgress.total > 0
    ? Math.round((filePrepareProgress.done / filePrepareProgress.total) * 100)
    : 100;
  const publishPercent = publishProgress.total > 0
    ? Math.round((publishProgress.done / publishProgress.total) * 100)
    : 0;
  const canPublishSelectedFiles = selectedFiles.length > 0 && !isLoading && !isPreparingFiles && !isPublishing;

  const loadPhotographerContent = React.useCallback(async (showLoader = false) => {
    if (showLoader) setIsLoading(true);
    try {
      const pProducts = await productService.getVendedorProducts(photographer.id);
      const visibleProducts = pProducts.filter((product) => (product.status ?? 'published') !== 'removed');
      setProducts(visibleProducts);
      const dashboard = await photographerDashboardService.getDashboard(photographer.id, visibleProducts);
      const pWithdrawals = await withdrawalService.getPhotographerWithdrawals(photographer.id);
      const events = await eventService.getPhotographerEvents(photographer.id);
      setDashboardMetrics(dashboard.metrics);
      setRecentSales(dashboard.recentSales);
      setProductPerformance(dashboard.productPerformance);
      setWithdrawals(pWithdrawals);
      setAvailableEvents(events);
    } catch (error) {
      console.error("Error loading photographer content:", error);
    } finally {
      if (showLoader) setIsLoading(false);
    }
  }, [photographer.id]);

  React.useEffect(() => {
    loadPhotographerContent(true);
  }, [loadPhotographerContent]);

  React.useEffect(() => {
    const refreshMs = 30_000;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadPhotographerContent(false);
      }
    }, refreshMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadPhotographerContent(false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadPhotographerContent]);

  React.useEffect(() => {
    if (selectedEventId || publishableEvents.length !== 1) return;

    const [eventItem] = publishableEvents;
    setSelectedEventId(eventItem.id);
    setEventInput(eventItem.name);
    setCheckpointInput(eventItem.checkpoint || eventItem.location || 'Ponto Principal');
  }, [publishableEvents, selectedEventId]);

  const handleWithdrawalRequest = async () => {
    const pixKey = withdrawalPixKey.trim();
    setWithdrawalError('');

    if (dashboardMetrics.availableBalance <= 0) {
      setWithdrawalError('Nao ha saldo disponivel para saque.');
      return;
    }

    if (pixKey.length < 3) {
      setWithdrawalError('Informe uma chave Pix valida.');
      return;
    }

    setIsRequestingWithdrawal(true);
    try {
      const created = await withdrawalService.createWithdrawalRequest(
        photographer.id,
        dashboardMetrics.availableBalance,
        pixKey,
      );
      setWithdrawals((current) => [created, ...current]);
      setDashboardMetrics((current) => ({
        ...current,
        availableBalance: Math.max(0, current.availableBalance - Number(created.amount || 0)),
      }));
      setShowWithdrawalModal(false);
      setWithdrawalPixKey(photographer.cpf ?? '');
    } catch (error: any) {
      console.error('Erro ao solicitar saque:', error);
      setWithdrawalError(error?.message || 'Nao foi possivel solicitar o saque.');
    } finally {
      setIsRequestingWithdrawal(false);
    }
  };

  const resetEventForm = () => {
    setEventForm({
      id: null,
      name: '',
      date: formatDateInput(new Date()),
      location: '',
      checkpoint: 'Ponto Principal',
      description: '',
      status: 'scheduled',
      isPublished: true,
      coverImage: '',
      bannerImage: '',
    });
    setEventError('');
  };

  const handleEditEvent = (eventItem: Event) => {
    setEventForm({
      id: eventItem.id,
      name: eventItem.name,
      date: eventItem.date,
      location: eventItem.location || '',
      checkpoint: eventItem.checkpoint || 'Ponto Principal',
      description: eventItem.description || '',
      status: eventItem.status,
      isPublished: eventItem.isPublished !== false,
      coverImage: eventItem.coverImage || '',
      bannerImage: eventItem.bannerImage || '',
    });
    setActiveTab('events');
  };

  const handleSaveEvent = async () => {
    const normalizedName = eventForm.name.trim();
    const normalizedDate = eventForm.date.trim();
    setEventError('');

    if (!normalizedName || !normalizedDate) {
      setEventError('Informe nome e data do evento.');
      return;
    }

    setIsSavingEvent(true);
    try {
      const payload = {
        photographerId: photographer.id,
        name: normalizedName,
        date: normalizedDate,
        location: eventForm.location.trim() || null,
        checkpoint: eventForm.checkpoint.trim() || 'Ponto Principal',
        description: eventForm.description.trim() || null,
        status: eventForm.status,
        isPublished: eventForm.isPublished,
        coverImage: eventForm.coverImage.trim() || null,
        bannerImage: eventForm.bannerImage.trim() || null,
      };
      const saved = eventForm.id
        ? await eventService.updateEvent(eventForm.id, payload)
        : await eventService.createEvent(payload);

      setAvailableEvents((current) => {
        const exists = current.some((eventItem) => eventItem.id === saved.id);
        return (exists
          ? current.map((eventItem) => (eventItem.id === saved.id ? saved : eventItem))
          : [saved, ...current])
          .sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')));
      });
      resetEventForm();
    } catch (error: any) {
      console.error('Erro ao salvar evento:', error);
      setEventError(formatEventSaveError(error));
    } finally {
      setIsSavingEvent(false);
    }
  };

  const handleToggleEventPublication = async (eventItem: Event) => {
    try {
      const updated = await eventService.updateEvent(eventItem.id, { isPublished: eventItem.isPublished === false });
      setAvailableEvents((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      console.error('Erro ao alterar publicacao do evento:', error);
      alert('Nao foi possivel alterar a publicacao do evento.');
    }
  };

  const handleRemoveEvent = async (eventItem: Event) => {
    const hasProducts = products.some((product) => product.event === eventItem.name);
    const shouldRemove = window.confirm(hasProducts
      ? 'Este evento possui produtos vinculados. Remover o evento nao remove as fotos, mas elas ficam com o nome atual no catalogo. Continuar?'
      : 'Remover este evento?');
    if (!shouldRemove) return;

    try {
      await eventService.removeEvent(eventItem.id);
      setAvailableEvents((current) => current.filter((item) => item.id !== eventItem.id));
      if (selectedEventId === eventItem.id) setSelectedEventId('');
    } catch (error) {
      console.error('Erro ao remover evento:', error);
      alert('Nao foi possivel remover o evento.');
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;

    const blockedReasons = files
      .map(getSelectionBlockReason)
      .filter(Boolean);
    const acceptedFiles = files.filter((file) => !getSelectionBlockReason(file));

    if (blockedReasons.length > 0) {
      alert(`Alguns arquivos nao foram adicionados:\n\n${blockedReasons.slice(0, 5).join('\n')}${blockedReasons.length > 5 ? `\n...e mais ${blockedReasons.length - 5} arquivo(s).` : ''}`);
    }

    if (acceptedFiles.length === 0) return;

    const defaultBatchPrice = Number(batchPriceInput);
    const resolvedPrice = Number.isFinite(defaultBatchPrice) && defaultBatchPrice > 0 ? defaultBatchPrice : 19.90;
    const newFiles: UploadItem[] = acceptedFiles.map((file: File) => ({
      file,
      price: resolvedPrice,
      name: file.name,
      description: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim(),
      bib: '',
      previewUrl: URL.createObjectURL(file)
    }));

    setSelectedFiles((current) => {
      if (current.length === 0 && newFiles.length > 0) {
        setPreviewIndex(0);
      }
      return [...current, ...newFiles];
    });

    setIsPreparingFiles(true);
    setFilePrepareProgress({ done: 0, total: newFiles.length });

    try {
      for (const [index, item] of newFiles.entries()) {
        await waitForPreviewReady(item.file, item.previewUrl);
        setFilePrepareProgress({ done: index + 1, total: newFiles.length });
      }
    } finally {
      setIsPreparingFiles(false);
    }
  };

  const clearSelectedFiles = () => {
    selectedFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setSelectedFiles([]);
    setBatchPriceInput('19.90');
    setPreviewIndex(0);
    setIsPreparingFiles(false);
    setFilePrepareProgress({ done: 0, total: 0 });
    setPublishProgress({ done: 0, total: 0 });
  };

  const updateSelectedFile = (index: number, changes: Partial<Pick<UploadItem, 'price' | 'description' | 'bib'>>) => {
    setSelectedFiles((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...changes } : item
    )));
  };

  const applyBatchPriceToSelectedFiles = () => {
    const normalizedPrice = Number(batchPriceInput);
    if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
      alert('Informe um valor valido para aplicar em todas as fotos.');
      return;
    }

    setSelectedFiles((current) => current.map((item) => ({ ...item, price: normalizedPrice })));
  };

  const handleTodayEventSelect = (eventId: string) => {
    setSelectedEventId(eventId);
    const selectedEvent = availableEvents.find((eventItem) => eventItem.id === eventId);
    if (!selectedEvent) return;

    setEventInput(selectedEvent.name);
    setCheckpointInput(selectedEvent.checkpoint || selectedEvent.location || 'Ponto Principal');
  };

  const openUploadForEvent = (eventName: string) => {
    const selectedEvent = availableEvents.find((eventItem) => (
      normalizeCatalogText(eventItem.name) === normalizeCatalogText(eventName)
    ));

    clearSelectedFiles();
    setSelectedEventId(selectedEvent?.id || '');
    setEventInput(selectedEvent?.name || eventName);
    setCheckpointInput(selectedEvent?.checkpoint || selectedEvent?.location || 'Ponto Principal');
    setShowUploadModal(true);
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setEditForm({
      name: product.name,
      price: String(product.price),
      event: product.event,
      checkpoint: product.checkpoint,
      bib: product.bib,
      status: product.status ?? 'published',
    });
  };

  const closeEditModal = () => {
    setEditingProduct(null);
    setEditForm({
      name: '',
      price: '',
      event: '',
      checkpoint: '',
      bib: '',
      status: 'published',
    });
  };

  const handleUpdateProduct = async () => {
    if (!editingProduct) return;

    const normalizedName = editForm.name.trim();
    const normalizedEvent = editForm.event.trim();
    const normalizedCheckpoint = editForm.checkpoint.trim();
    const normalizedBib = editForm.bib.trim();
    const normalizedPrice = Number(editForm.price);

    if (!normalizedName || !normalizedEvent || !normalizedCheckpoint) {
      alert('Preencha nome, evento e checkpoint.');
      return;
    }

    if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
      alert('Informe um preco valido.');
      return;
    }

    setIsLoading(true);
    try {
      const updatedProduct = await productService.updateProduct(editingProduct.id, {
        name: normalizedName,
        price: normalizedPrice,
        event: normalizedEvent,
        checkpoint: normalizedCheckpoint,
        bib: normalizedBib,
        status: editForm.status,
      });

      setProducts((current) => current.map((product) => (
        product.id === updatedProduct.id ? updatedProduct : product
      )));
      closeEditModal();
      alert('Produto atualizado com sucesso!');
    } catch (error) {
      console.error('Erro ao atualizar produto:', error);
      alert('Erro ao atualizar produto.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveProduct = async (product: Product) => {
    const shouldRemove = window.confirm('Remover este produto? Ele nao aparecera mais no painel nem na vitrine.');
    if (!shouldRemove) return;

    setIsPublishing(true);
    setPublishProgress({ done: 0, total: selectedFiles.length });
    try {
      await productService.removeProduct(product.id);
      setProducts((current) => current.filter((item) => item.id !== product.id));
      alert('Produto removido.');
    } catch (error) {
      console.error('Erro ao remover produto:', error);
      alert('Erro ao remover produto.');
    } finally {
      setIsPublishing(false);
    }
  };

  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  const toggleAllFilteredProducts = () => {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (allFilteredProductsSelected) {
        filteredProducts.forEach((product) => next.delete(product.id));
      } else {
        filteredProducts.forEach((product) => next.add(product.id));
      }
      return next;
    });
  };

  const handleBulkRemoveProducts = async () => {
    if (selectedProducts.length === 0) return;

    const shouldRemove = window.confirm(`Remover ${selectedProducts.length} produto(s) da vitrine? Eles nao aparecerao para clientes.`);
    if (!shouldRemove) return;

    setIsBulkRemovingProducts(true);
    try {
      const failedIds = new Set<string>();
      for (const product of selectedProducts) {
        try {
          await productService.removeProduct(product.id);
        } catch {
          failedIds.add(product.id);
        }
      }

      const removedIds = new Set(selectedProducts.filter((product) => !failedIds.has(product.id)).map((product) => product.id));
      setProducts((current) => current.filter((item) => !removedIds.has(item.id)));
      setSelectedProductIds(failedIds);

      if (failedIds.size > 0) {
        alert(`${removedIds.size} produto(s) removido(s). ${failedIds.size} falharam e continuam selecionados.`);
      } else {
        alert(`${removedIds.size} produto(s) removido(s) da vitrine.`);
      }
    } finally {
      setIsBulkRemovingProducts(false);
    }
  };

  const handleUpload = async () => {
    const selectedEvent = availableEvents.find((eventItem) => eventItem.id === selectedEventId);
    const normalizedEvent = selectedEvent?.name.trim() || eventInput.trim();
    const normalizedCheckpoint = (selectedEvent?.checkpoint || selectedEvent?.location || checkpointInput).trim();

    if (selectedFiles.length === 0) {
      alert("Selecione ao menos um arquivo para publicar.");
      return;
    }

    if (publishableEvents.length > 0 && !selectedEvent) {
      alert("Selecione o evento cadastrado antes de publicar.");
      return;
    }

    if (!normalizedEvent || !normalizedCheckpoint) {
      alert("Preencha evento e checkpoint antes de publicar.");
      return;
    }

    const invalidFileIndex = selectedFiles.findIndex((item) => (
      !item.description.trim() ||
      !Number.isFinite(Number(item.price)) ||
      Number(item.price) <= 0
    ));

    if (invalidFileIndex >= 0) {
      setPreviewIndex(invalidFileIndex);
      alert(`Preencha descricao e preco valido para o arquivo ${invalidFileIndex + 1}.`);
      return;
    }

    setIsLoading(true);
    setIsPublishing(true);
    try {
      const currentUser = getCurrentUser();
      if (!isMockMode && currentUser?.id && currentUser.id !== photographer.id) {
        alert('Sessao do fotografo nao sincronizada com o cadastro aprovado. Saia do painel, entre novamente e tente publicar de novo.');
        return;
      }

      let publishedCount = 0;
      const failedUploads: Array<{ index: number; name: string; message: string }> = [];

      for (const [index, item] of selectedFiles.entries()) {
        try {
          const uploadFile = await prepareImageForUpload(item.file);
          assertFileFitsUploadLimit(uploadFile);
          const uploadedFile = await productService.uploadProductFile(photographer.id, uploadFile);
          const thumbnailFile = await generateMediaThumbnail(uploadFile);
          const uploadedThumbnail = thumbnailFile
            ? await productService.uploadProductThumbnail(photographer.id, thumbnailFile)
            : null;

          await productService.addProduct({
            name: item.description.trim(),
            price: Number(item.price),
            url: uploadedFile.path,
            type: item.file.type.startsWith('image') ? 'IMG' : 'VIDEO',
            vendedorId: photographer.id,
            event: normalizedEvent,
            checkpoint: normalizedCheckpoint,
            bib: item.bib.trim(),
            thumbnailUrl: uploadedThumbnail?.path,
            watermarkUrl: uploadedThumbnail?.path,
            storagePath: uploadedFile.path,
            status: 'published'
          });
          publishedCount += 1;
          setPublishProgress({ done: index + 1, total: selectedFiles.length });
        } catch (fileError) {
          const message = fileError instanceof Error ? fileError.message : String(fileError);
          const friendlyMessage = /sess[aã]o expirada/i.test(message)
            ? 'Credencial do bucket expirada ou invalida. Gere um novo BUCKET_API_TOKEN no provedor, atualize o .env/deploy e reinicie o backend.'
            : message;
          failedUploads.push({
            index,
            name: item.name,
            message: formatUploadErrorMessage(friendlyMessage, item.file),
          });
          setPublishProgress({ done: index + 1, total: selectedFiles.length });
        }
      }

      if (publishedCount === 0 && failedUploads.length > 0) {
        throw new Error(`Nenhum arquivo foi publicado. Primeiro erro: ${failedUploads[0].name} - ${failedUploads[0].message}`);
      }

      const updatedProducts = await productService.getVendedorProducts(photographer.id);
      const visibleProducts = updatedProducts.filter((product) => (product.status ?? 'published') !== 'removed');
      setProducts(visibleProducts);
      const dashboard = await photographerDashboardService.getDashboard(photographer.id, visibleProducts);
      setDashboardMetrics(dashboard.metrics);
      setRecentSales(dashboard.recentSales);
      setProductPerformance(dashboard.productPerformance);
      if (failedUploads.length > 0) {
        const failedIndexes = new Set(failedUploads.map((failure) => failure.index));
        setSelectedFiles((current) => current.filter((_, index) => failedIndexes.has(index)));
        setPreviewIndex(0);
        alert(`Upload parcial: ${publishedCount} publicado(s), ${failedUploads.length} falharam. Os arquivos com falha ficaram selecionados para tentar novamente. Primeiro erro: ${failedUploads[0].name} - ${failedUploads[0].message}`);
      } else {
        clearSelectedFiles();
        setPreviewIndex(0);
        setShowUploadModal(false);
        alert(`Upload realizado com sucesso: ${publishedCount} arquivo(s) publicado(s).`);
      }
    } catch (error) {
      console.error("Erro no upload:", error);
      alert(error instanceof Error ? error.message : "Erro ao realizar upload.");
    } finally {
      setIsLoading(false);
      setIsPublishing(false);
    }
  };

  if (isLoading && !isPublishing) {
    return (
      <div className="min-h-screen bg-[#080d14] flex flex-col items-center justify-center p-6">
        <Loader2 className="w-12 h-12 text-brutal-accent animate-spin mb-4" />
        <p className="font-mono text-sm uppercase tracking-widest text-gray-500 animate-pulse">Carregando painel...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#080d14] font-sans text-white overflow-hidden">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-brutal-black text-white border-b-2 border-brutal-black">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 brutal-border overflow-hidden bg-white">
            <img src={photographer.avatar} alt="Me" className="w-full h-full object-cover" />
          </div>
          <span className="font-display text-lg tracking-tighter">STUDIO DASH</span>
        </div>
        <button onClick={onLogout} className="p-2">
          <LogOut className="w-5 h-5 text-brutal-accent" />
        </button>
      </div>

      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-[#05080d] text-white border-r border-white/10 shadow-2xl shadow-black/40">
        <div className="p-8 border-b border-white/10">
          <h1 className="font-sans font-black text-3xl tracking-tight mb-1">STUDIO</h1>
          <p className="font-mono text-[10px] text-brutal-accent uppercase tracking-[0.3em]">Photographer Hub</p>
        </div>

        <nav className="flex-1 p-5 space-y-3">
          <SidebarLink
            icon={<LayoutDashboard />}
            label="Dashboard"
            active={activeTab === 'overview'}
            onClick={() => setActiveTab('overview')}
          />
          <SidebarLink
            icon={<CalendarDays />}
            label="Eventos"
            active={activeTab === 'events'}
            onClick={() => setActiveTab('events')}
          />
          <SidebarLink
            icon={<ImageIcon />}
            label="Meus Produtos"
            active={activeTab === 'products'}
            onClick={() => setActiveTab('products')}
          />
          <SidebarLink
            icon={<DollarSign />}
            label="Ganhos"
            active={activeTab === 'earnings'}
            onClick={() => setActiveTab('earnings')}
          />
        </nav>

        <div className="p-5 mt-auto">
          <div className="bg-white/5 p-4 border border-white/10 mb-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-11 h-11 rounded-full overflow-hidden bg-white border border-white/15">
                <img src={photographer.avatar} alt="Me" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-sans text-sm font-black truncate">{photographer.name}</p>
                <p className="font-mono text-[10px] text-gray-400 truncate tracking-tight">{photographer.email}</p>
              </div>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 py-3 font-mono text-[10px] uppercase font-bold text-gray-400 hover:text-brutal-accent transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sair do Painel
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-5 md:p-8">
        <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 mb-8">
          <div>
            <h2 className="font-sans font-black text-3xl md:text-4xl tracking-normal normal-case mb-2">
              {activeTab === 'overview' && 'Dashboard'}
              {activeTab === 'events' && 'Eventos'}
              {activeTab === 'products' && 'Produtos'}
              {activeTab === 'earnings' && 'Meus Ganhos'}
            </h2>
            <p className="font-sans text-sm text-gray-400">Bem-vindo de volta, {photographer.name.split(' ')[0]}!</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full xl:w-auto">
            <div className="relative" ref={periodMenuRef}>
              <button
                type="button"
                onClick={() => setShowPeriodMenu((current) => !current)}
                className="h-12 px-4 bg-[#0d131c] border border-white/15 flex items-center justify-between sm:justify-start gap-4 min-w-0 sm:min-w-70"
                aria-label="Abrir seletor de periodo"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <CalendarDays className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="font-sans text-sm text-gray-200 truncate">{periodLabel}</span>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
              </button>

              <AnimatePresence>
                {showPeriodMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="absolute right-0 mt-3 w-[min(24rem,100vw)] max-w-full rounded-xl border border-white/10 bg-[#0d131c] p-4 shadow-2xl shadow-black/50 z-20"
                  >
                    <div className="flex flex-wrap gap-2">
                      {PHOTOGRAPHER_PERIOD_OPTIONS.map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            setSelectedPeriod(key);
                            if (key !== 'custom') {
                              setShowPeriodMenu(false);
                            }
                          }}
                          className={`h-10 px-4 border font-sans text-xs font-bold transition-colors ${selectedPeriod === key
                            ? 'bg-brutal-accent/20 border-brutal-accent text-white'
                            : 'bg-white/5 border-white/10 text-gray-300 hover:border-white/30'
                            }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {selectedPeriod === 'custom' && (
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input
                          type="date"
                          value={customPeriodStart}
                          onChange={(event) => setCustomPeriodStart(event.target.value)}
                          className="h-10 px-3 bg-[#080d14] border border-white/15 text-gray-200 font-mono text-xs outline-none focus:border-brutal-accent"
                          aria-label="Data inicial"
                        />
                        <input
                          type="date"
                          value={customPeriodEnd}
                          onChange={(event) => setCustomPeriodEnd(event.target.value)}
                          className="h-10 px-3 bg-[#080d14] border border-white/15 text-gray-200 font-mono text-xs outline-none focus:border-brutal-accent"
                          aria-label="Data final"
                        />
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowNotifications((current) => !current)}
                className="h-12 w-12 bg-[#0d131c] border border-white/15 flex items-center justify-center relative hover:border-white/30 transition-colors cursor-pointer"
                aria-label="Abrir notificacoes"
              >
                <Bell className="w-5 h-5 text-gray-300" />
                {photographerNotifications.length > 0 && (
                  <span className="absolute -right-2 -top-2 h-5 min-w-5 px-1 rounded-full bg-brutal-accent text-white font-sans text-[10px] font-black flex items-center justify-center">
                    {photographerNotifications.length > 9 ? '9+' : photographerNotifications.length}
                  </span>
                )}
              </button>
              {showNotifications && (
                <div className="absolute right-0 top-14 z-50 w-[320px] max-w-[calc(100vw-2rem)] bg-[#0d131c] border border-white/15 shadow-2xl">
                  <div className="p-4 border-b border-white/10">
                    <p className="font-sans font-black text-sm uppercase text-white">Notificacoes</p>
                    <p className="font-mono text-[10px] uppercase text-gray-500">
                      {photographerNotifications.length} item(ns) do painel
                    </p>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {photographerNotifications.length === 0 ? (
                      <div className="p-5 text-center">
                        <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-3" />
                        <p className="font-mono text-[10px] uppercase text-gray-400">Nenhuma notificacao no momento.</p>
                      </div>
                    ) : photographerNotifications.map((notification) => (
                      <button
                        key={notification.id}
                        type="button"
                        onClick={() => {
                          setActiveTab(notification.tab);
                          setShowNotifications(false);
                        }}
                        className="w-full p-4 text-left border-b border-white/10 last:border-b-0 hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        <p className="font-sans font-black text-sm text-white uppercase">{notification.title}</p>
                        <p className="font-mono text-[10px] uppercase text-gray-500 mt-1">{notification.detail}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => setShowUploadModal(true)}
              className="h-12 px-6 bg-brutal-accent text-white border border-brutal-accent flex items-center justify-center gap-3 font-sans text-xs font-black uppercase tracking-wide hover:bg-white hover:text-brutal-accent transition-colors cursor-pointer"
            >
              <Plus className="w-5 h-5" />
              Nova Captura
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-5"
            >
              <div className="bg-[#0d131c] border border-white/10 p-4 flex flex-wrap items-center gap-3">
                <span className="font-mono text-[10px] uppercase tracking-widest text-gray-400 mr-2">Periodo</span>
                {PHOTOGRAPHER_PERIOD_OPTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedPeriod(key)}
                    className={`h-10 px-4 border font-sans text-xs font-bold transition-colors ${selectedPeriod === key
                      ? 'bg-brutal-accent/20 border-brutal-accent text-white'
                      : 'bg-white/5 border-white/10 text-gray-300 hover:border-white/30'
                      }`}
                  >
                    {label}
                  </button>
                ))}
                {selectedPeriod === 'custom' && (
                  <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
                    <input
                      type="date"
                      value={customPeriodStart}
                      onChange={(event) => setCustomPeriodStart(event.target.value)}
                      className="h-10 px-3 bg-[#080d14] border border-white/15 text-gray-200 font-mono text-xs outline-none focus:border-brutal-accent"
                      aria-label="Data inicial"
                    />
                    <input
                      type="date"
                      value={customPeriodEnd}
                      onChange={(event) => setCustomPeriodEnd(event.target.value)}
                      className="h-10 px-3 bg-[#080d14] border border-white/15 text-gray-200 font-mono text-xs outline-none focus:border-brutal-accent"
                      aria-label="Data final"
                    />
                  </div>
                )}
              </div>

              {/* Quick Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
                <StatCard
                  label="Ganhos Totais"
                  value={formatCurrency(periodMetrics.totalEarnings)}
                  icon={<DollarSign />}
                  trend={`${periodMetrics.platformFeePercent}% taxa plataforma`}
                  accent
                />
                <StatCard
                  label="Vendas Realizadas"
                  value={periodMetrics.salesCount}
                  icon={<TrendingUp />}
                  trend={`+${periodMetrics.todaySalesCount} hoje`}
                />
                <StatCard
                  label="Fotos No Ar"
                  value={periodMetrics.publishedMediaCount}
                  icon={<ImageIcon />}
                  trend={`${periodMetrics.photoCount} fotos / ${periodMetrics.videoCount} videos`}
                />
                <StatCard
                  label="Aguardando Resgate"
                  value={formatCurrency(periodMetrics.pendingEarnings)}
                  icon={<AlertCircle />}
                  trend="Liberação em 7 dias"
                  warning
                />
              </div>

              {/* Main Grid: Recent Sales & Top Photos */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                <div className="xl:col-span-2 bg-[#0d131c] border border-white/10">
                  <div className="flex items-center justify-between p-5 border-b border-white/10">
                    <h3 className="font-sans font-black text-base uppercase">Vendas Recentes</h3>
                    <button
                      onClick={() => setActiveTab('earnings')}
                      className="font-mono text-[10px] uppercase text-gray-400 hover:text-white cursor-pointer"
                    >
                      Ver todas
                    </button>
                  </div>
                  <div className="divide-y divide-white/10">
                    {periodSales.length === 0 ? (
                      <div className="p-8 text-center">
                        <p className="font-sans font-black text-xl uppercase">Nenhuma venda paga ainda</p>
                        <p className="font-mono text-[10px] text-gray-400 uppercase tracking-widest mt-2">
                          As vendas aparecem aqui quando o pagamento for confirmado.
                        </p>
                      </div>
                    ) : periodSales.slice(0, 5).map((sale) => (
                      <div key={sale.id} className="p-5 flex items-center gap-4 group hover:bg-white/3 transition-colors">
                        <div className="w-14 h-14 bg-white/5 border border-white/10 overflow-hidden shrink-0">
                          <SaleThumbnail sale={sale} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-sans text-sm font-black truncate">{sale.name}</p>
                          <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest truncate">
                            ID {sale.orderId.substring(0, 8)} - {sale.event}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-sans text-base font-black text-green-400">+ {formatCurrency(sale.netAmount)}</p>
                          <p className="font-mono text-[10px] text-gray-400 uppercase">{formatSaleDate(sale.orderCreatedAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-5">
                  <h3 className="font-sans font-black text-base uppercase">Top Performance</h3>
                  <div className="bg-[#0d131c] text-white p-6 border border-white/10">
                    <div className="flex items-center gap-4 mb-8">
                      <div className="bg-brutal-accent p-3 border border-brutal-accent">
                        <Star className="w-6 h-6 fill-current" />
                      </div>
                      <div>
                        <p className="font-display text-2xl">AVALIAÇÃO</p>
                        <p className="font-mono text-sm text-gray-400">Pela comunidade</p>
                      </div>
                    </div>
                    <div className="space-y-6">
                      <div className="flex justify-between items-end border-b border-white/10 pb-4">
                        <span className="font-mono text-xs uppercase text-gray-400">Score Geral</span>
                        <span className="font-sans text-4xl font-black text-brutal-accent">{dashboardMetrics.rating}</span>
                      </div>
                      <div className="flex justify-between items-end border-b border-white/10 pb-4">
                        <span className="font-mono text-xs uppercase text-gray-400">Downloads</span>
                        <span className="font-sans text-4xl font-black">{dashboardMetrics.downloads}</span>
                      </div>
                      <button
                        onClick={() => setActiveTab('earnings')}
                        className="w-full py-4 mt-4 bg-white text-brutal-black font-sans text-sm font-black uppercase tracking-wide hover:bg-brutal-accent hover:text-white transition-colors cursor-pointer"
                      >
                        Ver Relatório
                      </button>
                    </div>
                  </div>
                  <div className="bg-[#0d131c] border border-white/10">
                    <div className="p-5 border-b border-white/10 flex items-center justify-between">
                      <h3 className="font-sans font-black text-base uppercase">Proximos Eventos</h3>
                      <button onClick={() => setActiveTab('events')} className="font-mono text-[10px] uppercase text-gray-400 hover:text-white">Ver todos</button>
                    </div>
                    <div className="divide-y divide-white/10">
                      {(upcomingEvents.length ? upcomingEvents : [
                        { id: 'event-1', title: 'Ensaio Externo', date: '27 MAI, 2026', time: '16:00' },
                        { id: 'event-2', title: 'Casamento', date: '01 JUN, 2026', time: '14:00' },
                        { id: 'event-3', title: 'Aniversario', date: '05 JUN, 2026', time: '18:00' },
                      ]).map((event) => (
                        <div key={event.id} className="p-4 flex items-center gap-3">
                          <div className="w-10 h-10 rounded bg-brutal-accent/15 border border-brutal-accent/20 flex items-center justify-center">
                            <CalendarDays className="w-5 h-5 text-brutal-accent" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-sans text-sm font-black truncate">{event.title}</p>
                            <p className="font-mono text-[10px] text-gray-500 uppercase">{event.date} - {event.time}</p>
                          </div>
                          <span className="px-3 py-1 rounded border border-purple-400/30 bg-purple-400/10 font-mono text-[9px] text-purple-200 uppercase">
                            {'isPublished' in event && event.isPublished === false ? 'Oculto' : 'Publicado'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'events' && (
            <motion.div
              key="events"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-5"
            >
              <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-5">
                <div className="bg-[#0d131c] border border-white/10 p-5 md:p-6">
                  <div className="flex items-start justify-between gap-4 mb-6">
                    <div>
                      <h3 className="font-sans font-black text-base uppercase text-white">
                        {eventForm.id ? 'Editar evento' : 'Novo evento'}
                      </h3>
                      <p className="font-mono text-[10px] uppercase text-gray-500 mt-1">
                        Eventos organizam uploads, precos e publicacao.
                      </p>
                    </div>
                    {eventForm.id && (
                      <button
                        type="button"
                        onClick={resetEventForm}
                        className="h-10 px-3 border border-white/15 text-gray-300 font-mono text-[10px] uppercase hover:text-white"
                      >
                        Novo
                      </button>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Nome do evento</label>
                      <input
                        type="text"
                        value={eventForm.name}
                        onChange={(event) => setEventForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Ex: Maratona Manaus 2026"
                        className="w-full h-12 px-4 bg-[#05080d] border border-white/15 text-white placeholder:text-gray-600 font-mono text-xs uppercase outline-none focus:border-brutal-accent"
                      />
                    </div>

                    <div>
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Data</label>
                      <input
                        type="date"
                        value={eventForm.date}
                        onChange={(event) => setEventForm((current) => ({ ...current, date: event.target.value }))}
                        className="w-full h-12 px-4 bg-[#05080d] border border-white/15 text-white font-mono text-xs outline-none focus:border-brutal-accent"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Local</label>
                        <input
                          type="text"
                          value={eventForm.location}
                          onChange={(event) => setEventForm((current) => ({ ...current, location: event.target.value }))}
                          placeholder="Cidade / local"
                          className="w-full h-12 px-4 bg-[#05080d] border border-white/15 text-white placeholder:text-gray-600 font-mono text-xs uppercase outline-none focus:border-brutal-accent"
                        />
                      </div>
                      <div>
                        <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Checkpoint padrao</label>
                        <input
                          type="text"
                          value={eventForm.checkpoint}
                          onChange={(event) => setEventForm((current) => ({ ...current, checkpoint: event.target.value }))}
                          placeholder="Chegada, KM 10..."
                          className="w-full h-12 px-4 bg-[#05080d] border border-white/15 text-white placeholder:text-gray-600 font-mono text-xs uppercase outline-none focus:border-brutal-accent"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Descricao</label>
                      <textarea
                        value={eventForm.description}
                        onChange={(event) => setEventForm((current) => ({ ...current, description: event.target.value }))}
                        rows={3}
                        placeholder="Resumo para equipe e publicacao"
                        className="w-full px-4 py-3 bg-[#05080d] border border-white/15 text-white placeholder:text-gray-600 font-mono text-xs uppercase outline-none focus:border-brutal-accent resize-none"
                      />
                    </div>

                    <div className="bg-[#080d14] border border-white/10 p-4">
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div>
                          <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Capa do evento</label>
                          <p className="font-mono text-[10px] uppercase text-gray-600">
                            Escolha uma midia ja enviada neste evento.
                          </p>
                        </div>
                        {eventForm.coverImage && (
                          <button
                            type="button"
                            onClick={() => setEventForm((current) => ({ ...current, coverImage: '' }))}
                            className="shrink-0 h-9 px-3 border border-white/15 text-gray-300 font-mono text-[10px] uppercase hover:text-white hover:border-brutal-accent"
                          >
                            Remover capa
                          </button>
                        )}
                      </div>

                      {eventForm.coverImage && (
                        <div className="mb-4">
                          <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-gray-500">Capa atual</p>
                          <div className="aspect-video max-w-sm bg-[#05080d] border border-brutal-accent overflow-hidden">
                            {eventForm.coverImage.match(/\.(mp4|webm|mov)(\?|$)/i) ? (
                              <video src={eventForm.coverImage} className="w-full h-full object-cover" muted preload="metadata" />
                            ) : (
                              <img src={eventForm.coverImage} alt="Capa atual do evento" className="w-full h-full object-cover" />
                            )}
                          </div>
                        </div>
                      )}

                      {eventCoverCandidates.length > 0 ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {eventCoverCandidates.map((product) => {
                            const coverUrl = product.thumbnailUrl || product.url;
                            const isSelected = eventForm.coverImage === coverUrl;
                            return (
                              <button
                                key={product.id}
                                type="button"
                                onClick={() => setEventForm((current) => ({ ...current, coverImage: coverUrl }))}
                                className={`group text-left bg-[#05080d] border overflow-hidden transition-colors ${isSelected ? 'border-brutal-accent ring-1 ring-brutal-accent' : 'border-white/10 hover:border-brutal-accent/70'
                                  }`}
                              >
                                <div className="aspect-video bg-black overflow-hidden">
                                  {coverUrl.match(/\.(mp4|webm|mov)(\?|$)/i) ? (
                                    <video src={coverUrl} className="w-full h-full object-cover transition-transform group-hover:scale-105" muted preload="metadata" />
                                  ) : (
                                    <img src={coverUrl} alt={product.name} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                                  )}
                                </div>
                                <div className="p-2">
                                  <p className="font-mono text-[9px] uppercase text-gray-400 truncate">{product.name}</p>
                                  <p className="font-mono text-[8px] uppercase text-gray-600">{isSelected ? 'Capa selecionada' : 'Usar como capa'}</p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="border border-dashed border-white/10 p-4 text-center">
                          <ImageIcon className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                          <p className="font-mono text-[10px] uppercase text-gray-500">
                            Envie fotos para este evento e depois escolha uma capa aqui.
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Status operacional</label>
                        <select
                          value={eventForm.status}
                          onChange={(event) => setEventForm((current) => ({ ...current, status: event.target.value as Event['status'] }))}
                          className="w-full h-12 px-4 bg-[#05080d] border border-white/15 text-white font-mono text-xs uppercase outline-none focus:border-brutal-accent"
                        >
                          <option value="scheduled">Agendado</option>
                          <option value="active">Ativo</option>
                          <option value="closed">Fechado</option>
                        </select>
                      </div>
                      <label className="h-12 mt-6 px-4 bg-[#05080d] border border-white/15 flex items-center justify-between gap-3 cursor-pointer">
                        <span className="font-mono text-[10px] uppercase text-gray-300">Publicado na operacao</span>
                        <input
                          type="checkbox"
                          checked={eventForm.isPublished}
                          onChange={(event) => setEventForm((current) => ({ ...current, isPublished: event.target.checked }))}
                          className="h-5 w-5 accent-brutal-accent"
                        />
                      </label>
                    </div>

                    {eventError && (
                      <div className="border border-red-400/30 bg-red-500/10 p-3 font-mono text-[10px] uppercase text-red-200">
                        {eventError}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleSaveEvent}
                      disabled={isSavingEvent}
                      className="w-full h-14 bg-brutal-accent text-white border border-brutal-accent font-sans font-black text-sm uppercase tracking-widest hover:bg-white hover:text-brutal-accent transition-colors disabled:bg-gray-700 disabled:border-gray-700 disabled:text-gray-400"
                    >
                      {isSavingEvent ? 'Salvando...' : eventForm.id ? 'Salvar evento' : 'Criar evento'}
                    </button>
                  </div>
                </div>

                <div className="bg-[#0d131c] border border-white/10">
                  <div className="p-5 border-b border-white/10 flex items-center justify-between gap-4">
                    <div>
                      <h3 className="font-sans font-black text-base uppercase text-white">Eventos do fotografo</h3>
                      <p className="font-mono text-[10px] uppercase text-gray-500">{availableEvents.length} evento(s) cadastrados</p>
                    </div>
                    <CalendarDays className="w-5 h-5 text-gray-500" />
                  </div>

                  {availableEvents.length === 0 ? (
                    <div className="m-5 p-10 text-center bg-[#080d14] border border-white/10">
                      <CalendarDays className="w-10 h-10 text-gray-600 mx-auto mb-4" />
                      <p className="font-sans font-black text-xl uppercase text-white">Nenhum evento criado</p>
                      <p className="font-mono text-[10px] uppercase text-gray-500 mt-2">Crie o primeiro evento para organizar seus uploads.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-white/10">
                      {availableEvents.map((eventItem) => {
                        const eventProducts = products.filter((product) => product.event === eventItem.name);
                        const eventRevenue = periodSales
                          .filter((sale) => sale.event === eventItem.name)
                          .reduce((total, sale) => total + Number(sale.netAmount || 0), 0);
                        return (
                          <div key={eventItem.id} className="p-5 grid gap-4">
                            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                  <span className={`px-2 py-1 font-mono text-[8px] uppercase border ${eventItem.isPublished === false ? 'border-yellow-400/30 bg-yellow-400/10 text-yellow-200' : 'border-green-400/30 bg-green-400/10 text-green-200'}`}>
                                    {eventItem.isPublished === false ? 'Oculto' : 'Publicado'}
                                  </span>
                                  <span className="px-2 py-1 font-mono text-[8px] uppercase border border-white/10 text-gray-300">
                                    {eventItem.status}
                                  </span>
                                </div>
                                <p className="font-sans font-black text-lg uppercase text-white truncate">{eventItem.name}</p>
                                <p className="font-mono text-[10px] uppercase text-gray-500 truncate">
                                  {eventItem.date} - {eventItem.location || eventItem.checkpoint || 'Sem local'}
                                </p>
                                {eventItem.description && (
                                  <p className="font-sans text-sm text-gray-400 mt-2 line-clamp-2">{eventItem.description}</p>
                                )}
                              </div>
                              <div className="flex md:flex-col gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleEditEvent(eventItem)}
                                  className="h-10 px-3 border border-white/15 text-white font-mono text-[10px] uppercase hover:border-brutal-accent"
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleEventPublication(eventItem)}
                                  className="h-10 px-3 border border-white/15 text-gray-300 font-mono text-[10px] uppercase hover:text-white"
                                >
                                  {eventItem.isPublished === false ? 'Publicar' : 'Ocultar'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveEvent(eventItem)}
                                  className="h-10 px-3 border border-red-500/40 text-red-200 font-mono text-[10px] uppercase hover:bg-red-500/10"
                                >
                                  Excluir
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div className="bg-[#080d14] border border-white/10 p-3">
                                <p className="font-mono text-[9px] uppercase text-gray-500">Fotos/videos</p>
                                <p className="font-sans font-black text-2xl text-white">{eventProducts.length}</p>
                              </div>
                              <div className="bg-[#080d14] border border-white/10 p-3">
                                <p className="font-mono text-[9px] uppercase text-gray-500">Receita periodo</p>
                                <p className="font-sans font-black text-2xl text-green-400">{formatCurrency(eventRevenue)}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'products' && (
            <motion.div
              key="products"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-5"
            >
              <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Publicados</p>
                  <p className="font-sans font-black text-3xl text-white">{visibleProductStats.total}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">Produtos ativos</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Fotos</p>
                  <p className="font-sans font-black text-3xl text-brutal-accent">{visibleProductStats.photos}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">Imagens no catalogo</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Videos</p>
                  <p className="font-sans font-black text-3xl text-yellow-400">{visibleProductStats.videos}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">Clipes e highlights</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Rascunhos</p>
                  <p className="font-sans font-black text-3xl text-gray-300">{visibleProductStats.drafts}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">Aguardando publicacao</p>
                </div>
              </div>

              <div className="bg-[#0d131c] border border-white/10 p-4 flex flex-col xl:flex-row gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                    placeholder="Buscar por nome, evento, checkpoint, peito ou ID"
                    className="w-full h-12 pl-12 pr-4 bg-[#080d14] border border-white/15 text-white placeholder:text-gray-600 font-mono text-xs outline-none focus:border-brutal-accent transition-colors"
                  />
                </div>
                <div className="grid grid-cols-2 md:flex gap-3">
                  <div className="relative">
                    <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
                    <select
                      value={productTypeFilter}
                      onChange={(event) => setProductTypeFilter(event.target.value as ProductTypeFilter)}
                      className="w-full md:w-44 h-12 pl-10 pr-4 bg-[#080d14] border border-white/15 text-gray-200 font-mono text-xs uppercase outline-none focus:border-brutal-accent"
                    >
                      <option value="all">Todos tipos</option>
                      <option value="IMG">Fotos</option>
                      <option value="VIDEO">Videos</option>
                      <option value="VIEW">Views</option>
                    </select>
                  </div>
                  <select
                    value={productStatusFilter}
                    onChange={(event) => setProductStatusFilter(event.target.value as ProductStatusFilter)}
                    className="w-full md:w-44 h-12 px-4 bg-[#080d14] border border-white/15 text-gray-200 font-mono text-xs uppercase outline-none focus:border-brutal-accent"
                  >
                    <option value="all">Ativos</option>
                    <option value="published">Publicado</option>
                    <option value="draft">Rascunho</option>
                    <option value="pending">Pendente</option>
                    <option value="processing">Processando</option>
                    <option value="hidden">Oculto</option>
                    <option value="sold">Vendido</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <h3 className="font-sans font-black text-base uppercase text-white">Catalogo publicado</h3>
                  <p className="font-mono text-[10px] uppercase text-gray-500">
                    {filteredProducts.length} de {products.length} produtos encontrados
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={toggleAllFilteredProducts}
                    disabled={filteredProducts.length === 0 || isBulkRemovingProducts}
                    className="min-h-10 px-4 border border-white/15 bg-[#0d131c] text-white font-mono text-[10px] uppercase font-bold hover:border-brutal-accent disabled:text-gray-600 disabled:cursor-not-allowed"
                  >
                    {allFilteredProductsSelected ? 'Desmarcar filtrados' : 'Selecionar filtrados'}
                  </button>
                  {selectedProducts.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setSelectedProductIds(new Set())}
                        disabled={isBulkRemovingProducts}
                        className="min-h-10 px-4 border border-white/15 text-gray-300 font-mono text-[10px] uppercase font-bold hover:text-white disabled:text-gray-600"
                      >
                        Limpar selecao ({selectedProducts.length})
                      </button>
                      <button
                        type="button"
                        onClick={handleBulkRemoveProducts}
                        disabled={isBulkRemovingProducts}
                        className="min-h-10 px-4 bg-red-600 text-white border border-red-600 font-mono text-[10px] uppercase font-bold hover:bg-white hover:text-red-600 disabled:bg-gray-700 disabled:border-gray-700 disabled:text-gray-400"
                      >
                        {isBulkRemovingProducts ? 'Removendo...' : `Remover ${selectedProducts.length} da vitrine`}
                      </button>
                    </>
                  )}
                  {(productSearch || productTypeFilter !== 'all' || productStatusFilter !== 'all') && (
                    <button
                      onClick={() => {
                        setProductSearch('');
                        setProductTypeFilter('all');
                        setProductStatusFilter('all');
                        setSelectedProductEventName('');
                      }}
                      className="font-mono text-[10px] uppercase font-bold text-brutal-accent hover:text-white transition-colors cursor-pointer"
                    >
                      Limpar filtros
                    </button>
                  )}
                </div>
              </div>

              {productEventCards.length > 0 ? (
                <div className="space-y-8">
                  <div className="space-y-4">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-12 h-0.5 bg-brutal-accent" />
                          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-brutal-accent font-bold">
                            Escolha o evento
                          </p>
                        </div>
                        <h3 className="font-sans font-black text-3xl md:text-5xl uppercase text-white">Eventos</h3>
                        <p className="font-mono text-xs uppercase tracking-widest text-gray-500 mt-2">
                          Fotos e videos com coberturas mais recentes primeiro.
                        </p>
                      </div>
                      {selectedProductEventName && (
                        <button
                          type="button"
                          onClick={() => setSelectedProductEventName('')}
                          className="min-h-10 px-4 border border-white/15 text-gray-300 font-mono text-[10px] uppercase font-bold hover:text-white hover:border-brutal-accent"
                        >
                          Ver todos eventos
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                      {productEventCards.map((eventItem) => {
                        const isActive = selectedProductEventName === eventItem.name;
                        return (
                          <div
                            key={eventItem.name}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedProductEventName((current) => current === eventItem.name ? '' : eventItem.name)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setSelectedProductEventName((current) => current === eventItem.name ? '' : eventItem.name);
                              }
                            }}
                            className={`group bg-white text-brutal-black border-2 overflow-hidden text-left transition-all ${isActive ? 'border-brutal-accent ring-2 ring-brutal-accent/40' : 'border-brutal-black hover:border-brutal-accent'
                              }`}
                          >
                            <div className="relative aspect-4/3 bg-brutal-black overflow-hidden border-b-2 border-brutal-black">
                              {eventItem.coverUrl ? (
                                eventItem.coverUrl.match(/\.(mp4|webm|mov)(\?|$)/i) ? (
                                  <video src={eventItem.coverUrl} className="w-full h-full object-cover opacity-85 group-hover:scale-105 transition-transform duration-500" muted preload="metadata" />
                                ) : (
                                  <img src={eventItem.coverUrl} alt={eventItem.name} className="w-full h-full object-cover opacity-85 group-hover:scale-105 transition-transform duration-500" />
                                )
                              ) : (
                                <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                                  <CalendarDays className="w-14 h-14 text-gray-300" />
                                </div>
                              )}
                              <div className="absolute inset-0 bg-linear-to-t from-brutal-black/80 via-transparent to-transparent" />
                              <div className="absolute top-4 left-4 bg-brutal-accent text-white px-3 py-1 border-2 border-brutal-black font-mono text-[10px] uppercase font-bold tracking-widest">
                                {eventItem.dateLabel}
                              </div>
                              <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-2">
                                <span className="inline-flex items-center gap-1 bg-white text-brutal-black px-2 py-1 border-2 border-brutal-black font-mono text-[10px] uppercase font-bold">
                                  <ImageIcon className="w-3 h-3" />
                                  {eventItem.photos}
                                </span>
                                <span className="inline-flex items-center gap-1 bg-white text-brutal-black px-2 py-1 border-2 border-brutal-black font-mono text-[10px] uppercase font-bold">
                                  <VideoIcon className="w-3 h-3" />
                                  {eventItem.videos}
                                </span>
                              </div>
                            </div>

                            <div className="p-5">
                              <div className="flex items-center gap-2 text-gray-500 mb-3">
                                <MapPin className="w-4 h-4 text-brutal-accent shrink-0" />
                                <p className="font-mono text-[10px] uppercase tracking-widest truncate">
                                  {eventItem.checkpoint}
                                </p>
                              </div>
                              <h4 className="font-display text-xl uppercase leading-tight min-h-12">
                                {eventItem.name}
                              </h4>
                              <div className="mt-5 pt-4 border-t border-gray-100 flex flex-col gap-3">
                                <p className="font-mono text-[10px] uppercase tracking-widest text-gray-400">
                                  {eventItem.items} midias
                                </p>
                                <p className="font-mono text-[9px] uppercase tracking-widest text-gray-400">
                                  {eventItem.createdAtLabel === 'Criacao nao registrada' ? eventItem.createdAtLabel : `Criado em ${eventItem.createdAtLabel}`}
                                </p>
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <button
                                    type="button"
                                    onClick={(clickEvent) => {
                                      clickEvent.stopPropagation();
                                      openUploadForEvent(eventItem.name);
                                    }}
                                    className="inline-flex min-h-9 items-center gap-2 bg-brutal-black px-3 text-white border-2 border-brutal-black font-mono text-[10px] uppercase font-bold hover:bg-brutal-accent hover:border-brutal-accent transition-colors"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                    Adicionar fotos
                                  </button>
                                  <span className="font-display text-sm uppercase text-brutal-accent">
                                    {isActive ? 'Selecionado' : 'Ver evento'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {visibleGroupedProducts.map(({ eventName, products: groupProducts }) => (
                    <div key={eventName} className="space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 p-4 bg-[#0b1016] border border-white/10">
                        <div>
                          <p className="font-sans font-black text-sm uppercase text-white truncate">{eventName}</p>
                          <p className="font-mono text-[10px] uppercase text-gray-500 mt-1">{groupProducts.length} produto(s) neste evento</p>
                        </div>
                        <div className="text-right">
                          {eventName !== 'Geral' && availableEvents.find((eventItem) => eventItem.name === eventName) && (
                            <p className="font-mono text-[10px] uppercase text-gray-400">
                              {availableEvents.find((eventItem) => eventItem.name === eventName)?.date || ''}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
                        {groupProducts.map((product) => {
                          const isSelected = selectedProductIds.has(product.id);
                          return (
                            <div key={product.id} className={`group bg-[#0d131c] border overflow-hidden transition-colors ${isSelected ? 'border-brutal-accent ring-2 ring-brutal-accent/40' : 'border-white/10 hover:border-brutal-accent/70'
                              }`}>
                              <div className="aspect-4/5 relative bg-[#080d14]">
                                {product.type === 'IMG' ? (
                                  <img src={product.thumbnailUrl || product.url} alt={product.name} className="w-full h-full object-cover transition-all duration-500 group-hover:scale-[1.03]" />
                                ) : product.thumbnailUrl ? (
                                  <img src={product.thumbnailUrl} alt={product.name} className="w-full h-full object-cover transition-all duration-500 group-hover:scale-[1.03]" />
                                ) : (
                                  <video src={product.url} poster={product.thumbnailUrl} className="w-full h-full object-cover transition-all duration-500 group-hover:scale-[1.03]" muted preload="metadata" />
                                )}
                                <div className="absolute inset-x-0 top-0 z-20 p-3 flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        toggleProductSelection(product.id);
                                      }}
                                      className={`h-8 w-8 border flex items-center justify-center transition-colors ${isSelected ? 'bg-brutal-accent border-brutal-accent text-white' : 'bg-[#05080d]/90 border-white/15 text-white hover:border-brutal-accent'
                                        }`}
                                      aria-label={isSelected ? 'Desmarcar produto' : 'Selecionar produto'}
                                    >
                                      {isSelected ? <CheckCircle2 className="w-4 h-4" /> : <span className="h-3.5 w-3.5 border border-current" />}
                                    </button>
                                    <span className="bg-[#05080d]/90 text-white px-2 py-1 font-mono text-[8px] uppercase tracking-widest border border-white/10">
                                      {product.type}
                                    </span>
                                  </div>
                                  <div className="flex flex-col items-end gap-1">
                                    <span className="bg-brutal-accent text-white px-2 py-1 font-mono text-[8px] uppercase tracking-widest">
                                      {formatCurrency(product.price)}
                                    </span>
                                    {(product.status ?? 'published') !== 'published' && (
                                      <span className="bg-yellow-500/90 text-black px-2 py-1 font-mono text-[8px] uppercase tracking-widest">
                                        {product.status}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="absolute inset-0 z-10 bg-black/65 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-all">
                                  <p className="text-white font-sans font-black text-sm uppercase mb-4 text-center px-4">{product.name}</p>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => openEditModal(product)}
                                      className="bg-white text-brutal-black p-2 border border-white hover:bg-brutal-accent hover:text-white hover:border-brutal-accent transition-colors cursor-pointer"
                                      title="Editar produto"
                                    >
                                      <Settings className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => handleRemoveProduct(product)}
                                      className="bg-white text-brutal-black p-2 border border-white hover:bg-red-600 hover:text-white hover:border-red-600 transition-colors cursor-pointer"
                                      title="Remover produto"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                              <div className="p-4 space-y-3">
                                <div>
                                  <p className="font-sans font-black text-sm uppercase text-white truncate">{product.name}</p>
                                  <p className="font-mono text-[10px] uppercase text-gray-500 truncate">{product.event || 'Geral'} - {product.checkpoint || 'Ponto principal'}</p>
                                </div>
                                <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase">
                                  <span className="text-gray-500">Peito {product.bib || 'N/I'}</span>
                                  <span className={(product.status ?? 'published') === 'published' ? 'text-green-400' : 'text-yellow-400'}>
                                    {product.status ?? 'published'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-[#0d131c] border border-white/10 p-10 text-center">
                  <Search className="w-10 h-10 text-gray-600 mx-auto mb-4" />
                  <h3 className="font-sans font-black text-xl uppercase text-white mb-2">Nenhum produto encontrado</h3>
                  <p className="font-mono text-xs uppercase text-gray-500">Ajuste os filtros ou limpe a busca para ver todo o catalogo.</p>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'earnings' && (
            <motion.div
              key="earnings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-5"
            >
              <div className="bg-[#0d131c] text-white border border-white/10 p-5 md:p-7 flex flex-col xl:flex-row justify-between gap-6">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Saldo disponivel para repasse</p>
                  <p className="font-sans font-black text-5xl md:text-6xl text-brutal-accent leading-none">
                    {formatCurrency(dashboardMetrics.availableBalance)}
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mt-4">
                    Vendas pagas liberadas, descontando saques pendentes e pagos.
                  </p>
                  {dashboardMetrics.availableBalance <= 0 && dashboardMetrics.pendingEarnings > 0 && (
                    <p className="font-mono text-[10px] uppercase tracking-widest text-yellow-400 mt-2">
                      {formatCurrency(dashboardMetrics.pendingEarnings)} aguardando liberação em 7 dias
                    </p>
                  )}
                </div>
                <div className="w-full xl:w-[320px] bg-[#080d14] border border-white/10 p-4">
                  <button
                    disabled={dashboardMetrics.availableBalance <= 0}
                    onClick={() => setShowWithdrawalModal(true)}
                    className="w-full h-14 bg-brutal-accent text-white border border-brutal-accent font-sans font-black text-sm uppercase tracking-widest hover:bg-white hover:text-brutal-accent transition-colors cursor-pointer disabled:bg-gray-700 disabled:border-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    Solicitar Saque
                  </button>
                  <p className="font-mono text-center text-[10px] text-gray-500 mt-4 uppercase tracking-widest">Vendas recentes liberam apos 7 dias</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Ganhos totais</p>
                  <p className="font-sans font-black text-3xl text-white">{formatCurrency(periodMetrics.totalEarnings)}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">{periodMetrics.salesCount} venda(s)</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">A liberar</p>
                  <p className="font-sans font-black text-3xl text-yellow-400">{formatCurrency(periodMetrics.pendingEarnings)}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">Janela de 7 dias</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Saques em aberto</p>
                  <p className="font-sans font-black text-3xl text-brutal-accent">{formatCurrency(pendingWithdrawalTotal)}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">Pendentes/aprovados</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Ja pago</p>
                  <p className="font-sans font-black text-3xl text-green-400">{formatCurrency(paidWithdrawalTotal)}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">Historico recebido</p>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-5">
                <div className="bg-[#0d131c] border border-white/10">
                  <div className="p-5 border-b border-white/10 flex items-center justify-between">
                    <div>
                      <h3 className="font-sans font-black text-base uppercase text-white">Historico Financeiro</h3>
                      <p className="font-mono text-[10px] uppercase text-gray-500">Vendas confirmadas e solicitacoes de saque</p>
                    </div>
                    <DollarSign className="w-5 h-5 text-gray-500" />
                  </div>
                  <div className="p-5 space-y-6">
                    {periodWithdrawals.length > 0 && (
                      <div className="space-y-3">
                        <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">Solicitacoes de saque</p>
                        {periodWithdrawals.slice(0, 4).map((withdrawal) => (
                          <div key={withdrawal.id} className="flex justify-between items-center gap-4 p-3 bg-[#080d14] border border-white/10">
                            <div className="min-w-0">
                              <p className="font-sans font-black text-sm uppercase text-white truncate">Saque {withdrawalStatusLabels[withdrawal.status]}</p>
                              <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest truncate">
                                Pix: {withdrawal.pixKey} - {formatSaleDate(withdrawal.createdAt)}
                              </p>
                            </div>
                            <p className={`font-sans font-black text-lg shrink-0 ${withdrawal.status === 'rejected' || withdrawal.status === 'cancelled' ? 'text-red-300' : 'text-brutal-accent'
                              }`}>
                              - {formatCurrency(Number(withdrawal.amount))}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                    {periodSales.length === 0 ? (
                      <div className="py-8 text-center">
                        <p className="font-sans font-black text-xl uppercase text-white">Nenhuma venda paga ainda</p>
                        <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest mt-2">
                          As movimentacoes aparecem quando pagamentos forem confirmados.
                        </p>
                      </div>
                    ) : periodSales.map((sale) => (
                      <div key={sale.id} className="flex justify-between items-center gap-4 py-4 border-b border-white/10 last:border-0">
                        <div className="min-w-0">
                          <p className="font-sans font-black text-sm uppercase text-white truncate">Venda Confirmada</p>
                          <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest">
                            Pedido #{sale.orderId.substring(0, 8)} - {sale.event}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-sans font-black text-lg text-green-400">+ {formatCurrency(sale.netAmount)}</p>
                          <p className="font-mono text-[10px] text-gray-500 uppercase">{formatSaleDate(sale.orderCreatedAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-[#0d131c] border border-white/10 p-6 flex flex-col justify-center text-center">
                  <div className="mx-auto w-14 h-14 bg-brutal-accent/15 border border-brutal-accent/20 flex items-center justify-center mb-5">
                    <TrendingUp className="w-7 h-7 text-brutal-accent" />
                  </div>
                  <h3 className="font-sans font-black text-xl uppercase text-white mb-4">Meta Mensal</h3>
                  <div className="w-full h-3 bg-[#080d14] border border-white/10 mb-4 overflow-hidden">
                    <div
                      className="h-full bg-brutal-accent"
                      style={{ width: `${monthlyGoalPercent}%` }}
                    />
                  </div>
                  <p className="font-mono text-sm text-gray-400">
                    Voce atingiu <span className="font-bold text-white">{monthlyGoalPercent}%</span> da sua meta de <span className="font-bold text-white">{formatCurrency(periodMetrics.monthlyGoal)}</span>
                  </p>
                  <p className="font-mono text-[10px] uppercase text-gray-500 tracking-widest mt-3">
                    Receita do periodo no mes atual: {formatCurrency(periodMetrics.monthlyEarnings)}
                  </p>
                </div>
              </div>

              <div className="bg-[#0d131c] border border-white/10">
                <div className="p-5 border-b border-white/10 flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div>
                    <h3 className="font-sans font-black text-base uppercase text-white">Performance por Produto</h3>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mt-1">
                      Ranking por receita liquida, vendas pagas e downloads reais.
                    </p>
                  </div>
                  <span className="font-mono text-[10px] uppercase text-gray-500">{periodProductPerformance.length} itens</span>
                </div>

                {periodProductPerformance.length === 0 ? (
                  <div className="m-5 py-10 text-center bg-[#080d14] border border-white/10">
                    <p className="font-sans font-black text-xl uppercase text-white">Sem performance registrada</p>
                    <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest mt-2">
                      Produtos aparecem aqui depois das primeiras vendas pagas.
                    </p>
                  </div>
                ) : (
                  <div className="p-5 space-y-3">
                    {periodProductPerformance.map((item, index) => (
                      <div key={item.productId} className="grid grid-cols-[auto_56px_1fr_auto] items-center gap-4 p-3 bg-[#080d14] border border-white/10">
                        <span className="font-sans font-black text-xl text-brutal-accent w-8">#{index + 1}</span>
                        <div className="w-14 h-14 bg-white/5 border border-white/10 overflow-hidden">
                          {item.thumbnailUrl ? (
                            <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center font-mono text-[9px] text-gray-500">{item.type}</div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-sans font-black text-sm text-white truncate">{item.name}</p>
                          <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest truncate">
                            Peito {item.bib || 'N/I'} - {item.event}
                          </p>
                          <p className="font-mono text-[10px] text-gray-600 uppercase mt-1">
                            {item.salesCount} venda(s) - {item.downloads} download(s)
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-sans font-black text-lg text-green-400">{formatCurrency(item.netRevenue)}</p>
                          <p className="font-mono text-[9px] uppercase text-gray-500">liquido</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-[#0d131c] border border-white/10">
                <div className="p-5 border-b border-white/10 flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div>
                    <h3 className="font-sans font-black text-base uppercase text-white">Fotos mais vendidas</h3>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mt-1">
                      Ranking por quantidade de vendas pagas no periodo.
                    </p>
                  </div>
                  <span className="font-mono text-[10px] uppercase text-gray-500">{periodTopPhotoPerformance.length} fotos</span>
                </div>

                {periodTopPhotoPerformance.length === 0 ? (
                  <div className="m-5 py-10 text-center bg-[#080d14] border border-white/10">
                    <p className="font-sans font-black text-xl uppercase text-white">Sem fotos vendidas</p>
                    <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest mt-2">
                      Fotos entram no ranking depois das primeiras vendas pagas.
                    </p>
                  </div>
                ) : (
                  <div className="p-5 grid gap-3">
                    {periodTopPhotoPerformance.map((item, index) => (
                      <div key={item.productId} className="grid grid-cols-[auto_64px_1fr_auto] items-center gap-4 p-3 bg-[#080d14] border border-white/10">
                        <span className="font-sans font-black text-xl text-brutal-accent w-8">#{index + 1}</span>
                        <div className="w-16 h-16 bg-white/5 border border-white/10 overflow-hidden">
                          {item.thumbnailUrl ? (
                            <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <ImageIcon className="w-5 h-5 text-gray-600" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-sans font-black text-sm text-white truncate">{item.name}</p>
                          <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest truncate">
                            Peito {item.bib || 'N/I'} - {item.event}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-sans font-black text-lg text-green-400">{item.salesCount} venda(s)</p>
                          <p className="font-mono text-[9px] uppercase text-gray-500">{formatCurrency(item.netRevenue)} liquido</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {showWithdrawalModal && (
          <div className="fixed inset-0 z-100 flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowWithdrawalModal(false)}
              className="absolute inset-0 bg-brutal-black/90 backdrop-blur-sm"
            />

            <motion.div
              initial={{ scale: 0.92, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.92, y: 20 }}
              className="relative w-full max-w-xl bg-brutal-white brutal-border brutal-shadow-heavy p-8 space-y-6"
            >
              <button
                onClick={() => setShowWithdrawalModal(false)}
                className="absolute right-4 top-4 p-2 text-gray-400 hover:text-brutal-black transition-colors cursor-pointer"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>

              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-gray-400 mb-2">Repasse financeiro</p>
                <h3 className="font-display text-4xl uppercase tracking-tighter">Solicitar Saque</h3>
                <p className="font-mono text-xs uppercase leading-relaxed text-gray-500 mt-3">
                  A solicitacao fica pendente para processamento manual pela equipe Funpace.
                </p>
              </div>

              <div className="bg-brutal-black text-white brutal-border p-5">
                <p className="font-mono text-[10px] uppercase tracking-widest text-gray-400">Valor solicitado</p>
                <p className="font-display text-5xl text-brutal-accent mt-1">{formatCurrency(dashboardMetrics.availableBalance)}</p>
              </div>

              <div>
                <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Chave Pix para recebimento</label>
                <input
                  type="text"
                  value={withdrawalPixKey}
                  onChange={(event) => setWithdrawalPixKey(event.target.value)}
                  placeholder="CPF, e-mail, telefone ou chave aleatoria"
                  className="w-full h-14 px-4 bg-white brutal-border font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brutal-accent"
                />
              </div>

              {withdrawalError && (
                <div className="bg-red-50 brutal-border-thin p-4 font-mono text-xs uppercase text-red-600">
                  {withdrawalError}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleWithdrawalRequest}
                  disabled={isRequestingWithdrawal}
                  className="h-14 flex-1 bg-brutal-black text-white brutal-border font-display text-sm uppercase tracking-widest hover:bg-brutal-accent transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  {isRequestingWithdrawal && <Loader2 className="w-5 h-5 animate-spin" />}
                  Confirmar Solicitação
                </button>
                <button
                  onClick={() => setShowWithdrawalModal(false)}
                  className="h-14 px-6 bg-white text-brutal-black brutal-border font-display text-sm uppercase tracking-widest hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Product Modal */}
      <AnimatePresence>
        {editingProduct && (
          <div className="fixed inset-0 z-100 flex items-center justify-center p-4 md:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeEditModal}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />

            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="relative w-full max-w-3xl bg-brutal-white brutal-border brutal-shadow-heavy overflow-hidden max-h-[90vh]"
            >
              <div className="grid md:grid-cols-[280px_1fr]">
                <div className="bg-brutal-black p-6">
                  <div className="aspect-3/4 bg-black brutal-border overflow-hidden">
                    {editingProduct.type === 'IMG' ? (
                      <img src={editingProduct.thumbnailUrl || editingProduct.url} alt={editingProduct.name} className="w-full h-full object-cover" />
                    ) : editingProduct.thumbnailUrl ? (
                      <img src={editingProduct.thumbnailUrl} alt={editingProduct.name} className="w-full h-full object-cover" />
                    ) : (
                      <video src={editingProduct.url} className="w-full h-full object-cover" muted preload="metadata" />
                    )}
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="bg-white text-brutal-black px-2 py-1 font-mono text-[9px] uppercase">
                      {editingProduct.type}
                    </span>
                    <span className="text-brutal-accent font-display text-2xl">
                      R$ {Number(editingProduct.price).toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="p-8 space-y-5">
                  <div>
                    <h3 className="font-display text-4xl tracking-tighter uppercase">Editar Produto</h3>
                    <p className="font-mono text-[10px] text-gray-400 uppercase mt-1">Atualize os dados da captura publicada.</p>
                  </div>

                  <div>
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Nome</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))}
                      className="w-full h-12 px-4 bg-white brutal-border font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brutal-accent"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Preco</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editForm.price}
                        onChange={(event) => setEditForm((current) => ({ ...current, price: event.target.value }))}
                        className="w-full h-12 px-4 bg-white brutal-border font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brutal-accent"
                      />
                    </div>

                    <div>
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Status</label>
                      <select
                        value={editForm.status}
                        onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value as ProductEditForm['status'] }))}
                        className="w-full h-12 px-4 bg-[#05080d] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm uppercase outline-none focus:border-brutal-accent"
                      >
                        <option value="published">Publicado</option>
                        <option value="draft">Rascunho</option>
                        <option value="hidden">Oculto</option>
                        <option value="processing">Processando</option>
                        <option value="pending">Pendente</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Evento / Colecao</label>
                    <input
                      type="text"
                      value={editForm.event}
                      onChange={(event) => setEditForm((current) => ({ ...current, event: event.target.value }))}
                      className="w-full h-12 px-4 bg-[#05080d] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm uppercase outline-none focus:border-brutal-accent"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Checkpoint</label>
                      <input
                        type="text"
                        value={editForm.checkpoint}
                        onChange={(event) => setEditForm((current) => ({ ...current, checkpoint: event.target.value }))}
                        className="w-full h-12 px-4 bg-[#05080d] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm uppercase outline-none focus:border-brutal-accent"
                      />
                    </div>

                    <div>
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Numero de Peito</label>
                      <input
                        type="text"
                        value={editForm.bib}
                        onChange={(event) => setEditForm((current) => ({
                          ...current,
                          bib: event.target.value.replace(/[^\w-]/g, '').slice(0, 32),
                        }))}
                        className="w-full h-12 px-4 bg-[#05080d] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm uppercase outline-none focus:border-brutal-accent"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col md:flex-row gap-3 pt-3">
                    <button
                      disabled={isLoading}
                      onClick={handleUpdateProduct}
                      className="flex-1 py-4 bg-brutal-accent text-white font-display text-lg uppercase tracking-widest brutal-border brutal-shadow-hover hover:-translate-x-1 hover:-translate-y-1 transition-all cursor-pointer disabled:bg-gray-400"
                    >
                      {isLoading ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : 'Salvar'}
                    </button>
                    <button
                      onClick={closeEditModal}
                      className="flex-1 py-4 bg-white text-brutal-black font-display text-lg uppercase tracking-widest brutal-border hover:bg-gray-100 transition-colors cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Upload Modal */}
      <AnimatePresence>
        {showUploadModal && (
          <div className="fixed inset-0 z-100 flex items-center justify-center p-6 md:p-12">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowUploadModal(false)}
              className="absolute inset-0 bg-brutal-black/90 backdrop-blur-sm"
            />

            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="relative w-full max-w-6xl bg-[#0d131c] border border-white/15 shadow-[0_30px_90px_rgba(0,0,0,0.6)] text-white flex flex-col lg:flex-row overflow-hidden max-h-[92vh]"
            >
              <button
                onClick={() => {
                  clearSelectedFiles();
                  setShowUploadModal(false);
                }}
                className="absolute right-4 top-4 z-10 p-2 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="lg:w-[47%] p-6 md:p-8 border-b lg:border-b-0 lg:border-r border-white/10 overflow-y-auto min-h-0">
                <div className="mb-6">
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-brutal-accent/10 border border-brutal-accent/30 text-brutal-accent font-mono text-[10px] uppercase tracking-widest mb-4">
                    <Upload className="w-3.5 h-3.5" />
                    Novo lote
                  </div>
                  <h3 className="font-sans font-black text-3xl md:text-4xl uppercase tracking-normal mb-2">Enviar Capturas</h3>
                  <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest">
                    Fotos sao comprimidas automaticamente. Videos precisam estar ate {formatFileSize(clientUploadMaxBytes)}.
                  </p>
                </div>

                <input
                  type="file"
                  multiple
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                  accept="image/*,video/*"
                />

                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-video border border-dashed border-white/20 bg-[#080d14] flex flex-col items-center justify-center group hover:border-brutal-accent hover:bg-brutal-accent/5 transition-colors cursor-pointer mb-6"
                >
                  <div className="bg-brutal-accent text-white p-4 border border-brutal-accent group-hover:scale-110 transition-transform mb-4">
                    <Upload className="w-6 h-6" />
                  </div>
                  <p className="font-sans font-black text-lg uppercase mb-1">Escolher Arquivos</p>
                  <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest">Limite por arquivo: {formatFileSize(clientUploadMaxBytes)}</p>
                </div>

                {selectedFiles.length > 0 && (
                  <div className="space-y-3">
                    <div className="bg-[#080d14] border border-white/10 p-3 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                        <div className="flex-1">
                          <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Valor para todas as fotos</label>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] uppercase text-gray-500">R$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={batchPriceInput}
                              onChange={(event) => setBatchPriceInput(event.target.value)}
                              className="w-full h-10 px-3 bg-[#05080d] border border-white/10 text-white font-mono text-xs outline-none focus:border-brutal-accent"
                            />
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={applyBatchPriceToSelectedFiles}
                          className="h-10 px-4 bg-brutal-accent text-white border border-brutal-accent font-mono text-[10px] uppercase font-bold hover:bg-white hover:text-brutal-accent transition-colors"
                        >
                          Aplicar em todas
                        </button>
                      </div>
                      <p className="font-mono text-[10px] uppercase text-gray-600">
                        Voce ainda pode ajustar o valor individual de cada captura abaixo.
                      </p>
                    </div>

                    <h4 className="font-mono text-[10px] uppercase font-bold text-gray-500">Arquivos Selecionados ({selectedFiles.length})</h4>
                    <div className="bg-[#080d14] border border-white/10 p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-gray-400">
                          {isPreparingFiles ? 'Analisando previews' : 'Arquivos prontos'}
                        </span>
                        <span className="font-mono text-[10px] uppercase font-bold text-white">
                          {filePreparePercent}%
                        </span>
                      </div>
                      <div className="h-2 bg-[#05080d] border border-white/10 overflow-hidden">
                        <div
                          className="h-full bg-brutal-accent transition-all duration-300"
                          style={{ width: `${filePreparePercent}%` }}
                        />
                      </div>
                      <p className="mt-2 font-mono text-[10px] uppercase text-gray-600">
                        {isPreparingFiles
                          ? `${filePrepareProgress.done} de ${filePrepareProgress.total} arquivo(s) carregados para revisao.`
                          : `${selectedFiles.length} arquivo(s) carregados. Voce ja pode publicar.`}
                      </p>
                    </div>
                    <div className="max-h-96 overflow-y-auto space-y-3 pr-2">
                      {selectedFiles.map((item, idx) => (
                        <div
                          key={idx}
                          onClick={() => setPreviewIndex(idx)}
                          className={`w-full bg-[#080d14] p-3 border text-left transition-colors cursor-pointer ${previewIndex === idx ? 'border-brutal-accent ring-1 ring-brutal-accent' : 'border-white/10 hover:border-white/25'
                            }`}
                        >
                          <div className="grid grid-cols-[64px_1fr] gap-3">
                            <div className="w-16 h-16 bg-white/5 border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                              {item.file.type.startsWith('image') ? (
                                <img src={item.previewUrl} alt={item.name} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-black text-white">
                                  <VideoIcon className="w-4 h-4" />
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0 space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <p className="font-mono text-[9px] uppercase truncate text-gray-500">{item.name}</p>
                                <span className="shrink-0 font-mono text-[8px] uppercase text-gray-300 bg-white/5 border border-white/10 px-2 py-1">
                                  {item.file.type.startsWith('image') ? 'IMG' : 'VIDEO'}
                                </span>
                              </div>
                              <input
                                type="text"
                                value={item.description}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => updateSelectedFile(idx, { description: event.target.value })}
                                placeholder="Descricao desta foto"
                                className="w-full h-9 px-2 bg-[#05080d] border border-white/10 text-white placeholder:text-gray-600 font-mono text-[10px] uppercase outline-none focus:border-brutal-accent"
                              />
                              <div className="grid grid-cols-[1fr_112px] gap-2">
                                <input
                                  type="text"
                                  value={item.bib}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) => updateSelectedFile(idx, { bib: event.target.value.replace(/[^\w-]/g, '').slice(0, 32) })}
                                  placeholder="N PEITO OPC."
                                  className="w-full h-9 px-2 bg-[#05080d] border border-white/10 text-white placeholder:text-gray-600 font-mono text-[10px] uppercase outline-none focus:border-brutal-accent"
                                />
                                <div className="grid grid-cols-[30px_1fr] items-center bg-[#05080d] border border-white/10 focus-within:border-brutal-accent">
                                  <span className="font-mono text-[9px] uppercase text-gray-500 text-center border-r border-white/10">R$</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={item.price}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={(event) => updateSelectedFile(idx, { price: parseFloat(event.target.value) })}
                                    className="w-full h-9 px-2 bg-transparent text-white font-mono text-[10px] text-center outline-none"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="lg:w-[53%] p-6 md:p-8 bg-[#080d14] flex flex-col min-h-0">
                <div className="flex-1 overflow-y-auto pr-2 min-h-0">
                  <div className="mb-6">
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Preview antes de publicar</label>
                    <div className="aspect-video bg-black border border-white/10 overflow-hidden flex items-center justify-center">
                      {currentPreview ? (
                        currentPreview.file.type.startsWith('image') ? (
                          <img
                            src={currentPreview.previewUrl}
                            alt={currentPreview.name}
                            className="w-full h-full object-contain bg-brutal-black"
                          />
                        ) : (
                          <video
                            src={currentPreview.previewUrl}
                            className="w-full h-full bg-brutal-black"
                            controls
                            preload="metadata"
                          />
                        )
                      ) : (
                        <div className="text-center px-8">
                          <ImageIcon className="w-10 h-10 text-white/30 mx-auto mb-4" />
                          <p className="font-mono text-[10px] uppercase tracking-widest text-white/50">Selecione uma imagem ou video para revisar</p>
                        </div>
                      )}
                    </div>
                    {currentPreview && (
                      <div className="mt-3 flex items-center justify-between gap-4">
                        <p className="font-mono text-[10px] uppercase truncate text-gray-500">{currentPreview.name}</p>
                        <span className="shrink-0 font-mono text-[10px] uppercase bg-[#0d131c] border border-white/10 text-gray-300 px-2 py-1">
                          {currentPreview.file.type.startsWith('image') ? 'IMG' : 'VIDEO'}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-6 pb-6">
                    <div>
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Eventos ativos</label>
                      <select
                        value={selectedEventId}
                        onChange={(event) => handleTodayEventSelect(event.target.value)}
                        className="w-full h-12 px-4 bg-[#05080d] border border-white/15 text-white font-mono text-xs uppercase outline-none focus:border-brutal-accent"
                      >
                        <option value="">Selecionar evento cadastrado pelo admin</option>
                        {publishableEvents.map((eventItem) => (
                          <option key={eventItem.id} value={eventItem.id}>
                            {eventItem.name} {eventItem.location ? `- ${eventItem.location}` : ''}
                          </option>
                        ))}
                      </select>
                      {publishableEvents.length === 0 && (
                        <p className="mt-2 font-mono text-[10px] uppercase text-gray-600">
                          Nenhum evento publicado. Crie um evento na aba Eventos ou preencha manualmente.
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Nome do Evento / Colecao</label>
                      <input
                        type="text"
                        value={eventInput}
                        onChange={e => setEventInput(e.target.value)}
                        disabled={publishableEvents.length > 0}
                        placeholder="EX: TREINO DE SABADO, MARATONA SP"
                        className="w-full h-12 px-4 bg-[#05080d] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm uppercase outline-none focus:border-brutal-accent disabled:opacity-70 disabled:cursor-not-allowed"
                      />
                    </div>

                    <div>
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Checkpoint / Localizacao</label>
                      <input
                        type="text"
                        value={checkpointInput}
                        onChange={e => setCheckpointInput(e.target.value)}
                        disabled={publishableEvents.length > 0}
                        placeholder="EX: KM 15, CHEGADA"
                        className="w-full h-12 px-4 bg-[#05080d] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm uppercase outline-none focus:border-brutal-accent disabled:opacity-70 disabled:cursor-not-allowed"
                      />
                    </div>

                    <div className="bg-[#0d131c] text-white p-5 border border-white/10">
                      <p className="font-mono text-[10px] uppercase text-gray-400 mb-1">Resumo do Lote</p>
                      <div className="flex justify-between items-end">
                        <span className="font-sans font-black text-sm uppercase">Total Estimado</span>
                        <span className="font-sans font-black text-2xl text-brutal-accent">
                          {formatCurrency(selectedFiles.reduce((acc, curr) => acc + curr.price, 0))}
                        </span>
                      </div>
                    </div>
                  </div>

                </div>

                <div className="pt-5 border-t border-white/10">
                  {(isPublishing || publishProgress.total > 0) && (
                    <div className="mb-4 bg-[#0d131c] border border-white/10 p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-gray-400">
                          {isPublishing ? 'Publicando lote' : 'Ultimo envio'}
                        </span>
                        <span className="font-mono text-[10px] uppercase font-bold text-white">
                          {publishPercent}%
                        </span>
                      </div>
                      <div className="h-2 bg-[#05080d] border border-white/10 overflow-hidden">
                        <div
                          className="h-full bg-green-500 transition-all duration-300"
                          style={{ width: `${publishPercent}%` }}
                        />
                      </div>
                      <p className="mt-2 font-mono text-[10px] uppercase text-gray-600">
                        {publishProgress.done} de {publishProgress.total} arquivo(s) processados.
                      </p>
                    </div>
                  )}
                  <button
                    disabled={!canPublishSelectedFiles}
                    onClick={handleUpload}
                    className="w-full h-14 bg-brutal-accent text-white border border-brutal-accent font-sans font-black text-sm uppercase tracking-widest hover:bg-white hover:text-brutal-accent transition-colors cursor-pointer disabled:bg-gray-700 disabled:border-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    {isPublishing ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Publicando {publishPercent}%
                      </span>
                    ) : isPreparingFiles ? (
                      `Analisando ${filePreparePercent}%`
                    ) : (
                      `Publicar ${selectedFiles.length || ''} Produto${selectedFiles.length === 1 ? '' : 's'}`
                    )}
                  </button>
                  <button
                    onClick={() => {
                      clearSelectedFiles();
                      setShowUploadModal(false);
                    }}
                    className="w-full py-4 mt-2 font-mono text-[10px] uppercase font-bold text-gray-500 hover:text-red-300 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SidebarLink({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 font-sans text-sm font-bold transition-all cursor-pointer border ${active
        ? 'bg-brutal-accent/25 text-brutal-accent border-brutal-accent/60 shadow-[inset_3px_0_0_#ff4d00]'
        : 'text-gray-400 border-transparent hover:text-white hover:bg-white/5 hover:border-white/10'
        }`}
    >
      <span className={active ? 'text-white' : 'text-gray-500'}>
        {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: 'w-5 h-5' })}
      </span>
      {label}
    </button>
  );
}

function StatCard({ label, value, icon, trend, accent = false, warning = false }: { label: string, value: string | number, icon: React.ReactNode, trend: string, accent?: boolean, warning?: boolean }) {
  return (
    <div className="p-5 bg-linear-to-br from-[#111923] to-[#0b1018] border border-white/10 transition-all hover:border-white/20">
      <div className="flex items-start justify-between mb-5">
        <div className={`p-3 rounded ${accent ? 'bg-brutal-accent' : warning ? 'bg-green-600' : 'bg-blue-600'}`}>
          {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: 'w-6 h-6 text-white' })}
        </div>
        <span className={`font-sans text-xs font-bold ${warning ? 'text-brutal-accent' : 'text-green-400'}`}>{trend}</span>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-widest mb-2 text-gray-400">{label}</p>
      <p className="font-sans text-3xl font-black tracking-tight text-white">{value}</p>
      <div className="mt-6 h-8 flex items-end gap-1">
        {[35, 26, 42, 56, 48, 62, 39, 31, 44, 58].map((height, index) => (
          <span
            key={index}
            className={`flex-1 rounded-t ${accent ? 'bg-brutal-accent' : warning ? 'bg-green-500' : 'bg-blue-500'} opacity-${index % 3 === 0 ? '100' : '70'}`}
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
    </div>
  );
}
