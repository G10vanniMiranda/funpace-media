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
  X,
  Pause,
  Play,
  RotateCcw,
  WifiOff,
  Link as LinkIcon,
  Copy
} from 'lucide-react';
import { Event, Product, Photographer, PhotographerDashboardMetrics, PhotographerProductPerformance, PhotographerReferral, PhotographerSale, WithdrawalRequest } from '../types';
import { calculateFileSha256, eventService, normalizePhotographerUsername, photographerDashboardService, photographerService, productService, referralService, withdrawalService, type MediaProcessingJob } from '../lib/services';
import { isMockMode } from '../lib/config';
import { getCurrentUser } from '../lib/supabase';
import {
  clearUploadResumeManifest,
  createResumableFileSignature,
  pickResumableUploadFiles,
  readUploadResumeManifest,
  restoreFilesFromManifest,
  supportsFileSystemUploadHandles,
  writeUploadResumeManifest,
  type ResumablePickedFile,
  type ResumableUploadFileHandle,
  type ResumableUploadItemStatus,
  type ResumableUploadManifestItem,
} from '../lib/resumable-upload';
import {
  calculateFileSha256InWorker,
  generateImageThumbnailInWorker,
  prepareImageForUploadInWorker,
} from '../lib/upload-processing';

interface PhotographerDashboardProps {
  photographer: Photographer;
  onLogout: () => void;
}

type UploadItem = {
  id: string;
  file: File;
  fileHandle?: ResumableUploadFileHandle | null;
  price: number;
  name: string;
  description: string;
  bib: string;
  previewUrl: string;
  status: UploadItemStatus;
  attempts: number;
  stage: UploadPublishStage | null;
  error: string;
  uploadedAt: string | null;
  uploadBatchId?: string | null;
  fileHash?: string | null;
  thumbnailHash?: string | null;
  uploadedFilePath?: string | null;
  uploadedThumbnailPath?: string | null;
  preparedFileSize?: number | null;
  productId?: string | null;
  faceIndexStatus?: Product['faceIndexStatus'];
  faceIndexError?: string | null;
};

type UploadItemStatus = ResumableUploadItemStatus;

type UploadProcessingSummary = {
  status: 'pending' | 'processing' | 'done' | 'failed';
  total: number;
  done: number;
  failed: number;
  processing: number;
  pending: number;
  attempts: number;
  error: string | null;
};

type DuplicateUploadAction = 'replace' | 'copy' | 'cancel';

type DuplicateUploadConflict = {
  index: number;
  item: UploadItem;
  existingProduct: Product;
  eventName: string;
  remainingCount: number;
};

type UploadPublishStage =
  | 'validacao'
  | 'duplicidade-nome'
  | 'preparo-arquivo'
  | 'hash-original'
  | 'duplicidade-conteudo'
  | 'upload-original'
  | 'preview'
  | 'hash-preview'
  | 'upload-preview'
  | 'banco'
  | 'indexacao-facial';

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
type PhotographerPeriodKey = 'today' | 'week' | 'month' | 'year' | 'custom';
type PhotographerTab = 'overview' | 'events' | 'products' | 'earnings' | 'referrals' | 'profile';

type PhotographerCatalogEvent = {
  name: string;
  checkpoint: string;
  coverUrl: string | null;
  coverPosition: string;
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
  coverMediaId: string;
  bannerImage: string;
  cover_position: string;
};

type ProfileImageKind = 'avatar' | 'cover';

type PendingProfileImage = {
  file: File;
  previewUrl: string;
};

type PendingEventCover = PendingProfileImage;

const PHOTOGRAPHER_PERIOD_OPTIONS: Array<{ key: PhotographerPeriodKey; label: string }> = [
  { key: 'today', label: 'Hoje' },
  { key: 'week', label: 'Esta semana' },
  { key: 'month', label: 'Este mes' },
  { key: 'year', label: 'Este ano' },
  { key: 'custom', label: 'Personalizado' },
];

const defaultUploadMaxBytes = 300 * 1024 * 1024;
const clientUploadMaxBytes = Number(import.meta.env.VITE_MEDIA_UPLOAD_MAX_BYTES || defaultUploadMaxBytes);
const imageCompressionMaxBytes = 900 * 1024;
const imageCompressionMaxSide = 2200;
const EVENT_COVER_POSITION_OPTIONS = [
  { label: 'Centro', value: 'center center' },
  { label: 'Topo', value: 'center top' },
  { label: 'Baixo', value: 'center bottom' },
  { label: 'Esquerda', value: 'left center' },
  { label: 'Direita', value: 'right center' },
];
const minImageCompressionSide = 900;
const imageCompressionQualities = [0.82, 0.74, 0.66, 0.58, 0.5, 0.42];
const imagePreviewMaxSide = 960;
const imagePreviewQuality = 0.84;
const videoPreviewMaxSide = 960;
const videoPreviewQuality = 0.82;
const profileAvatarMaxBytes = 5 * 1024 * 1024;
const profileCoverMaxBytes = 15 * 1024 * 1024;
const eventCoverOptimizeThresholdBytes = 5 * 1024 * 1024;
const profileImageTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const uploadVisibleListLimit = 160;
const uploadOfflineRetryDelayMs = 1500;
const uploadConcurrencyLimit = Math.min(5, Math.max(1, Number(import.meta.env.VITE_PHOTOGRAPHER_UPLOAD_CONCURRENCY || 4)));
const deferredThumbnailConcurrencyLimit = Math.min(2, Math.max(1, Number(import.meta.env.VITE_PHOTOGRAPHER_THUMBNAIL_CONCURRENCY || 1)));

type UploadRuntimeMetrics = {
  batchId: string | null;
  startedAt: number;
  completedAt: number | null;
  totalFiles: number;
  totalBytes: number;
  uploadedBytes: number;
  failedFiles: number;
  retries: number;
  activeUploads: number;
  concurrencyLimit: number;
};

const emptyUploadRuntimeMetrics: UploadRuntimeMetrics = {
  batchId: null,
  startedAt: 0,
  completedAt: null,
  totalFiles: 0,
  totalBytes: 0,
  uploadedBytes: 0,
  failedFiles: 0,
  retries: 0,
  activeUploads: 0,
  concurrencyLimit: Math.max(1, uploadConcurrencyLimit),
};

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
    platformFeePercent: Number(photographer.commissionPercent) || 30,
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

function normalizeUploadName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function splitFileName(fileName: string) {
  const match = fileName.match(/^(.*?)(\.[^.]+)?$/);
  const base = (match?.[1] || fileName || 'captura').trim();
  const extension = match?.[2] || '';
  return { base, extension };
}

function createCopyFileName(fileName: string, usedNames: Set<string>) {
  const { base, extension } = splitFileName(fileName);
  let counter = 1;
  let candidate = `${base} (${counter})${extension}`;

  while (usedNames.has(normalizeUploadName(candidate))) {
    counter += 1;
    candidate = `${base} (${counter})${extension}`;
  }

  usedNames.add(normalizeUploadName(candidate));
  return candidate;
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

function isInferredEvent(eventItem: Event) {
  return eventItem.id.startsWith('inferred-event:');
}

function sortDashboardEventsNewestFirst(events: Event[]) {
  return [...events].sort((left, right) => {
    const leftDate = getTimestamp(left.date);
    const rightDate = getTimestamp(right.date);
    if (leftDate !== rightDate) return rightDate - leftDate;

    const leftCreated = getTimestamp(left.createdAt);
    const rightCreated = getTimestamp(right.createdAt);
    if (leftCreated !== rightCreated) return rightCreated - leftCreated;

    return left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' });
  });
}

function mergeDashboardEvents(events: Event[], products: Product[], photographerId: string) {
  const registeredEventNames = new Set(events.map((eventItem) => normalizeCatalogText(eventItem.name)));
  const inferredEvents: Event[] = [];

  const productsByEventName = new Map<string, Product[]>();

  for (const product of products) {
    if ((product.status ?? 'published') === 'removed') continue;
    if (product.vendedorId !== photographerId) continue;

    const eventName = product.event?.trim();
    if (!eventName) continue;

    const normalizedName = normalizeCatalogText(eventName);
    if (!normalizedName || registeredEventNames.has(normalizedName)) continue;

    const group = productsByEventName.get(normalizedName) ?? [];
    group.push(product);
    productsByEventName.set(normalizedName, group);
  }

  for (const [normalizedName, groupProducts] of productsByEventName.entries()) {
    const latestProduct = groupProducts.reduce((latest, product) => (
      getTimestamp(product.createdAt) > getTimestamp(latest.createdAt) ? product : latest
    ), groupProducts[0]);
    const coverProduct = groupProducts.find((product) => product.thumbnailUrl || product.url);
    const createdAt = latestProduct.createdAt || new Date().toISOString();

    inferredEvents.push({
      id: `inferred-event:${encodeURIComponent(normalizedName)}`,
      photographerId,
      name: latestProduct.event.trim(),
      date: createdAt.slice(0, 10),
      location: latestProduct.checkpoint || null,
      checkpoint: latestProduct.checkpoint || 'Ponto Principal',
      coverImage: coverProduct?.thumbnailUrl || (coverProduct?.type === 'IMG' ? coverProduct.url : null) || null,
      cover_position: 'center center',
      isPublished: groupProducts.some((product) => (product.status ?? 'published') === 'published'),
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    });
  }

  return sortDashboardEventsNewestFirst([...events, ...inferredEvents]);
}

function formatCreatedOrderLabel(value?: string | null) {
  const timestamp = getTimestamp(value);
  if (!timestamp) return 'Criação não registrada';

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

  if (normalized.includes('bucket event-covers')) {
    return 'Não foi possível enviar a capa do evento. Tente novamente ou salve o evento sem capa.';
  }

  if (normalized.includes('covermediaid') || normalized.includes('schema cache')) {
    return 'Não foi possível salvar a capa selecionada. Tente novamente em alguns instantes.';
  }

  return 'Não foi possível salvar o evento. Verifique os dados e tente novamente.';
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1).replace('.', ',')} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

function formatDurationMs(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours <= 0) return `${minutes}min ${seconds}s`;
  return `${hours}h ${remainingMinutes}min`;
}

function formatUploadSpeed(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 MB/s';
  return `${(bytesPerSecond / 1024 / 1024).toFixed(2).replace('.', ',')} MB/s`;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function runLimitedConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, order: number) => Promise<void>,
) {
  let cursor = 0;
  const safeConcurrency = Math.min(items.length, Math.max(1, concurrency));
  const workers = Array.from({ length: safeConcurrency }, async () => {
    while (cursor < items.length) {
      const order = cursor;
      cursor += 1;
      await worker(items[order], order);
    }
  });
  await Promise.all(workers);
}

function getUploadStatusLabel(status: UploadItemStatus) {
  const labels: Record<UploadItemStatus, string> = {
    pending: 'Pendente',
    queued: 'Na fila',
    uploading: 'Enviando',
    uploaded: 'Upload ok',
    db_saved: 'Banco ok',
    published: 'Publicada',
    done: 'Enviada',
    failed: 'Falhou',
    paused: 'Pausada',
    skipped: 'Ignorada',
  };
  return labels[status];
}

function getUploadStatusClass(status: UploadItemStatus) {
  if (status === 'done' || status === 'published' || status === 'db_saved') return 'border-green-500/30 bg-green-500/10 text-green-300';
  if (status === 'uploaded') return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200';
  if (status === 'failed') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (status === 'uploading') return 'border-brutal-accent/40 bg-brutal-accent/10 text-brutal-accent';
  if (status === 'paused') return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300';
  if (status === 'skipped') return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
  return 'border-white/10 bg-white/5 text-gray-300';
}

function summarizeMediaProcessingJobs(jobs: MediaProcessingJob[]): UploadProcessingSummary {
  const summary: UploadProcessingSummary = {
    status: 'pending',
    total: jobs.length,
    done: 0,
    failed: 0,
    processing: 0,
    pending: 0,
    attempts: 0,
    error: null,
  };

  for (const job of jobs) {
    if (job.status === 'done') summary.done += 1;
    else if (job.status === 'failed') {
      summary.failed += 1;
      summary.error ||= job.error || null;
    } else if (job.status === 'processing') summary.processing += 1;
    else summary.pending += 1;
    summary.attempts += Math.max(0, Number(job.attempts || 0));
  }

  if (summary.total > 0 && summary.done === summary.total) summary.status = 'done';
  else if (summary.failed > 0) summary.status = 'failed';
  else if (summary.processing > 0) summary.status = 'processing';
  else summary.status = 'pending';

  return summary;
}

function getProcessingStatusLabel(summary?: UploadProcessingSummary) {
  if (!summary || summary.total === 0) return 'Processamento pendente';
  if (summary.status === 'done') return 'Processamento concluido';
  if (summary.status === 'failed') return 'Processamento com erro';
  if (summary.status === 'processing') return 'Processando midia';
  return 'Na fila de processamento';
}

function getProcessingStatusClass(summary?: UploadProcessingSummary) {
  if (!summary || summary.total === 0) return 'border-white/10 bg-white/5 text-gray-400';
  if (summary.status === 'done') return 'border-green-500/30 bg-green-500/10 text-green-300';
  if (summary.status === 'failed') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (summary.status === 'processing') return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200';
  return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200';
}

function calculateUploadFileSha256(file: File) {
  return calculateFileSha256InWorker(file, calculateFileSha256);
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

  if (period === 'year') {
    start = startOfDay(new Date(now.getFullYear(), 0, 1));
    end = endOfDay(new Date(now.getFullYear(), 11, 31));
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

function ProfileImageUploader({
  kind,
  label,
  description,
  actionLabel,
  previewUrl,
  error,
  disabled,
  onSelect,
  onRemove,
}: {
  kind: ProfileImageKind;
  label: string;
  description: string;
  actionLabel: string;
  previewUrl: string;
  error: string;
  disabled?: boolean;
  onSelect: (file: File | null) => void;
  onRemove: () => void;
}) {
  const inputId = `profile-${kind}-upload`;
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const handleFiles = (files: FileList | null) => {
    onSelect(files?.[0] ?? null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-3 md:col-span-2">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">{label}</p>
        <p className="font-mono text-[10px] uppercase tracking-widest text-gray-600 mt-1">{description}</p>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
        className={`grid gap-4 border border-dashed p-4 transition-colors md:grid-cols-[180px_minmax(0,1fr)] ${isDragging
          ? 'border-brutal-accent bg-brutal-accent/10'
          : 'border-white/20 bg-[#080d14]'
          }`}
      >
        <div className={`${kind === 'avatar' ? 'aspect-square' : 'aspect-[16/6] md:aspect-[4/3]'} overflow-hidden border border-white/10 bg-[#05080d]`}>
          {previewUrl ? (
            <img src={previewUrl} alt={label} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-600">
              {kind === 'avatar' ? <Users className="h-10 w-10" /> : <ImageIcon className="h-10 w-10" />}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col justify-center gap-3">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            className="hidden"
            disabled={disabled}
            onChange={(event) => handleFiles(event.target.files)}
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              className="inline-flex h-11 items-center justify-center gap-2 border border-brutal-accent bg-brutal-accent px-4 font-sans text-xs font-black uppercase tracking-wide text-white transition-colors hover:bg-white hover:text-brutal-accent disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              {actionLabel}
            </button>
            {previewUrl && (
              <button
                type="button"
                disabled={disabled}
                onClick={onRemove}
                className="inline-flex h-11 items-center justify-center gap-2 border border-white/15 bg-white/5 px-4 font-sans text-xs font-black uppercase tracking-wide text-gray-300 transition-colors hover:border-red-400 hover:text-red-300 disabled:opacity-60"
              >
                <X className="h-4 w-4" />
                Remover
              </button>
            )}
          </div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">
            Arraste uma imagem aqui ou selecione da galeria no celular.
          </p>
          {error && (
            <p className="font-mono text-[10px] uppercase tracking-widest text-red-300">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

async function generateVideoThumbnail(file: File): Promise<File | null> {
  if (!file.type.startsWith('video')) return null;

  return new Promise((resolve) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    let seekRequested = false;
    let timeout = 0;

    const finish = (thumbnail: File | null) => {
      if (settled) return;
      settled = true;
      if (timeout) window.clearTimeout(timeout);
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
      resolve(thumbnail);
    };

    const captureFrame = () => {
      const canvas = document.createElement('canvas');
      const videoWidth = video.videoWidth || 1280;
      const videoHeight = video.videoHeight || 720;
      const scale = Math.min(1, videoPreviewMaxSide / Math.max(videoWidth, videoHeight));
      canvas.width = Math.max(1, Math.round(videoWidth * scale));
      canvas.height = Math.max(1, Math.round(videoHeight * scale));
      const context = canvas.getContext('2d');

      if (!context) {
        finish(null);
        return;
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) {
          finish(null);
          return;
        }

        const thumbnailName = file.name.replace(/\.[^.]+$/, '') || 'video';
        finish(new File([blob], `${thumbnailName}-thumb.jpg`, { type: 'image/jpeg' }));
      }, 'image/jpeg', videoPreviewQuality);
    };

    const seekAndCapture = () => {
      if (settled || seekRequested) return;
      seekRequested = true;

      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const targetTime = duration > 0
        ? Math.min(Math.max(0.25, duration * 0.15), Math.max(0.25, duration - 0.1))
        : 0;

      try {
        if (targetTime > 0) {
          video.currentTime = targetTime;
          return;
        }
      } catch {
        // Some mobile browsers disallow seeking before enough data is decoded.
      }

      captureFrame();
    };

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.src = objectUrl;

    timeout = window.setTimeout(() => finish(null), 15000);
    video.onerror = () => finish(null);
    video.onloadedmetadata = seekAndCapture;
    video.onloadeddata = () => {
      if (!seekRequested) seekAndCapture();
    };
    video.oncanplay = () => {
      if (!seekRequested) seekAndCapture();
    };
    video.onseeked = captureFrame;
    video.load();
  });
}

async function generateImageThumbnailFallback(file: File): Promise<File | null> {
  if (!file.type.startsWith('image')) return null;

  return new Promise((resolve) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const maxSide = imagePreviewMaxSide;
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

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, width, height);
      context.save();
      context.translate(width / 2, height / 2);
      context.rotate(-Math.PI / 6);
      const watermarkFontSize = Math.max(14, Math.round(Math.min(width, height) / 16));
      const watermarkStepX = Math.max(180, Math.round(width / 2.6));
      const watermarkStepY = Math.max(92, Math.round(height / 4.8));
      const watermarkBounds = Math.hypot(width, height);
      context.font = `900 ${watermarkFontSize}px Arial, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = 'rgba(255,255,255,0.20)';
      context.strokeStyle = 'rgba(0,0,0,0.22)';
      context.lineWidth = Math.max(1, Math.min(width, height) / 360);
      for (let y = -watermarkBounds; y <= watermarkBounds; y += watermarkStepY) {
        for (let x = -watermarkBounds; x <= watermarkBounds; x += watermarkStepX) {
          context.strokeText('FUNPACE MEDIA', x, y);
          context.fillText('FUNPACE MEDIA', x, y);
        }
      }
      context.restore();
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(null);
          return;
        }

        const thumbnailName = file.name.replace(/\.[^.]+$/, '') || 'foto';
        resolve(new File([blob], `${thumbnailName}-preview.jpg`, { type: 'image/jpeg' }));
      }, 'image/jpeg', imagePreviewQuality);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };

    image.src = objectUrl;
  });
}

async function generateImageThumbnail(file: File): Promise<File | null> {
  return generateImageThumbnailInWorker(
    file,
    {
      maxSide: imagePreviewMaxSide,
      quality: imagePreviewQuality,
      watermarkText: 'FUNPACE MEDIA',
    },
    generateImageThumbnailFallback,
  );
}

async function prepareImageForUploadFallback(file: File): Promise<File> {
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

async function prepareImageForUpload(file: File): Promise<File> {
  return prepareImageForUploadInWorker(
    file,
    {
      clientMaxBytes: clientUploadMaxBytes,
      targetMaxBytes: imageCompressionMaxBytes,
      maxSide: imageCompressionMaxSide,
      minSide: minImageCompressionSide,
      qualities: imageCompressionQualities,
    },
    prepareImageForUploadFallback,
  );
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
  if (isMissingLocalUploadFileError(message)) {
    return getMissingLocalUploadFileMessage(file);
  }

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

function isMissingLocalUploadFileError(message: string) {
  return /requested file or directory could not be found|could not be found at the time|notfounderror|file.*not.*found|arquivo.*n[aã]o.*encontrado/i.test(message);
}

function getMissingLocalUploadFileMessage(file?: File) {
  const fileName = file?.name ? ` (${file.name})` : '';
  return `Não foi possível localizar o arquivo local${fileName} durante a publicação. Verifique se as fotos ainda existem no armazenamento, deixe o arquivo disponível offline, selecione a foto novamente e tente publicar.`;
}

function getUploadStageLabel(stage: UploadPublishStage) {
  const labels: Record<UploadPublishStage, string> = {
    validacao: 'validacao inicial',
    'duplicidade-nome': 'verificacao de nome duplicado',
    'preparo-arquivo': 'leitura e preparo do arquivo',
    'hash-original': 'calculo de hash do arquivo original',
    'duplicidade-conteudo': 'verificacao de conteudo duplicado',
    'upload-original': 'upload da mídia original',
    preview: 'geracao de preview',
    'hash-preview': 'calculo de hash do preview',
    'upload-preview': 'upload do preview',
    banco: 'gravacao no banco de dados',
    'indexacao-facial': 'indexacao facial',
  };

  return labels[stage] || stage;
}

async function assertUploadFileReadable(file: File) {
  try {
    await file.slice(0, Math.min(file.size || 1, 1024 * 1024)).arrayBuffer();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    throw new Error(isMissingLocalUploadFileError(detail) ? getMissingLocalUploadFileMessage(file) : detail || 'Não foi possível ler o arquivo selecionado.');
  }
}

function validateProfileImageFile(file: File, kind: ProfileImageKind) {
  const limit = kind === 'avatar' ? profileAvatarMaxBytes : profileCoverMaxBytes;
  const label = kind === 'avatar' ? 'foto de perfil' : 'banner de capa';

  if (!profileImageTypes.has(file.type.toLowerCase())) {
    throw new Error(`Formato inválido para ${label}. Envie JPG, JPEG, PNG ou WEBP.`);
  }

  if (file.size > limit) {
    throw new Error(`${label[0].toUpperCase()}${label.slice(1)} muito grande (${formatFileSize(file.size)}). O limite e ${formatFileSize(limit)}.`);
  }
}

function validateEventCoverFile(file: File) {
  if (!profileImageTypes.has(file.type.toLowerCase())) {
    throw new Error('Formato inválido para capa do evento. Envie JPG, JPEG, PNG ou WEBP.');
  }

  if (file.size > profileCoverMaxBytes) {
    throw new Error(`Capa do evento muito grande (${formatFileSize(file.size)}). O limite e ${formatFileSize(profileCoverMaxBytes)}.`);
  }
}

async function prepareProfileImageForUpload(file: File, kind: ProfileImageKind): Promise<File> {
  validateProfileImageFile(file, kind);

  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const targetWidth = kind === 'avatar' ? 512 : 1600;
      const targetHeight = kind === 'avatar' ? 512 : 600;
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const context = canvas.getContext('2d');

      if (!context) {
        reject(new Error('Não foi possível preparar a imagem neste navegador.'));
        return;
      }

      const sourceRatio = image.width / image.height;
      const targetRatio = targetWidth / targetHeight;
      let sourceWidth = image.width;
      let sourceHeight = image.height;
      let sourceX = 0;
      let sourceY = 0;

      if (sourceRatio > targetRatio) {
        sourceWidth = Math.round(image.height * targetRatio);
        sourceX = Math.round((image.width - sourceWidth) / 2);
      } else {
        sourceHeight = Math.round(image.width / targetRatio);
        sourceY = Math.round((image.height - sourceHeight) / 2);
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);

      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Não foi possível comprimir a imagem.'));
          return;
        }

        const baseName = (file.name.replace(/\.[^.]+$/, '') || (kind === 'avatar' ? 'perfil' : 'banner')).slice(0, 80);
        resolve(new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' }));
      }, 'image/jpeg', kind === 'avatar' ? 0.88 : 0.84);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Não foi possível ler a imagem selecionada.'));
    };

    image.src = objectUrl;
  });
}

async function prepareEventCoverForUpload(file: File): Promise<File> {
  validateEventCoverFile(file);

  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const shouldOptimizeLargeCover = file.size > eventCoverOptimizeThresholdBytes;
      const targetWidth = shouldOptimizeLargeCover ? 1920 : 1600;
      const targetHeight = shouldOptimizeLargeCover ? 1080 : 900;
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const context = canvas.getContext('2d');

      if (!context) {
        reject(new Error('Não foi possível preparar a capa neste navegador.'));
        return;
      }

      const sourceRatio = image.width / image.height;
      const targetRatio = targetWidth / targetHeight;
      let sourceWidth = image.width;
      let sourceHeight = image.height;
      let sourceX = 0;
      let sourceY = 0;

      if (sourceRatio > targetRatio) {
        sourceWidth = Math.round(image.height * targetRatio);
        sourceX = Math.round((image.width - sourceWidth) / 2);
      } else {
        sourceHeight = Math.round(image.width / targetRatio);
        sourceY = Math.round((image.height - sourceHeight) / 2);
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Não foi possível comprimir a capa do evento.'));
          return;
        }

        const baseName = (file.name.replace(/\.[^.]+$/, '') || 'capa-evento').slice(0, 80);
        const extension = shouldOptimizeLargeCover ? 'webp' : 'jpg';
        const type = shouldOptimizeLargeCover ? 'image/webp' : 'image/jpeg';
        resolve(new File([blob], `${baseName}.${extension}`, { type }));
      }, shouldOptimizeLargeCover ? 'image/webp' : 'image/jpeg', shouldOptimizeLargeCover ? 0.86 : 0.84);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Não foi possível ler a capa selecionada.'));
    };

    image.src = objectUrl;
  });
}

async function generateMediaThumbnail(file: File): Promise<File | null> {
  return file.type.startsWith('image')
    ? generateImageThumbnail(file)
    : generateVideoThumbnail(file);
}

export function PhotographerDashboard({ photographer, onLogout }: PhotographerDashboardProps) {
  const [activeTab, setActiveTab] = useState<PhotographerTab>('overview');
  const [currentPhotographer, setCurrentPhotographer] = useState(photographer);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [dashboardMetrics, setDashboardMetrics] = useState<PhotographerDashboardMetrics>(() => getInitialDashboardMetrics(photographer));
  const [recentSales, setRecentSales] = useState<PhotographerSale[]>([]);
  const [productPerformance, setProductPerformance] = useState<PhotographerProductPerformance[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [referrals, setReferrals] = useState<PhotographerReferral[]>([]);
  const [referralCopyMessage, setReferralCopyMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isUploadPaused, setIsUploadPaused] = useState(false);
  const [isBrowserOnline, setIsBrowserOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [publishProgress, setPublishProgress] = useState({ done: 0, total: 0 });
  const [uploadRuntimeMetrics, setUploadRuntimeMetrics] = useState<UploadRuntimeMetrics>(emptyUploadRuntimeMetrics);
  const [isPreparingFiles, setIsPreparingFiles] = useState(false);
  const [filePrepareProgress, setFilePrepareProgress] = useState({ done: 0, total: 0 });
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false);
  const [withdrawalPixKey, setWithdrawalPixKey] = useState(photographer.cpf ?? '');
  const [withdrawalError, setWithdrawalError] = useState('');
  const [isRequestingWithdrawal, setIsRequestingWithdrawal] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<UploadItem[]>([]);
  const [uploadProcessingJobsByProduct, setUploadProcessingJobsByProduct] = useState<Record<string, UploadProcessingSummary>>({});
  const [resumeNotice, setResumeNotice] = useState('');
  const [uploadCompletionNotice, setUploadCompletionNotice] = useState('');
  const [duplicateConflict, setDuplicateConflict] = useState<DuplicateUploadConflict | null>(null);
  const [applyDuplicateChoiceToAll, setApplyDuplicateChoiceToAll] = useState(false);
  const [availableEvents, setAvailableEvents] = useState<Event[]>([]);
  const [showEventModal, setShowEventModal] = useState(false);
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
    coverMediaId: '',
    bannerImage: '',
    cover_position: 'center center',
  }));
  const [eventError, setEventError] = useState('');
  const [isSavingEvent, setIsSavingEvent] = useState(false);
  const [pendingEventCover, setPendingEventCover] = useState<PendingEventCover | null>(null);
  const pendingEventCoverRef = React.useRef<PendingEventCover | null>(null);
  const [eventCoverError, setEventCoverError] = useState('');
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
  const [selectedPeriod, setSelectedPeriod] = useState<PhotographerPeriodKey>('year');
  const [customPeriodStart, setCustomPeriodStart] = useState(() => formatDateInput(startOfDay(new Date())));
  const [customPeriodEnd, setCustomPeriodEnd] = useState(() => formatDateInput(endOfDay(new Date())));
  const [showPeriodMenu, setShowPeriodMenu] = useState(false);
  const periodMenuRef = React.useRef<HTMLDivElement | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState('');
  const [profileSaveSuccess, setProfileSaveSuccess] = useState('');
  const [profileImageErrors, setProfileImageErrors] = useState<Record<ProfileImageKind, string>>({ avatar: '', cover: '' });
  const [pendingProfileImages, setPendingProfileImages] = useState<Record<ProfileImageKind, PendingProfileImage | null>>({
    avatar: null,
    cover: null,
  });
  const pendingProfileImagesRef = React.useRef<Record<ProfileImageKind, PendingProfileImage | null>>({
    avatar: null,
    cover: null,
  });
  const [profileForm, setProfileForm] = useState(() => ({
    name: photographer.name,
    username: photographer.username || photographer.slug || normalizePhotographerUsername(photographer.displayName || photographer.name),
    isPublic: photographer.isPublic !== false,
    displayName: photographer.displayName || photographer.name,
    bio: photographer.bio || '',
    instagram: photographer.instagram || '',
    city: photographer.city || '',
    avatar: photographer.profilePhoto || photographer.avatar || '',
    coverPhoto: photographer.coverPhoto || '',
  }));
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
  const uploadPausedRef = React.useRef(false);
  const browserOnlineRef = React.useRef(typeof navigator === 'undefined' ? true : navigator.onLine);
  const duplicateResolutionRef = React.useRef<((action: DuplicateUploadAction) => void) | null>(null);
  const duplicateBatchActionRef = React.useRef<Exclude<DuplicateUploadAction, 'cancel'> | null>(null);
  const currentPreview = selectedFiles[previewIndex];
  const createUploadItemsFromPickedFiles = React.useCallback((
    pickedFiles: ResumablePickedFile[],
    resumeItems: ResumableUploadManifestItem[] = [],
    price = 19.90,
  ): UploadItem[] => {
    const resumeByFile = new Map(
      resumeItems.map((item) => [createResumableFileSignature(item), item]),
    );

    return pickedFiles.map(({ file, handle }) => {
      const resumeItem = resumeByFile.get(createResumableFileSignature(file));
      return {
        id: `${createResumableFileSignature(file)}:${crypto.randomUUID()}`,
        file,
        fileHandle: handle || resumeItem?.handle || null,
        price,
        name: file.name,
        description: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim(),
        bib: '',
        previewUrl: '',
        status: resumeItem?.status === 'done' || resumeItem?.status === 'published'
          ? 'skipped'
          : resumeItem?.status === 'failed' || resumeItem?.status === 'paused'
            ? resumeItem.status
            : 'queued',
        attempts: resumeItem?.attempts || 0,
        stage: (resumeItem?.stage || null) as UploadPublishStage | null,
        error: resumeItem?.error || '',
        uploadedAt: resumeItem?.uploadedAt || null,
        uploadBatchId: resumeItem?.uploadBatchId || null,
        fileHash: resumeItem?.fileHash || null,
        thumbnailHash: resumeItem?.thumbnailHash || null,
        uploadedFilePath: resumeItem?.uploadedFilePath || null,
        uploadedThumbnailPath: resumeItem?.uploadedThumbnailPath || null,
        preparedFileSize: resumeItem?.preparedFileSize || null,
        productId: resumeItem?.productId || null,
      };
    });
  }, []);

  React.useEffect(() => {
    uploadPausedRef.current = isUploadPaused;
  }, [isUploadPaused]);

  React.useEffect(() => {
    browserOnlineRef.current = isBrowserOnline;
  }, [isBrowserOnline]);

  React.useEffect(() => {
    const handleOnline = () => {
      browserOnlineRef.current = true;
      setIsBrowserOnline(true);
      setIsUploadPaused(false);
    };
    const handleOffline = () => {
      browserOnlineRef.current = false;
      setIsBrowserOnline(false);
      setIsUploadPaused(true);
      setSelectedFiles((current) => current.map((item) => (
        item.status === 'uploading' || item.status === 'queued'
          ? { ...item, status: 'paused' as const }
          : item
      )));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function restorePendingUpload() {
      const manifest = await readUploadResumeManifest(photographer.id);
      if (cancelled || !manifest) return;

      const pendingItems = manifest.items.filter((item) => item.status !== 'done' && item.status !== 'published' && item.status !== 'skipped');
      if (pendingItems.length === 0) return;

      setEventInput(manifest.eventInput || '');
      setCheckpointInput(manifest.checkpointInput || 'Ponto Principal');
      setSelectedEventId(manifest.selectedEventId || '');
      setShowUploadModal(true);

      const restoredFiles = await restoreFilesFromManifest(manifest);
      if (cancelled) return;

      if (restoredFiles.length > 0) {
        const defaultBatchPrice = Number(batchPriceInput);
        const resolvedPrice = Number.isFinite(defaultBatchPrice) && defaultBatchPrice > 0 ? defaultBatchPrice : 19.90;
        const restoredItems = createUploadItemsFromPickedFiles(restoredFiles, manifest.items, resolvedPrice);
        setSelectedFiles((current) => current.length > 0 ? current : restoredItems);
        setResumeNotice(`Encontramos um upload incompleto e restauramos ${restoredFiles.length} arquivo(s). Clique em Continuar para enviar somente o que falta.`);
        return;
      }

      setResumeNotice(`Encontramos um upload incompleto com ${pendingItems.length} arquivo(s) pendente(s). Selecione novamente a mesma pasta/arquivos para continuar somente o que falta.`);
    }

    void restorePendingUpload();
    return () => {
      cancelled = true;
    };
  }, [photographer.id, batchPriceInput, createUploadItemsFromPickedFiles]);

  React.useEffect(() => {
    if (selectedFiles.length === 0) return;
    void writeUploadResumeManifest({
      photographerId: photographer.id,
      eventInput,
      checkpointInput,
      selectedEventId,
      updatedAt: new Date().toISOString(),
      items: selectedFiles.map((item) => ({
        name: item.file.name,
        size: item.file.size,
        type: item.file.type,
        lastModified: item.file.lastModified,
        status: item.status,
        attempts: item.attempts,
        stage: item.stage,
        error: item.error,
        uploadedAt: item.uploadedAt,
        handle: item.fileHandle || null,
        uploadBatchId: item.uploadBatchId || null,
        fileHash: item.fileHash || null,
        thumbnailHash: item.thumbnailHash || null,
        uploadedFilePath: item.uploadedFilePath || null,
        uploadedThumbnailPath: item.uploadedThumbnailPath || null,
        preparedFileSize: item.preparedFileSize || null,
        productId: item.productId || null,
      })),
    });
  }, [selectedFiles, photographer.id, eventInput, checkpointInput, selectedEventId]);

  React.useEffect(() => {
    const productIds = Array.from(new Set(selectedFiles.map((item) => item.productId).filter((id): id is string => Boolean(id))));
    if (productIds.length === 0) {
      setUploadProcessingJobsByProduct({});
      return;
    }

    let cancelled = false;
    const refreshProcessingJobs = async () => {
      const startedAt = performance.now();
      const jobs = await productService.getMediaProcessingJobs(productIds);
      if (cancelled) return;

      const grouped = jobs.reduce((acc, job) => {
        if (!job.productId) return acc;
        acc[job.productId] ||= [];
        acc[job.productId].push(job);
        return acc;
      }, {} as Record<string, MediaProcessingJob[]>);
      const next = Object.fromEntries(
        productIds.map((productId) => [productId, summarizeMediaProcessingJobs(grouped[productId] || [])]),
      );

      setUploadProcessingJobsByProduct((current) => (
        JSON.stringify(current) === JSON.stringify(next) ? current : next
      ));
      console.info('[photographer-upload] media-job:status-refresh', {
        productCount: productIds.length,
        jobCount: jobs.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
    };

    void refreshProcessingJobs();
    const interval = window.setInterval(refreshProcessingJobs, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedFiles]);

  React.useEffect(() => {
    if (selectedFiles.length === 0) return;
    const keepIndexes = new Set<number>();
    for (let index = 0; index < Math.min(uploadVisibleListLimit, selectedFiles.length); index += 1) {
      keepIndexes.add(index);
    }
    if (previewIndex >= 0 && previewIndex < selectedFiles.length) keepIndexes.add(previewIndex);

    let changed = false;
    const nextFiles = selectedFiles.map((item, index) => {
      const shouldKeepPreview = keepIndexes.has(index);
      if (shouldKeepPreview && !item.previewUrl) {
        changed = true;
        return { ...item, previewUrl: URL.createObjectURL(item.file) };
      }
      if (!shouldKeepPreview && item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
        changed = true;
        return { ...item, previewUrl: '' };
      }
      return item;
    });

    if (changed) setSelectedFiles(nextFiles);
  }, [selectedFiles, previewIndex]);

  React.useEffect(() => {
    pendingProfileImagesRef.current = pendingProfileImages;
  }, [pendingProfileImages]);

  React.useEffect(() => {
    pendingEventCoverRef.current = pendingEventCover;
  }, [pendingEventCover]);

  React.useEffect(() => {
    return () => {
      Object.values(pendingProfileImagesRef.current).forEach((item) => {
        if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      if (pendingEventCoverRef.current?.previewUrl) URL.revokeObjectURL(pendingEventCoverRef.current.previewUrl);
    };
  }, []);

  const publicProfileUrl = `/${normalizePhotographerUsername(profileForm.username || profileForm.displayName || profileForm.name)}`;

  const handleSavePublicProfile = async () => {
    setIsSavingProfile(true);
    setProfileSaveError('');
    setProfileSaveSuccess('');
    try {
      const uploadedAvatar = pendingProfileImages.avatar
        ? await photographerService.uploadProfilePhoto(currentPhotographer.id, await prepareProfileImageForUpload(pendingProfileImages.avatar.file, 'avatar'))
        : null;
      const uploadedCover = pendingProfileImages.cover
        ? await photographerService.uploadCoverPhoto(currentPhotographer.id, await prepareProfileImageForUpload(pendingProfileImages.cover.file, 'cover'))
        : null;
      const nextAvatar = uploadedAvatar?.publicUrl || profileForm.avatar.trim();
      const nextCover = uploadedCover?.publicUrl || profileForm.coverPhoto.trim();
      const updated = await photographerService.updateOwnPublicProfile(currentPhotographer.id, {
        name: profileForm.name.trim() || currentPhotographer.name,
        username: profileForm.username,
        isPublic: profileForm.isPublic,
        displayName: profileForm.displayName.trim() || profileForm.name.trim() || currentPhotographer.name,
        bio: profileForm.bio.trim(),
        instagram: profileForm.instagram.replace(/^@/, '').trim() || null,
        city: profileForm.city.trim() || null,
        avatar: nextAvatar,
        profilePhoto: nextAvatar,
        coverPhoto: nextCover || null,
      });
      setCurrentPhotographer(updated);
      setProfileForm((current) => ({
        ...current,
        avatar: updated.profilePhoto || updated.avatar || '',
        coverPhoto: updated.coverPhoto || '',
        username: updated.username || updated.slug || current.username,
        isPublic: updated.isPublic !== false,
      }));
      setPendingProfileImages((current) => {
        Object.values(current).forEach((item) => {
          if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
        });
        return { avatar: null, cover: null };
      });
      setProfileSaveSuccess('Perfil publico atualizado.');
    } catch (error) {
      console.error('Erro ao salvar perfil publico:', error);
      setProfileSaveError(error instanceof Error ? error.message : 'Não foi possível salvar o perfil público.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSelectProfileImage = (kind: ProfileImageKind, file: File | null) => {
    if (!file) return;

    try {
      validateProfileImageFile(file, kind);
      const previewUrl = URL.createObjectURL(file);
      setProfileImageErrors((current) => ({ ...current, [kind]: '' }));
      setProfileSaveError('');
      setProfileSaveSuccess('');
      setPendingProfileImages((current) => {
        if (current[kind]?.previewUrl) URL.revokeObjectURL(current[kind]!.previewUrl);
        return { ...current, [kind]: { file, previewUrl } };
      });
    } catch (error) {
      setProfileImageErrors((current) => ({
        ...current,
        [kind]: error instanceof Error ? error.message : 'Não foi possível selecionar a imagem.',
      }));
    }
  };

  const handleRemoveProfileImage = (kind: ProfileImageKind) => {
    setPendingProfileImages((current) => {
      if (current[kind]?.previewUrl) URL.revokeObjectURL(current[kind]!.previewUrl);
      return { ...current, [kind]: null };
    });
    setProfileImageErrors((current) => ({ ...current, [kind]: '' }));
    if (kind === 'avatar') {
      setProfileForm((current) => ({ ...current, avatar: '' }));
    } else {
      setProfileForm((current) => ({ ...current, coverPhoto: '' }));
    }
  };

  const eventCoverCandidates = React.useMemo(() => {
    const normalizedEventName = normalizeCatalogText(eventForm.name.trim());
    if (!normalizedEventName) return [];

    return products
      .filter((product) => (
        (product.status ?? 'published') !== 'removed' &&
        product.type === 'IMG' &&
        normalizeCatalogText(product.event || '') === normalizedEventName &&
        Boolean(product.thumbnailUrl || product.url)
      ))
      .sort((left, right) => {
        const leftTime = getTimestamp(left.createdAt);
        const rightTime = getTimestamp(right.createdAt);
        return rightTime - leftTime || String(left.name || '').localeCompare(String(right.name || ''), 'pt-BR', { sensitivity: 'base' });
      })
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
      const coverProduct = groupProducts.find((product) => product.thumbnailUrl) ||
        groupProducts.find((product) => product.type === 'IMG' && product.url);
      const fallbackDate = groupProducts.reduce<string | undefined>((latest, product) => {
        if (!product.createdAt) return latest;
        if (!latest) return product.createdAt;
        return product.createdAt > latest ? product.createdAt : latest;
      }, undefined);

      return {
        name: eventName,
        checkpoint: eventDetail?.checkpoint || eventDetail?.location || groupProducts[0]?.checkpoint || 'Local a confirmar',
        coverUrl: eventDetail?.coverImage || coverProduct?.thumbnailUrl || (coverProduct?.type === 'IMG' ? coverProduct.url : null) || null,
        coverPosition: eventDetail?.cover_position || 'center center',
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
  const selectedProductEventCard = React.useMemo(
    () => productEventCards.find((eventItem) => eventItem.name === selectedProductEventName) || null,
    [productEventCards, selectedProductEventName],
  );
  const selectedProductEventDetail = React.useMemo(
    () => availableEvents.find((eventItem) => normalizeCatalogText(eventItem.name) === normalizeCatalogText(selectedProductEventName)) || null,
    [availableEvents, selectedProductEventName],
  );
  const scopedFilteredProducts = React.useMemo(
    () => visibleGroupedProducts.flatMap(({ products: groupProducts }) => groupProducts),
    [visibleGroupedProducts],
  );
  const selectedProducts = React.useMemo(
    () => products.filter((product) => selectedProductIds.has(product.id) && (product.status ?? 'published') !== 'removed'),
    [products, selectedProductIds],
  );
  const allFilteredProductsSelected = scopedFilteredProducts.length > 0 &&
    scopedFilteredProducts.every((product) => selectedProductIds.has(product.id));
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
    availableEvents
      .filter((eventItem) => eventItem.status !== 'closed' && eventItem.isPublished !== false)
      .sort((left, right) => {
        const leftDate = getTimestamp(left.date);
        const rightDate = getTimestamp(right.date);
        if (leftDate !== rightDate) return rightDate - leftDate;

        const leftCreated = getTimestamp(left.createdAt);
        const rightCreated = getTimestamp(right.createdAt);
        if (leftCreated !== rightCreated) return rightCreated - leftCreated;

        return left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' });
      })
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
        title: 'Saldo disponível para saque',
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
  const uploadStatusCounts = React.useMemo(() => selectedFiles.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {} as Record<UploadItemStatus, number>), [selectedFiles]);
  const pendingUploadCount = selectedFiles.filter((item) => item.status !== 'done' && item.status !== 'published' && item.status !== 'skipped').length;
  const completedUploadCount = (uploadStatusCounts.done || 0) + (uploadStatusCounts.published || 0) + (uploadStatusCounts.skipped || 0);
  const failedUploadCount = uploadStatusCounts.failed || 0;
  const uploadedOnlyCount = uploadStatusCounts.uploaded || 0;
  const dbSavedUploadCount = uploadStatusCounts.db_saved || 0;
  const inProgressUploadCount = uploadStatusCounts.uploading || 0;
  const skippedUploadCount = uploadStatusCounts.skipped || 0;
  const uploadProcessingSummaries = Object.values(uploadProcessingJobsByProduct);
  const mediaProcessingPendingCount = uploadProcessingSummaries.filter((summary) => summary.status === 'pending').length;
  const mediaProcessingActiveCount = uploadProcessingSummaries.filter((summary) => summary.status === 'processing').length;
  const mediaProcessingDoneCount = uploadProcessingSummaries.filter((summary) => summary.status === 'done').length;
  const mediaProcessingFailedCount = uploadProcessingSummaries.filter((summary) => summary.status === 'failed').length;
  const uploadElapsedMs = uploadRuntimeMetrics.startedAt
    ? (uploadRuntimeMetrics.completedAt || Date.now()) - uploadRuntimeMetrics.startedAt
    : 0;
  const uploadAverageSpeed = uploadElapsedMs > 0
    ? uploadRuntimeMetrics.uploadedBytes / (uploadElapsedMs / 1000)
    : 0;
  const uploadRemainingBytes = Math.max(0, uploadRuntimeMetrics.totalBytes - uploadRuntimeMetrics.uploadedBytes);
  const uploadEtaMs = uploadAverageSpeed > 0 && uploadRemainingBytes > 0
    ? (uploadRemainingBytes / uploadAverageSpeed) * 1000
    : 0;
  const visibleSelectedFiles = selectedFiles.slice(0, uploadVisibleListLimit);
  const hiddenSelectedFileCount = Math.max(0, selectedFiles.length - visibleSelectedFiles.length);
  const canPublishSelectedFiles = pendingUploadCount > 0 && !isLoading && !isPreparingFiles && !isPublishing && isBrowserOnline;
  const referralUrl = referralService.buildReferralUrl(currentPhotographer);
  const referralTotals = React.useMemo(() => ({
    total: referrals.length,
    pending: referrals.filter((referral) => referral.status === 'pending').length,
    approved: referrals.filter((referral) => ['approved', 'active', 'rewarded'].includes(referral.status)).length,
    accumulated: referrals.reduce((sum, referral) => sum + Number(referral.rewardAmount || 0), 0),
    paid: referrals.filter((referral) => referral.rewardStatus === 'paid').reduce((sum, referral) => sum + Number(referral.rewardAmount || 0), 0),
  }), [referrals]);

  const handleCopyReferralLink = async () => {
    await navigator.clipboard?.writeText(referralUrl);
    setReferralCopyMessage('Link copiado com sucesso!');
    window.setTimeout(() => setReferralCopyMessage(''), 2500);
  };

  const exportUploadErrorReport = React.useCallback(() => {
    const failedItems = selectedFiles.filter((item) => item.status === 'failed' || item.error);
    if (failedItems.length === 0) return;

    const lines = [
      'Arquivo,Status,Etapa,Erro,Storage original,Storage preview,Produto',
      ...failedItems.map((item) => [
        item.name,
        item.status,
        item.stage ? getUploadStageLabel(item.stage) : '',
        item.error,
        item.uploadedFilePath || '',
        item.uploadedThumbnailPath || '',
        item.productId || '',
      ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `funpace-upload-erros-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [selectedFiles]);

  const loadPhotographerContent = React.useCallback(async (showLoader = false) => {
    if (showLoader) setIsLoading(true);
    try {
      const pProducts = await productService.getVendedorProducts(photographer.id);
      const visibleProducts = pProducts.filter((product) => (product.status ?? 'published') !== 'removed');
      setProducts(visibleProducts);
      const dashboard = await photographerDashboardService.getDashboard(photographer.id, visibleProducts);
      const pWithdrawals = await withdrawalService.getPhotographerWithdrawals(photographer.id);
      const pReferrals = await referralService.getPhotographerReferrals(photographer.id).catch(() => []);
      const events = await eventService.getPhotographerEvents(photographer.id);
      const mergedEvents = mergeDashboardEvents(events, visibleProducts, photographer.id);
      console.info('[event-cover] dashboard:events-loaded', {
        photographerId: photographer.id,
        count: mergedEvents.length,
        registeredCount: events.length,
        inferredCount: mergedEvents.length - events.length,
        covers: mergedEvents.map((eventItem) => ({
          eventId: eventItem.id,
          name: eventItem.name,
          coverImage: eventItem.coverImage || null,
          coverMediaId: eventItem.coverMediaId || null,
        })),
      });
      setDashboardMetrics(dashboard.metrics);
      setRecentSales(dashboard.recentSales);
      setProductPerformance(dashboard.productPerformance);
      setWithdrawals(pWithdrawals);
      setReferrals(pReferrals);
      setAvailableEvents(mergedEvents);
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
      setWithdrawalError('Não há saldo disponível para saque.');
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
      setWithdrawalError(error?.message || 'Não foi possível solicitar o saque.');
    } finally {
      setIsRequestingWithdrawal(false);
    }
  };

  const resetEventForm = () => {
    setShowEventModal(false);
    setPendingEventCover((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
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
      coverMediaId: '',
      bannerImage: '',
      cover_position: 'center center',
    });
    setEventError('');
    setEventCoverError('');
  };

  const openNewEventModal = () => {
    setPendingEventCover((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
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
      coverMediaId: '',
      bannerImage: '',
      cover_position: 'center center',
    });
    setEventError('');
    setEventCoverError('');
    setShowEventModal(true);
  };

  const handleEditEvent = (eventItem: Event, options: { keepActiveTab?: boolean } = {}) => {
    const inferred = isInferredEvent(eventItem);
    setPendingEventCover((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setEventForm({
      id: inferred ? null : eventItem.id,
      name: eventItem.name,
      date: eventItem.date,
      location: eventItem.location || '',
      checkpoint: eventItem.checkpoint || 'Ponto Principal',
      description: eventItem.description || '',
      status: eventItem.status,
      isPublished: eventItem.isPublished !== false,
      coverImage: eventItem.coverImage || '',
      coverMediaId: eventItem.coverMediaId || '',
      bannerImage: eventItem.bannerImage || '',
      cover_position: eventItem.cover_position || 'center center',
    });
    setEventError('');
    setEventCoverError('');
    if (!options.keepActiveTab) setActiveTab('events');
    setShowEventModal(true);
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
      if (pendingEventCover) {
        console.info('[event-cover] selected', {
          eventId: eventForm.id || null,
          fileName: pendingEventCover.file.name,
          size: pendingEventCover.file.size,
          contentType: pendingEventCover.file.type,
          bucket: 'MEDIA_BUCKET via /api/media/upload',
        });
      }
      const uploadedCover = pendingEventCover
        ? await eventService.uploadEventCover(photographer.id, await prepareEventCoverForUpload(pendingEventCover.file))
        : null;
      const previousEventName = eventForm.id
        ? availableEvents.find((eventItem) => eventItem.id === eventForm.id)?.name || ''
        : '';
      const payload = {
        photographerId: photographer.id,
        name: normalizedName,
        date: normalizedDate,
        location: eventForm.location.trim() || null,
        checkpoint: eventForm.checkpoint.trim() || 'Ponto Principal',
        description: eventForm.description.trim() || null,
        status: eventForm.status,
        isPublished: eventForm.isPublished,
        coverImage: uploadedCover?.publicUrl || eventForm.coverImage.trim() || null,
        coverMediaId: uploadedCover ? null : eventForm.coverMediaId || null,
        bannerImage: eventForm.bannerImage.trim() || null,
        cover_position: eventForm.cover_position || 'center center',
      };
      console.info('[event-cover] event:update:start', {
        eventId: eventForm.id || null,
        coverImage: payload.coverImage,
        coverMediaId: payload.coverMediaId,
      });
      const saved = eventForm.id
        ? await eventService.updateEvent(eventForm.id, payload)
        : await eventService.createEvent(payload);
      console.info('[event-cover] event:update:done', {
        eventId: saved.id,
        coverImage: saved.coverImage || null,
        coverMediaId: saved.coverMediaId || null,
      });

      if (previousEventName && normalizeCatalogText(previousEventName) !== normalizeCatalogText(saved.name)) {
        const updatedProducts = await productService.renameEventProducts(photographer.id, previousEventName, saved.name);
        if (updatedProducts.length > 0) {
          const updatedById = new Map(updatedProducts.map((product) => [product.id, product]));
          setProducts((current) => current.map((product) => updatedById.get(product.id) || product));
        }
      }

      setAvailableEvents((current) => {
        const savedName = normalizeCatalogText(saved.name);
        const withoutDuplicateInferred = current.filter((eventItem) => (
          eventItem.id === saved.id ||
          !isInferredEvent(eventItem) ||
          normalizeCatalogText(eventItem.name) !== savedName
        ));
        const exists = withoutDuplicateInferred.some((eventItem) => eventItem.id === saved.id);
        return sortDashboardEventsNewestFirst(exists
          ? withoutDuplicateInferred.map((eventItem) => (eventItem.id === saved.id ? saved : eventItem))
          : [saved, ...withoutDuplicateInferred]);
      });
      resetEventForm();
    } catch (error: any) {
      console.error('Erro ao salvar evento:', error);
      setEventError(formatEventSaveError(error));
    } finally {
      setIsSavingEvent(false);
    }
  };

  const handleSelectEventCoverFile = (file: File | null) => {
    if (!file) return;

    try {
      validateEventCoverFile(file);
      const previewUrl = URL.createObjectURL(file);
      setEventCoverError('');
      setPendingEventCover((current) => {
        if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
        return { file, previewUrl };
      });
      setEventForm((current) => ({ ...current, coverMediaId: '' }));
    } catch (error) {
      setEventCoverError(error instanceof Error ? error.message : 'Não foi possível selecionar a capa.');
    }
  };

  const handleRemoveEventCover = () => {
    setPendingEventCover((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setEventCoverError('');
    setEventForm((current) => ({ ...current, coverImage: '', coverMediaId: '' }));
  };

  const handleSelectEventCoverProduct = (product: Product) => {
    const coverUrl = product.thumbnailUrl || product.url;
    if (!coverUrl) return;
    setPendingEventCover((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setEventCoverError('');
    setEventForm((current) => ({ ...current, coverImage: coverUrl, coverMediaId: product.id }));
  };

  const handleToggleEventPublication = async (eventItem: Event) => {
    if (isInferredEvent(eventItem)) {
      handleEditEvent(eventItem);
      return;
    }

    try {
      const updated = await eventService.updateEvent(eventItem.id, { isPublished: eventItem.isPublished === false });
      setAvailableEvents((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      console.error('Erro ao alterar publicação do evento:', error);
      alert('Não foi possível alterar a publicação do evento.');
    }
  };

  const handleRemoveEvent = async (eventItem: Event) => {
    if (isInferredEvent(eventItem)) {
      alert('Este evento foi detectado pelas mídias, mas ainda não está cadastrado. Abra em Editar/Cadastrar e salve para gerenciar publicação ou exclusão.');
      return;
    }

    const hasProducts = products.some((product) => product.event === eventItem.name);
    const shouldRemove = window.confirm(hasProducts
      ? 'Este evento possui produtos vinculados. Remover o evento não remove as fotos, mas elas ficam com o nome atual no catálogo. Continuar?'
      : 'Remover este evento?');
    if (!shouldRemove) return;

    try {
      await eventService.removeEvent(eventItem.id);
      setAvailableEvents((current) => current.filter((item) => item.id !== eventItem.id));
      if (selectedEventId === eventItem.id) setSelectedEventId('');
    } catch (error) {
      console.error('Erro ao remover evento:', error);
      alert('Não foi possível remover o evento.');
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
      alert(`Alguns arquivos não foram adicionados:\n\n${blockedReasons.slice(0, 5).join('\n')}${blockedReasons.length > 5 ? `\n...e mais ${blockedReasons.length - 5} arquivo(s).` : ''}`);
    }

    if (acceptedFiles.length === 0) return;

    setUploadCompletionNotice('');
    const defaultBatchPrice = Number(batchPriceInput);
    const resolvedPrice = Number.isFinite(defaultBatchPrice) && defaultBatchPrice > 0 ? defaultBatchPrice : 19.90;
    const resumeManifest = await readUploadResumeManifest(photographer.id);
    const newFiles = createUploadItemsFromPickedFiles(
      acceptedFiles.map((file) => ({ file })),
      resumeManifest?.items || [],
      resolvedPrice,
    );

    setSelectedFiles((current) => {
      if (current.length === 0 && newFiles.length > 0) {
        setPreviewIndex(0);
      }
      return [...current, ...newFiles];
    });
    setResumeNotice('');

    setIsPreparingFiles(true);
    setFilePrepareProgress({ done: 0, total: newFiles.length });

    try {
      for (const [index, item] of newFiles.entries()) {
        if (index % 100 === 0) await wait(0);
        setFilePrepareProgress({ done: index + 1, total: newFiles.length });
      }
    } finally {
      setIsPreparingFiles(false);
    }
  };

  const handleResumableFilePicker = async () => {
    if (!supportsFileSystemUploadHandles()) {
      fileInputRef.current?.click();
      return;
    }

    try {
      const picked = await pickResumableUploadFiles();
      if (picked.length === 0) return;

      const blockedReasons = picked
        .map(({ file }) => getSelectionBlockReason(file))
        .filter(Boolean);
      const acceptedPicked = picked.filter(({ file }) => !getSelectionBlockReason(file));

      if (blockedReasons.length > 0) {
        alert(`Alguns arquivos nÃ£o foram adicionados:\n\n${blockedReasons.slice(0, 5).join('\n')}${blockedReasons.length > 5 ? `\n...e mais ${blockedReasons.length - 5} arquivo(s).` : ''}`);
      }

      if (acceptedPicked.length === 0) return;

      setUploadCompletionNotice('');
      const defaultBatchPrice = Number(batchPriceInput);
      const resolvedPrice = Number.isFinite(defaultBatchPrice) && defaultBatchPrice > 0 ? defaultBatchPrice : 19.90;
      const resumeManifest = await readUploadResumeManifest(photographer.id);
      const newFiles = createUploadItemsFromPickedFiles(acceptedPicked, resumeManifest?.items || [], resolvedPrice);

      setSelectedFiles((current) => {
        if (current.length === 0 && newFiles.length > 0) {
          setPreviewIndex(0);
        }
        return [...current, ...newFiles];
      });
      setResumeNotice('Arquivos adicionados com modo retomavel. Em navegadores compativeis, o painel consegue recuperar estes arquivos apos refresh.');

      setIsPreparingFiles(true);
      setFilePrepareProgress({ done: 0, total: newFiles.length });

      try {
        for (const [index, item] of newFiles.entries()) {
          if (index % 100 === 0) await wait(0);
          setFilePrepareProgress({ done: index + 1, total: newFiles.length });
        }
      } finally {
        setIsPreparingFiles(false);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('Erro ao selecionar arquivos retomaveis:', error);
      fileInputRef.current?.click();
    }
  };

  const clearSelectedFiles = () => {
    selectedFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setSelectedFiles([]);
    void clearUploadResumeManifest(photographer.id);
    setResumeNotice('');
    setUploadCompletionNotice('');
    setBatchPriceInput('19.90');
    setPreviewIndex(0);
    setIsPreparingFiles(false);
    setFilePrepareProgress({ done: 0, total: 0 });
    setPublishProgress({ done: 0, total: 0 });
    setUploadRuntimeMetrics(emptyUploadRuntimeMetrics);
    setDuplicateConflict(null);
    setApplyDuplicateChoiceToAll(false);
    duplicateBatchActionRef.current = null;
    duplicateResolutionRef.current = null;
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

  const requestDuplicateResolution = (conflict: DuplicateUploadConflict): Promise<DuplicateUploadAction> => {
    if (duplicateBatchActionRef.current) return Promise.resolve(duplicateBatchActionRef.current);

    setApplyDuplicateChoiceToAll(false);
    setDuplicateConflict(conflict);

    return new Promise((resolve) => {
      duplicateResolutionRef.current = resolve;
    });
  };

  const resolveDuplicateConflict = (action: DuplicateUploadAction) => {
    if (action !== 'cancel' && applyDuplicateChoiceToAll) {
      duplicateBatchActionRef.current = action;
    }

    duplicateResolutionRef.current?.(action);
    duplicateResolutionRef.current = null;
    setDuplicateConflict(null);
    setApplyDuplicateChoiceToAll(false);
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
      alert('Informe um preço válido.');
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
    const shouldRemove = window.confirm('Remover este produto? Ele não aparecerá mais no painel nem na vitrine.');
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
        scopedFilteredProducts.forEach((product) => next.delete(product.id));
      } else {
        scopedFilteredProducts.forEach((product) => next.add(product.id));
      }
      return next;
    });
  };

  const handleBulkRemoveProducts = async () => {
    if (selectedProducts.length === 0) return;

    const shouldRemove = window.confirm(`Remover ${selectedProducts.length} produto(s) da vitrine? Eles não aparecerão para clientes.`);
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

  const waitUntilUploadCanContinue = async () => {
    while (uploadPausedRef.current || !browserOnlineRef.current) {
      await wait(uploadOfflineRetryDelayMs);
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

    const uploadQueue = selectedFiles
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status !== 'done' && item.status !== 'published' && item.status !== 'skipped');

    if (uploadQueue.length === 0) {
      alert('Nenhum arquivo pendente para publicar.');
      return;
    }

    const invalidQueueItem = uploadQueue.find(({ item }) => (
      !item.description.trim() ||
      !Number.isFinite(Number(item.price)) ||
      Number(item.price) <= 0
    ));
    const invalidFileIndex = invalidQueueItem?.index ?? -1;

    if (invalidFileIndex >= 0) {
      setPreviewIndex(invalidFileIndex);
      alert(`Preencha descrição e preço válido para o arquivo ${invalidFileIndex + 1}.`);
      return;
    }

    setIsLoading(true);
    setIsPublishing(true);
    setIsUploadPaused(false);
    setUploadCompletionNotice('');
    uploadPausedRef.current = false;
    try {
      const currentUser = getCurrentUser();
      if (!isMockMode && currentUser?.id && currentUser.id !== photographer.id) {
        alert('Sessão do fotógrafo não sincronizada com o cadastro aprovado. Saia do painel, entre novamente e tente publicar de novo.');
        return;
      }

      let publishedCount = 0;
      let replacedCount = 0;
      let copiedCount = 0;
      let skippedDuplicateCount = 0;
      const uploadBatchId = crypto.randomUUID();
      const batchStartedAt = performance.now();
      const batchTotalBytes = uploadQueue.reduce((sum, { item }) => sum + item.file.size, 0);
      setUploadRuntimeMetrics({
        batchId: uploadBatchId,
        startedAt: Date.now(),
        completedAt: null,
        totalFiles: uploadQueue.length,
        totalBytes: batchTotalBytes,
        uploadedBytes: 0,
        failedFiles: 0,
        retries: uploadQueue.reduce((sum, { item }) => sum + Math.max(0, item.attempts), 0),
        activeUploads: 0,
        concurrencyLimit: Math.max(1, uploadConcurrencyLimit),
      });
      const currentBatchHashes = new Set<string>();
      const failedUploads: Array<{ index: number; name: string; message: string; stage: UploadPublishStage }> = [];
      const previewWarnings: Array<{ name: string; message: string }> = [];
      const batchStageDurations = new Map<UploadPublishStage, number>();
      const batchStageCounts = new Map<UploadPublishStage, number>();
      let batchPreparedBytes = 0;
      let batchUploadedOriginalBytes = 0;
      let completedUploadCount = 0;
      let deferredThumbnailCount = 0;
      let duplicatePromptChain = Promise.resolve();
      const usedFileNames = new Set(
        products
          .filter((product) => (
            (product.status ?? 'published') !== 'removed' &&
            normalizeCatalogText(product.event || '') === normalizeCatalogText(normalizedEvent)
          ))
          .flatMap((product) => [product.originalFileName || '', product.name || ''])
          .filter(Boolean)
          .map(normalizeUploadName),
      );
      duplicateBatchActionRef.current = null;
      setPublishProgress({ done: 0, total: uploadQueue.length });

      const markUploadCompleted = () => {
        completedUploadCount += 1;
        setPublishProgress({ done: completedUploadCount, total: uploadQueue.length });
      };
      const updateUploadRuntimeMetric = (changes: Partial<UploadRuntimeMetrics> | ((current: UploadRuntimeMetrics) => UploadRuntimeMetrics)) => {
        setUploadRuntimeMetrics((current) => (
          typeof changes === 'function' ? changes(current) : { ...current, ...changes }
        ));
      };
      const recordStageDurations = (durations: Partial<Record<UploadPublishStage, number>>) => {
        Object.entries(durations).forEach(([stage, duration]) => {
          if (typeof duration !== 'number' || duration < 0) return;
          const uploadStageKey = stage as UploadPublishStage;
          batchStageDurations.set(uploadStageKey, (batchStageDurations.get(uploadStageKey) || 0) + duration);
          batchStageCounts.set(uploadStageKey, (batchStageCounts.get(uploadStageKey) || 0) + 1);
        });
      };
      const requestDuplicateResolutionQueued = async (conflict: DuplicateUploadConflict) => {
        let resolvedAction: DuplicateUploadAction = 'cancel';
        const run = duplicatePromptChain.then(async () => {
          resolvedAction = await requestDuplicateResolution(conflict);
        });
        duplicatePromptChain = run.catch(() => undefined);
        await run;
        return resolvedAction;
      };
      const pendingProductCreates: Array<{
        product: Omit<Product, 'id'>;
        resolve: (id: string) => void;
        reject: (error: unknown) => void;
      }> = [];
      let productCreateFlushTimer: number | null = null;
      let productCreateFlushChain = Promise.resolve();
      const flushPendingProductCreates = async () => {
        if (productCreateFlushTimer !== null) {
          window.clearTimeout(productCreateFlushTimer);
          productCreateFlushTimer = null;
        }
        const batch = pendingProductCreates.splice(0, 25);
        if (batch.length === 0) return;

        const dbStartedAt = performance.now();
        try {
          const ids = await productService.addProductsBatchResilient(batch.map((entry) => entry.product));
          batch.forEach((entry, entryIndex) => entry.resolve(ids[entryIndex]));
          console.info('[photographer-upload] db:batch-published', {
            uploadBatchId,
            count: batch.length,
            durationMs: Math.round(performance.now() - dbStartedAt),
          });
        } catch (error) {
          batch.forEach((entry) => entry.reject(error));
        }
      };
      const scheduleProductCreateFlush = (immediate = false) => {
        if (productCreateFlushTimer !== null) {
          window.clearTimeout(productCreateFlushTimer);
          productCreateFlushTimer = null;
        }
        if (immediate) {
          productCreateFlushChain = productCreateFlushChain.then(flushPendingProductCreates);
          return;
        }
        productCreateFlushTimer = window.setTimeout(() => {
          productCreateFlushChain = productCreateFlushChain.then(flushPendingProductCreates);
        }, 350);
      };
      const createProductBatched = (product: Omit<Product, 'id'>) => new Promise<string>((resolve, reject) => {
        pendingProductCreates.push({ product, resolve, reject });
        scheduleProductCreateFlush(pendingProductCreates.length >= 25);
      });
      type DeferredThumbnailTask = {
        productId: string;
        item: UploadItem;
        itemIndex: number;
        uploadFile: File;
        uploadBatchId: string;
      };
      const deferredThumbnailQueue: DeferredThumbnailTask[] = [];
      let activeDeferredThumbnailTasks = 0;
      let completedDeferredThumbnailTasks = 0;
      let failedDeferredThumbnailTasks = 0;
      const runDeferredThumbnailProcessing = async (input: DeferredThumbnailTask) => {
        const processingStartedAt = performance.now();
        console.info('[photographer-upload] thumbnail:deferred:start', {
          uploadBatchId: input.uploadBatchId,
          productId: input.productId,
          fileName: input.uploadFile.name,
          originalFileName: input.item.file.name,
          fileSize: input.uploadFile.size,
          active: activeDeferredThumbnailTasks,
          queued: deferredThumbnailQueue.length,
          concurrencyLimit: deferredThumbnailConcurrencyLimit,
        });

        const thumbnailFile = await generateMediaThumbnail(input.uploadFile);
        if (!thumbnailFile) {
          console.warn('[photographer-upload] thumbnail:deferred:skipped', {
            uploadBatchId: input.uploadBatchId,
            productId: input.productId,
            fileName: input.uploadFile.name,
            reason: input.uploadFile.type.startsWith('video') ? 'video-preview-unavailable' : 'image-preview-unavailable',
            durationMs: Math.round(performance.now() - processingStartedAt),
          });
          return;
        }

        const hashStartedAt = performance.now();
        const thumbnailHash = input.item.thumbnailHash || await calculateUploadFileSha256(thumbnailFile);
        const uploadStartedAt = performance.now();
        const uploadedThumbnail = input.item.uploadedThumbnailPath
          ? { path: input.item.uploadedThumbnailPath, publicUrl: input.item.uploadedThumbnailPath, reused: true }
          : await productService.uploadProductThumbnail(photographer.id, thumbnailFile, { fileHash: thumbnailHash, uploadBatchId: input.uploadBatchId });
        const dbStartedAt = performance.now();
        const updatedProduct = await productService.updateProductProcessingMedia(input.productId, {
          thumbnailUrl: uploadedThumbnail.path,
          watermarkUrl: uploadedThumbnail.path,
          thumbnailHash,
        });

        setSelectedFiles((current) => current.map((uploadItem, itemIndex) => (
          itemIndex === input.itemIndex
            ? { ...uploadItem, uploadedThumbnailPath: uploadedThumbnail.path, thumbnailHash }
            : uploadItem
        )));
        setProducts((current) => current.map((product) => (
          product.id === input.productId ? { ...product, ...updatedProduct } : product
        )));

        console.info('[photographer-upload] thumbnail:deferred:done', {
          uploadBatchId: input.uploadBatchId,
          productId: input.productId,
          fileName: thumbnailFile.name,
          thumbnailSize: thumbnailFile.size,
          storagePath: uploadedThumbnail.path,
          reused: 'reused' in uploadedThumbnail ? uploadedThumbnail.reused : false,
          durationMs: Math.round(performance.now() - processingStartedAt),
          hashDurationMs: Math.round(uploadStartedAt - hashStartedAt),
          uploadDurationMs: Math.round(dbStartedAt - uploadStartedAt),
          dbDurationMs: Math.round(performance.now() - dbStartedAt),
        });
      };
      const pumpDeferredThumbnailQueue = () => {
        while (activeDeferredThumbnailTasks < deferredThumbnailConcurrencyLimit && deferredThumbnailQueue.length > 0) {
          const task = deferredThumbnailQueue.shift();
          if (!task) return;
          activeDeferredThumbnailTasks += 1;
          void runDeferredThumbnailProcessing(task).then(() => {
            completedDeferredThumbnailTasks += 1;
          }).catch((error) => {
            failedDeferredThumbnailTasks += 1;
            console.error('[photographer-upload] thumbnail:deferred:failed', {
              uploadBatchId: task.uploadBatchId,
              productId: task.productId,
              fileName: task.uploadFile.name,
              message: error instanceof Error ? error.message : String(error || ''),
            });
          }).finally(() => {
            activeDeferredThumbnailTasks = Math.max(0, activeDeferredThumbnailTasks - 1);
            console.info('[photographer-upload] thumbnail:deferred:progress', {
              uploadBatchId: task.uploadBatchId,
              completed: completedDeferredThumbnailTasks,
              failed: failedDeferredThumbnailTasks,
              active: activeDeferredThumbnailTasks,
              queued: deferredThumbnailQueue.length,
              concurrencyLimit: deferredThumbnailConcurrencyLimit,
            });
            pumpDeferredThumbnailQueue();
          });
        }
      };
      const scheduleDeferredThumbnailProcessing = (input: DeferredThumbnailTask) => {
        deferredThumbnailQueue.push(input);
        console.info('[photographer-upload] thumbnail:deferred:queued', {
          uploadBatchId: input.uploadBatchId,
          productId: input.productId,
          fileName: input.uploadFile.name,
          queued: deferredThumbnailQueue.length,
          active: activeDeferredThumbnailTasks,
          concurrencyLimit: deferredThumbnailConcurrencyLimit,
        });
        pumpDeferredThumbnailQueue();
      };
      const enqueueMediaProcessingJobs = (input: { productId: string; storagePath: string; uploadBatchId: string }) => {
        void productService.enqueueMediaProcessingJobs({
          productId: input.productId,
          photographerId: photographer.id,
          sourceUrl: input.storagePath,
          kinds: ['thumbnail', 'watermark'],
        }).then((jobs) => {
          console.info('[photographer-upload] media-job:queued', {
            uploadBatchId: input.uploadBatchId,
            productId: input.productId,
            count: jobs.length,
            kinds: jobs.map((job) => job.kind),
          });
        });
      };

      await runLimitedConcurrency(uploadQueue, Math.max(1, uploadConcurrencyLimit), async ({ item, index }, queueIndex) => {
        let uploadStage: UploadPublishStage = 'validacao';
        const fileStartedAt = performance.now();
        let lastStageStartedAt = fileStartedAt;
        const stageDurations: Partial<Record<UploadPublishStage, number>> = {};
        let stageDurationsRecorded = false;
        const markStage = (nextStage: UploadPublishStage) => {
          const now = performance.now();
          stageDurations[uploadStage] = Math.round((stageDurations[uploadStage] || 0) + now - lastStageStartedAt);
          uploadStage = nextStage;
          lastStageStartedAt = now;
        };
        const finalizeStageDurations = () => {
          const now = performance.now();
          if (!stageDurationsRecorded) {
            stageDurations[uploadStage] = Math.round((stageDurations[uploadStage] || 0) + now - lastStageStartedAt);
            recordStageDurations(stageDurations);
            stageDurationsRecorded = true;
          }
          return now;
        };
        try {
          await waitUntilUploadCanContinue();
          updateUploadRuntimeMetric((current) => ({
            ...current,
            activeUploads: current.activeUploads + 1,
            retries: current.retries + Math.max(0, item.attempts > 0 ? 1 : 0),
          }));
          setSelectedFiles((current) => current.map((uploadItem, itemIndex) => (
            itemIndex === index
              ? { ...uploadItem, status: 'uploading', attempts: uploadItem.attempts + 1, error: '', stage: uploadStage }
              : uploadItem
          )));
          console.info('[photographer-upload] file:start', {
            uploadBatchId,
            index: queueIndex + 1,
            total: uploadQueue.length,
            eventId: selectedEvent?.id || null,
            event: normalizedEvent,
            checkpoint: normalizedCheckpoint,
            photographerId: photographer.id,
            fileName: item.file.name,
            fileSize: item.file.size,
            fileType: item.file.type,
          });
          await assertUploadFileReadable(item.file);

          markStage('duplicidade-nome');
          let duplicateAction: DuplicateUploadAction | null = null;
          let existingNameProduct = await productService.findExistingProductByOriginalFileName(photographer.id, item.file.name, normalizedEvent);
          let resolvedOriginalFileName = item.file.name;
          let resolvedDescription = item.description.trim();

          if (existingNameProduct) {
            duplicateAction = await requestDuplicateResolutionQueued({
              index,
              item,
              existingProduct: existingNameProduct,
              eventName: normalizedEvent,
              remainingCount: uploadQueue.length - queueIndex - 1,
            });

            if (duplicateAction === 'cancel') {
              throw new Error('Upload cancelado pelo fotógrafo ao detectar arquivo duplicado.');
            }

            if (duplicateAction === 'copy') {
              resolvedOriginalFileName = createCopyFileName(item.file.name, usedFileNames);
              const copyBaseName = splitFileName(resolvedOriginalFileName).base;
              const originalBaseName = splitFileName(item.file.name).base;
              if (normalizeUploadName(resolvedDescription) === normalizeUploadName(originalBaseName)) {
                resolvedDescription = copyBaseName;
              }
            }
          } else {
            usedFileNames.add(normalizeUploadName(item.file.name));
          }

          markStage('preparo-arquivo');
          const uploadFile = await prepareImageForUpload(item.file);
          assertFileFitsUploadLimit(uploadFile);
          batchPreparedBytes += uploadFile.size;
          console.info('[photographer-upload] file:prepared', {
            uploadBatchId,
            originalName: item.file.name,
            uploadName: uploadFile.name,
            originalSize: item.file.size,
            uploadSize: uploadFile.size,
            uploadType: uploadFile.type,
          });
          if (uploadFile.size !== item.file.size) {
            updateUploadRuntimeMetric((current) => ({
              ...current,
              totalBytes: Math.max(0, current.totalBytes - item.file.size + uploadFile.size),
            }));
          }
          setSelectedFiles((current) => current.map((uploadItem, itemIndex) => itemIndex === index ? { ...uploadItem, preparedFileSize: uploadFile.size, uploadBatchId } : uploadItem));

          markStage('hash-original');
          const fileHash = item.fileHash || await calculateUploadFileSha256(uploadFile);
          setSelectedFiles((current) => current.map((uploadItem, itemIndex) => itemIndex === index ? { ...uploadItem, fileHash, uploadBatchId } : uploadItem));

          markStage('duplicidade-conteudo');
          if (duplicateAction !== 'replace' && currentBatchHashes.has(fileHash)) {
            skippedDuplicateCount += 1;
            console.info('[photographer-upload] file:skipped-duplicate-batch', {
              uploadBatchId,
              fileName: item.file.name,
              fileHash,
            });
            setSelectedFiles((current) => current.map((uploadItem, itemIndex) => itemIndex === index ? { ...uploadItem, status: 'skipped', uploadedAt: new Date().toISOString(), stage: uploadStage } : uploadItem));
            finalizeStageDurations();
            markUploadCompleted();
            return;
          }
          currentBatchHashes.add(fileHash);

          const existingProduct = duplicateAction === 'replace'
            ? null
            : await productService.findExistingProductByFileHash(photographer.id, fileHash, normalizedEvent);
          if (existingProduct) {
            skippedDuplicateCount += 1;
            console.info('[photographer-upload] file:skipped-duplicate-existing', {
              uploadBatchId,
              fileName: item.file.name,
              fileHash,
              productId: existingProduct.id,
            });
            setSelectedFiles((current) => current.map((uploadItem, itemIndex) => itemIndex === index ? { ...uploadItem, status: 'skipped', uploadedAt: new Date().toISOString(), stage: uploadStage } : uploadItem));
            finalizeStageDurations();
            markUploadCompleted();
            return;
          }

          markStage('upload-original');
          const uploadedFile = item.uploadedFilePath
            ? { path: item.uploadedFilePath, publicUrl: item.uploadedFilePath, reused: true }
            : await (async () => {
                console.info('[photographer-upload] storage:upload:start', {
                  uploadBatchId,
                  fileName: uploadFile.name,
                  originalFileName: item.file.name,
                  eventId: selectedEvent?.id || null,
                  photographerId: photographer.id,
                  size: uploadFile.size,
                  contentType: uploadFile.type,
                });
                return productService.uploadProductFile(photographer.id, uploadFile, { fileHash, uploadBatchId });
              })();
          console.info('[photographer-upload] storage:upload:done', {
            uploadBatchId,
            fileName: uploadFile.name,
            storagePath: uploadedFile.path,
            reused: 'reused' in uploadedFile ? uploadedFile.reused : false,
          });
          if (!('reused' in uploadedFile) || !uploadedFile.reused) {
            batchUploadedOriginalBytes += uploadFile.size;
          }
          updateUploadRuntimeMetric((current) => ({
            ...current,
            uploadedBytes: current.uploadedBytes + uploadFile.size,
          }));
          setSelectedFiles((current) => current.map((uploadItem, itemIndex) => itemIndex === index ? { ...uploadItem, status: 'uploaded', uploadedFilePath: uploadedFile.path, fileHash, uploadBatchId, stage: uploadStage } : uploadItem));
          const shouldProcessThumbnailInline = false;
          let thumbnailFile: File | null = null;
          try {
            markStage('preview');
            thumbnailFile = shouldProcessThumbnailInline ? await generateMediaThumbnail(uploadFile) : null;
          } catch (thumbnailError) {
            console.warn(`Preview não gerado para ${item.name}:`, thumbnailError);
          }
          if (!thumbnailFile && shouldProcessThumbnailInline) {
            previewWarnings.push({
              name: item.name,
              message: uploadFile.type.startsWith('video')
                ? 'Preview do vídeo não foi gerado; o card usará fallback visual até o reparo.'
                : 'Preview da foto não foi gerado; o card usará a mídia original protegida como fallback.',
            });
          }
          markStage('hash-preview');
          const thumbnailHash = item.thumbnailHash || (thumbnailFile ? await calculateUploadFileSha256(thumbnailFile) : null);
          if (thumbnailFile && !item.uploadedThumbnailPath) {
            updateUploadRuntimeMetric((current) => ({
              ...current,
              totalBytes: current.totalBytes + thumbnailFile.size,
            }));
          }
          markStage('upload-preview');
          const uploadedThumbnail = thumbnailFile
            ? item.uploadedThumbnailPath
              ? { path: item.uploadedThumbnailPath, publicUrl: item.uploadedThumbnailPath, reused: true }
              : await productService.uploadProductThumbnail(photographer.id, thumbnailFile, { fileHash: thumbnailHash ?? undefined, uploadBatchId })
            : null;
          if (uploadedThumbnail) {
            console.info('[photographer-upload] thumbnail:upload:done', {
              uploadBatchId,
              fileName: thumbnailFile?.name,
              storagePath: uploadedThumbnail.path,
              reused: 'reused' in uploadedThumbnail ? uploadedThumbnail.reused : false,
            });
            if (thumbnailFile) {
              updateUploadRuntimeMetric((current) => ({
                ...current,
                uploadedBytes: current.uploadedBytes + thumbnailFile.size,
              }));
            }
          }
          setSelectedFiles((current) => current.map((uploadItem, itemIndex) => itemIndex === index ? { ...uploadItem, status: 'uploaded', uploadedFilePath: uploadedFile.path, uploadedThumbnailPath: uploadedThumbnail?.path || null, thumbnailHash, fileHash, uploadBatchId, stage: uploadStage } : uploadItem));

          const productPayload = {
            name: resolvedDescription,
            price: Number(item.price),
            url: uploadedFile.path,
            type: item.file.type.startsWith('image') ? 'IMG' : 'VIDEO',
            vendedorId: photographer.id,
            event: normalizedEvent,
            eventId: selectedEvent?.id || null,
            checkpoint: normalizedCheckpoint,
            bib: item.bib.trim(),
            thumbnailUrl: uploadedThumbnail?.path,
            watermarkUrl: uploadedThumbnail?.path,
            storagePath: uploadedFile.path,
            fileHash,
            fileSize: uploadFile.size,
            originalFileName: resolvedOriginalFileName,
            thumbnailHash,
            uploadBatchId,
            status: 'published'
          } satisfies Omit<Product, 'id'>;

          let indexedPhotoId: string | null = null;
          markStage('banco');
          if (duplicateAction === 'replace' && existingNameProduct) {
            await productService.replaceProductMediaResilient(existingNameProduct.id, productPayload);
            indexedPhotoId = existingNameProduct.id;
            await productService.logUploadConflictAction({
              action: 'upload_replace',
              productId: existingNameProduct.id,
              metadata: {
                event: normalizedEvent,
                previousFileName: existingNameProduct.originalFileName || existingNameProduct.name,
                uploadedFileName: item.file.name,
                storagePath: uploadedFile.path,
                uploadBatchId,
              },
            });
            replacedCount += 1;
          } else {
            const productId = await createProductBatched(productPayload);
            indexedPhotoId = productId;
            if (duplicateAction === 'copy') {
              await productService.logUploadConflictAction({
                action: 'upload_copy',
                productId,
                metadata: {
                  event: normalizedEvent,
                  originalFileName: item.file.name,
                  copyFileName: resolvedOriginalFileName,
                  storagePath: uploadedFile.path,
                  uploadBatchId,
                },
              });
              copiedCount += 1;
            }
            publishedCount += 1;
          }
          setSelectedFiles((current) => current.map((uploadItem, itemIndex) => itemIndex === index ? { ...uploadItem, status: 'db_saved', productId: indexedPhotoId, error: '', stage: uploadStage } : uploadItem));
          console.info('[photographer-upload] db:published', {
            uploadBatchId,
            photoId: indexedPhotoId,
            eventId: selectedEvent?.id || null,
            storagePath: uploadedFile.path,
            originalFileName: resolvedOriginalFileName,
            action: duplicateAction === 'replace' ? 'replace' : duplicateAction === 'copy' ? 'copy' : 'create',
          });
          if (indexedPhotoId && selectedEvent?.id && uploadFile.type.startsWith('image/')) {
            const faceIndexPhotoId = indexedPhotoId;
            const faceIndexEventId = selectedEvent.id;
            console.info('[face-index] request:start', {
              photoId: indexedPhotoId,
              eventId: faceIndexEventId,
              uploadBatchId,
            });
            setSelectedFiles((current) => current.map((uploadItem, itemIndex) => itemIndex === index
              ? { ...uploadItem, faceIndexStatus: 'pending', faceIndexError: null }
              : uploadItem));
            void productService.indexProductFace(faceIndexPhotoId, faceIndexEventId)
              .then((result) => {
                setSelectedFiles((current) => current.map((uploadItem, itemIndex) => itemIndex === index
                  ? { ...uploadItem, faceIndexStatus: result.status as Product['faceIndexStatus'], faceIndexError: null }
                  : uploadItem));
                console.info('[face-index] request:accepted', {
                  photoId: faceIndexPhotoId,
                  eventId: faceIndexEventId,
                  uploadBatchId,
                  status: result.status,
                  facesIndexed: result.facesIndexed,
                  attempt: result.attempt,
                  reused: result.reused,
                });
              })
              .catch((faceIndexError) => {
                const message = faceIndexError instanceof Error ? faceIndexError.message : String(faceIndexError || '');
                setSelectedFiles((current) => current.map((uploadItem, itemIndex) => itemIndex === index
                  ? { ...uploadItem, faceIndexStatus: 'failed', faceIndexError: message }
                  : uploadItem));
                console.error('[face-index] request:failed', {
                  photoId: faceIndexPhotoId,
                  eventId: faceIndexEventId,
                  uploadBatchId,
                  message,
                });
              });
          }
          if (indexedPhotoId) {
            enqueueMediaProcessingJobs({
              productId: indexedPhotoId,
              storagePath: uploadedFile.path,
              uploadBatchId,
            });
            deferredThumbnailCount += 1;
            scheduleDeferredThumbnailProcessing({
              productId: indexedPhotoId,
              item,
              itemIndex: index,
              uploadFile,
              uploadBatchId,
            });
          }
          markStage('indexacao-facial');
          setSelectedFiles((current) => current.map((uploadItem, itemIndex) => itemIndex === index ? { ...uploadItem, status: 'published', uploadedAt: new Date().toISOString(), error: '', productId: indexedPhotoId, stage: uploadStage } : uploadItem));
          markUploadCompleted();
          const finishedAt = finalizeStageDurations();
          console.info('[photographer-upload] file:done', {
            uploadBatchId,
            index: queueIndex + 1,
            total: uploadQueue.length,
            fileName: item.file.name,
            originalSize: item.file.size,
            uploadSize: uploadFile.size,
            durationMs: Math.round(finishedAt - fileStartedAt),
            stageDurationsMs: stageDurations,
          });
        } catch (fileError) {
          const message = fileError instanceof Error ? fileError.message : String(fileError);
          if (/Upload cancelado pelo fot/i.test(message)) {
            throw fileError;
          }
          const friendlyMessage = /sess[aã]o expirada/i.test(message)
            ? 'Credencial do bucket expirada ou invalida. Gere um novo BUCKET_API_TOKEN no provedor, atualize o .env/deploy e reinicie o backend.'
            : message;
          const formattedMessage = formatUploadErrorMessage(friendlyMessage, item.file);
          const failedAt = finalizeStageDurations();
          console.error('[photographer-upload] file:failed', {
            uploadBatchId,
            index: queueIndex + 1,
            total: uploadQueue.length,
            stage: uploadStage,
            stageLabel: getUploadStageLabel(uploadStage),
            eventId: selectedEvent?.id || null,
            event: normalizedEvent,
            checkpoint: normalizedCheckpoint,
            photographerId: photographer.id,
            fileName: item.name,
            fileSize: item.file.size,
            fileType: item.file.type,
            message: formattedMessage,
            durationMs: Math.round(failedAt - fileStartedAt),
            stageDurationsMs: stageDurations,
          });
          failedUploads.push({
            index,
            name: item.name,
            message: formattedMessage,
            stage: uploadStage,
          });
          updateUploadRuntimeMetric((current) => ({
            ...current,
            failedFiles: current.failedFiles + 1,
          }));
          setSelectedFiles((current) => current.map((uploadItem, itemIndex) => itemIndex === index ? { ...uploadItem, status: browserOnlineRef.current ? 'failed' : 'paused', error: formattedMessage, stage: uploadStage } : uploadItem));
          markUploadCompleted();
        } finally {
          updateUploadRuntimeMetric((current) => ({
            ...current,
            activeUploads: Math.max(0, current.activeUploads - 1),
          }));
        }
      });
      const batchDurationMs = Math.round(performance.now() - batchStartedAt);
      const batchStageDurationsMs = Object.fromEntries(batchStageDurations.entries());
      const batchStageAverageMs = Object.fromEntries(
        Array.from(batchStageDurations.entries()).map(([stage, duration]) => [
          stage,
          Math.round(duration / Math.max(1, batchStageCounts.get(stage) || 1)),
        ]),
      );
      const primaryBottleneck = Array.from(batchStageDurations.entries()).sort(([, left], [, right]) => right - left)[0] || null;
      console.info('[photographer-upload] batch:done', {
        uploadBatchId,
        total: uploadQueue.length,
        publishedCount,
        replacedCount,
        copiedCount,
        skippedDuplicateCount,
        failedCount: failedUploads.length,
        durationMs: batchDurationMs,
        concurrencyLimit: Math.max(1, uploadConcurrencyLimit),
        rawBytes: batchTotalBytes,
        preparedBytes: batchPreparedBytes,
        uploadedOriginalBytes: batchUploadedOriginalBytes,
        effectiveOriginalUploadMBps: batchDurationMs > 0
          ? Number((batchUploadedOriginalBytes / 1024 / 1024 / (batchDurationMs / 1000)).toFixed(3))
          : 0,
        stageDurationsMs: batchStageDurationsMs,
        stageAverageMs: batchStageAverageMs,
        primaryBottleneckStage: primaryBottleneck?.[0] || null,
        primaryBottleneckLabel: primaryBottleneck ? getUploadStageLabel(primaryBottleneck[0]) : null,
        primaryBottleneckDurationMs: primaryBottleneck?.[1] || 0,
        deferredThumbnailCount,
      });

      if (publishedCount === 0 && failedUploads.length > 0) {
        const firstFailure = failedUploads[0];
        throw new Error(`Não foi possível localizar alguns arquivos durante a publicação. Verifique se as fotos ainda existem no armazenamento e tente novamente. Publicadas: 0 fotos. Falharam: ${failedUploads.length} fotos. Primeiro erro: ${firstFailure.name} - etapa ${getUploadStageLabel(firstFailure.stage)} - ${firstFailure.message}`);
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
        const previewWarningText = previewWarnings.length > 0
          ? ` ${previewWarnings.length} preview(s) dos arquivos publicados ficaram com fallback visual.`
          : '';
        const deferredText = deferredThumbnailCount > 0 ? ` ${deferredThumbnailCount} preview(s) seguem processando em segundo plano.` : '';
        setUploadCompletionNotice(`Upload parcial concluido. Publicadas: ${publishedCount} foto(s). Falharam: ${failedUploads.length}. Duplicadas ignoradas: ${skippedDuplicateCount}.${previewWarningText}${deferredText} Primeiro erro: ${failedUploads[0].name} - etapa ${getUploadStageLabel(failedUploads[0].stage)} - ${failedUploads[0].message}`);
      } else {
        clearSelectedFiles();
        setPreviewIndex(0);
        setShowUploadModal(false);
        const previewWarningText = previewWarnings.length > 0
          ? ` ${previewWarnings.length} preview(s) não foram gerados e ficaram com fallback visual.`
          : '';
        const deferredText = deferredThumbnailCount > 0 ? ` ${deferredThumbnailCount} preview(s) seguem processando em segundo plano.` : '';
        setUploadCompletionNotice(skippedDuplicateCount > 0
          ? `Upload concluído: ${publishedCount} publicado(s), ${replacedCount} substituído(s), ${copiedCount} cópia(s), ${skippedDuplicateCount} duplicado(s) ignorado(s).${previewWarningText}${deferredText}`
          : `Upload realizado com sucesso: ${publishedCount} arquivo(s) publicado(s), ${replacedCount} substituido(s), ${copiedCount} copia(s).${previewWarningText}${deferredText}`);
      }
    } catch (error) {
      console.error("Erro no upload:", error);
      alert(error instanceof Error ? error.message : "Erro ao realizar upload.");
    } finally {
      setUploadRuntimeMetrics((current) => ({
        ...current,
        completedAt: Date.now(),
        activeUploads: 0,
      }));
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
            <img src={currentPhotographer.profilePhoto || currentPhotographer.avatar} alt="Me" className="w-full h-full object-cover" />
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
          <SidebarLink
            icon={<LinkIcon />}
            label="Indicações"
            active={activeTab === 'referrals'}
            onClick={() => setActiveTab('referrals')}
          />
          <SidebarLink
            icon={<Settings />}
            label="Perfil Publico"
            active={activeTab === 'profile'}
            onClick={() => setActiveTab('profile')}
          />
        </nav>

        <div className="p-5 mt-auto">
          <div className="bg-white/5 p-4 border border-white/10 mb-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-11 h-11 rounded-full overflow-hidden bg-white border border-white/15">
                <img src={currentPhotographer.profilePhoto || currentPhotographer.avatar} alt="Me" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-sans text-sm font-black truncate">{currentPhotographer.displayName || currentPhotographer.name}</p>
                <p className="font-mono text-[10px] text-gray-400 truncate tracking-tight">{currentPhotographer.email}</p>
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
              {activeTab === 'referrals' && 'Minhas Indicações'}
              {activeTab === 'profile' && 'Perfil Publico'}
            </h2>
            <p className="font-sans text-sm text-gray-400">Bem-vindo de volta, {currentPhotographer.name.split(' ')[0]}!</p>
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
                    <p className="font-sans font-black text-sm uppercase text-white">Notificações</p>
                    <p className="font-mono text-[10px] uppercase text-gray-500">
                      {photographerNotifications.length === 1 ? '1 item do painel' : `${photographerNotifications.length} itens do painel`}
                    </p>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {photographerNotifications.length === 0 ? (
                      <div className="p-5 text-center">
                        <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-3" />
                        <p className="font-mono text-[10px] uppercase text-gray-400">Nenhuma notificação no momento.</p>
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
                  value={formatCurrency(dashboardMetrics.totalEarnings)}
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
                  value={visibleProductStats.total}
                  icon={<ImageIcon />}
                  trend={`${visibleProductStats.photos} fotos / ${visibleProductStats.videos} videos`}
                />
                <StatCard
                  label="Aguardando Resgate"
                  value={formatCurrency(dashboardMetrics.pendingEarnings)}
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
                        { id: 'event-3', title: 'Aniversário', date: '05 JUN, 2026', time: '18:00' },
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
                <div className="bg-[#0d131c] border border-white/10 overflow-hidden">
                  <div className="p-6 border-b border-white/10">
                    <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-brutal-accent mb-3">Eventos</p>
                    <h3 className="font-sans font-black text-2xl uppercase text-white leading-none">Organize sua operação</h3>
                    <p className="font-mono text-[10px] uppercase leading-relaxed text-gray-500 mt-3">
                      Crie páginas por prova, defina a publicação e escolha uma capa para destacar o catálogo.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 border-b border-white/10">
                    <div className="p-5 border-r border-white/10">
                      <p className="font-mono text-[9px] uppercase text-gray-500">Eventos</p>
                      <p className="font-sans font-black text-3xl text-white mt-1">{availableEvents.length}</p>
                    </div>
                    <div className="p-5">
                      <p className="font-mono text-[9px] uppercase text-gray-500">Publicados</p>
                      <p className="font-sans font-black text-3xl text-green-400 mt-1">
                        {availableEvents.filter((eventItem) => eventItem.isPublished !== false).length}
                      </p>
                    </div>
                  </div>

                  <div className="p-6 space-y-3">
                    <button
                      type="button"
                      onClick={openNewEventModal}
                      className="w-full h-14 bg-brutal-accent text-white border border-brutal-accent font-sans font-black text-sm uppercase tracking-widest hover:bg-white hover:text-brutal-accent transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
                    >
                      <Plus className="w-5 h-5" />
                      Novo Evento
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowUploadModal(true)}
                      className="w-full h-12 border border-white/15 text-gray-300 font-mono text-[10px] uppercase tracking-widest hover:text-white hover:border-white/30 transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
                    >
                      <Upload className="w-4 h-4" />
                      Enviar capturas
                    </button>
                  </div>
                </div>

                <div className="bg-[#0d131c] border border-white/10">
                  <div className="p-5 border-b border-white/10 flex items-center justify-between gap-4">
                    <div>
                      <h3 className="font-sans font-black text-base uppercase text-white">Eventos do fotógrafo</h3>
                      <p className="font-mono text-[10px] uppercase text-gray-500">{availableEvents.length === 1 ? '1 evento cadastrado' : `${availableEvents.length} eventos cadastrados`}</p>
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
                        const inferredEvent = isInferredEvent(eventItem);
                        const eventProducts = products.filter((product) => product.event === eventItem.name);
                        const eventRevenue = periodSales
                          .filter((sale) => sale.event === eventItem.name)
                          .reduce((total, sale) => total + Number(sale.netAmount || 0), 0);
                        return (
                          <div key={eventItem.id} className="p-5 grid gap-4 hover:bg-white/[0.02] transition-colors">
                            <div className="grid gap-4 lg:grid-cols-[120px_1fr_auto] lg:items-start">
                              <div className="aspect-video bg-[#05080d] border border-white/10 overflow-hidden">
                                {eventItem.coverImage ? (
                                  eventItem.coverImage.match(/\.(mp4|webm|mov)(\?|$)/i) ? (
                                    <video src={eventItem.coverImage} className="w-full h-full object-contain" muted preload="metadata" />
                                  ) : (
                                    <img src={eventItem.coverImage} alt={eventItem.name} style={{ objectPosition: eventItem.cover_position || 'center center' }} className="w-full h-full object-contain" />
                                  )
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <CalendarDays className="w-7 h-7 text-gray-600" />
                                  </div>
                                )}
                              </div>

                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                  <span className={`px-2 py-1 font-mono text-[8px] uppercase border ${eventItem.isPublished === false ? 'border-yellow-400/30 bg-yellow-400/10 text-yellow-200' : 'border-green-400/30 bg-green-400/10 text-green-200'}`}>
                                    {eventItem.isPublished === false ? 'Oculto' : 'Publicado'}
                                  </span>
                                  {inferredEvent && (
                                    <span className="px-2 py-1 font-mono text-[8px] uppercase border border-orange-400/30 bg-orange-400/10 text-orange-200">
                                      Detectado nas mídias
                                    </span>
                                  )}
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
                              <div className="flex lg:flex-col gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleEditEvent(eventItem)}
                                  className="h-10 px-3 border border-white/15 text-white font-mono text-[10px] uppercase hover:border-brutal-accent"
                                >
                                  {inferredEvent ? 'Cadastrar' : 'Editar'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleEventPublication(eventItem)}
                                  disabled={inferredEvent}
                                  className={`h-10 px-3 border border-white/15 font-mono text-[10px] uppercase ${inferredEvent ? 'cursor-not-allowed text-gray-600 opacity-60' : 'text-gray-300 hover:text-white'}`}
                                >
                                  {eventItem.isPublished === false ? 'Publicar' : 'Ocultar'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveEvent(eventItem)}
                                  disabled={inferredEvent}
                                  className={`h-10 px-3 border border-red-500/40 font-mono text-[10px] uppercase ${inferredEvent ? 'cursor-not-allowed text-red-900 opacity-60' : 'text-red-200 hover:bg-red-500/10'}`}
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
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">Aguardando publicação</p>
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
                  <h3 className="font-sans font-black text-base uppercase text-white">
                    {selectedProductEventName ? 'Produtos do evento' : 'Eventos publicados'}
                  </h3>
                  <p className="font-mono text-[10px] uppercase text-gray-500">
                    {selectedProductEventName
                      ? `${scopedFilteredProducts.length === 1 ? '1 produto' : `${scopedFilteredProducts.length} produtos`} neste evento`
                      : `${productEventCards.length === 1 ? '1 evento' : `${productEventCards.length} eventos`} com ${filteredProducts.length === 1 ? '1 mídia' : `${filteredProducts.length} mídias`}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={toggleAllFilteredProducts}
                    disabled={scopedFilteredProducts.length === 0 || isBulkRemovingProducts}
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
                      }}
                      className="font-mono text-[10px] uppercase font-bold text-brutal-accent hover:text-white transition-colors cursor-pointer"
                    >
                      Limpar filtros
                    </button>
                  )}
                </div>
              </div>

              {productEventCards.length > 0 || selectedProductEventName ? (
                <div className="space-y-8">
                  {!selectedProductEventName ? (
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
                            onClick={() => {
                              setSelectedProductIds(new Set());
                              setSelectedProductEventName(eventItem.name);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setSelectedProductIds(new Set());
                                setSelectedProductEventName(eventItem.name);
                              }
                            }}
                            className={`group bg-white text-brutal-black border-2 overflow-hidden text-left transition-all ${isActive ? 'border-brutal-accent ring-2 ring-brutal-accent/40' : 'border-brutal-black hover:border-brutal-accent'
                              }`}
                          >
                            <div className="relative aspect-video bg-[#05080d] overflow-hidden border-b-2 border-brutal-black">
                              {eventItem.coverUrl ? (
                                eventItem.coverUrl.match(/\.(mp4|webm|mov)(\?|$)/i) ? (
                                  <video src={eventItem.coverUrl} className="w-full h-full object-contain opacity-85" muted preload="metadata" />
                                ) : (
                                  <img src={eventItem.coverUrl} alt={eventItem.name} style={{ objectPosition: eventItem.coverPosition || 'center center' }} className="w-full h-full object-contain opacity-85" />
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
                                  {eventItem.items === 1 ? '1 mídia' : `${eventItem.items} mídias`}
                                </p>
                                <p className="font-mono text-[9px] uppercase tracking-widest text-gray-400">
                                  {eventItem.createdAtLabel === 'Criação não registrada' ? eventItem.createdAtLabel : `Criado em ${eventItem.createdAtLabel}`}
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
                  ) : (
                    <div className="bg-[#0d131c] border border-white/10 overflow-hidden">
                      <div className="grid lg:grid-cols-[360px_1fr]">
                        <div className="relative min-h-60 bg-[#05080d] overflow-hidden">
                          {selectedProductEventCard?.coverUrl ? (
                            selectedProductEventCard.coverUrl.match(/\.(mp4|webm|mov)(\?|$)/i) ? (
                              <video src={selectedProductEventCard.coverUrl} className="absolute inset-0 w-full h-full object-contain opacity-80" muted preload="metadata" />
                            ) : (
                              <img src={selectedProductEventCard.coverUrl} alt={selectedProductEventCard.name} style={{ objectPosition: selectedProductEventCard.coverPosition || 'center center' }} className="absolute inset-0 w-full h-full object-contain opacity-80" />
                            )
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <CalendarDays className="w-16 h-16 text-gray-700" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-linear-to-t from-[#0d131c] via-[#0d131c]/20 to-transparent" />
                          <div className="absolute left-5 top-5 bg-brutal-accent text-white px-3 py-1 font-mono text-[10px] uppercase font-bold tracking-widest">
                            {selectedProductEventCard?.dateLabel || 'Evento'}
                          </div>
                        </div>

                        <div className="p-6 md:p-8 flex flex-col justify-between gap-6">
                          <div>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedProductIds(new Set());
                                setSelectedProductEventName('');
                              }}
                              className="mb-5 inline-flex h-10 items-center gap-2 border border-white/15 px-3 font-mono text-[10px] uppercase text-gray-300 hover:text-white hover:border-brutal-accent"
                            >
                              <ChevronRight className="w-4 h-4 rotate-180" />
                              Voltar para eventos
                            </button>
                            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-brutal-accent font-bold mb-3">
                              Evento selecionado
                            </p>
                            <h3 className="font-sans font-black text-3xl md:text-5xl uppercase text-white leading-none">
                              {selectedProductEventName}
                            </h3>
                            <p className="font-mono text-xs uppercase tracking-widest text-gray-500 mt-4">
                              {selectedProductEventCard?.checkpoint || 'Local a confirmar'}
                            </p>
                          </div>

                          <div className="grid grid-cols-3 gap-3">
                            <div className="bg-[#080d14] border border-white/10 p-3">
                              <p className="font-mono text-[9px] uppercase text-gray-500">Mídias</p>
                              <p className="font-sans font-black text-2xl text-white">{selectedProductEventCard?.items || scopedFilteredProducts.length}</p>
                            </div>
                            <div className="bg-[#080d14] border border-white/10 p-3">
                              <p className="font-mono text-[9px] uppercase text-gray-500">Fotos</p>
                              <p className="font-sans font-black text-2xl text-brutal-accent">{selectedProductEventCard?.photos || 0}</p>
                            </div>
                            <div className="bg-[#080d14] border border-white/10 p-3">
                              <p className="font-mono text-[9px] uppercase text-gray-500">Videos</p>
                              <p className="font-sans font-black text-2xl text-yellow-400">{selectedProductEventCard?.videos || 0}</p>
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => openUploadForEvent(selectedProductEventName)}
                              className="h-12 w-full sm:w-fit px-5 bg-brutal-accent text-white border border-brutal-accent font-sans font-black text-xs uppercase tracking-widest hover:bg-white hover:text-brutal-accent transition-colors inline-flex items-center justify-center gap-2"
                            >
                              <Plus className="w-4 h-4" />
                              Adicionar fotos
                            </button>
                            {selectedProductEventDetail && (
                              <button
                                type="button"
                                onClick={() => handleEditEvent(selectedProductEventDetail, { keepActiveTab: true })}
                                className="h-12 w-full sm:w-fit px-5 border border-white/15 text-white font-sans font-black text-xs uppercase tracking-widest hover:border-brutal-accent hover:text-brutal-accent transition-colors inline-flex items-center justify-center gap-2"
                              >
                                <Settings className="w-4 h-4" />
                                Editar evento
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {selectedProductEventName && visibleGroupedProducts.map(({ eventName, products: groupProducts }) => (
                    <div key={eventName} className="space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 p-4 bg-[#0b1016] border border-white/10">
                        <div>
                          <p className="font-sans font-black text-sm uppercase text-white truncate">{eventName}</p>
                          <p className="font-mono text-[10px] uppercase text-gray-500 mt-1">{groupProducts.length === 1 ? '1 produto neste evento' : `${groupProducts.length} produtos neste evento`}</p>
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
                  {selectedProductEventName && visibleGroupedProducts.length === 0 && (
                    <div className="bg-[#0d131c] border border-white/10 p-10 text-center">
                      <Search className="w-10 h-10 text-gray-600 mx-auto mb-4" />
                      <h3 className="font-sans font-black text-xl uppercase text-white mb-2">Nenhuma mídia neste filtro</h3>
                      <p className="font-mono text-xs uppercase text-gray-500">Limpe a busca ou ajuste os filtros para ver os produtos deste evento.</p>
                    </div>
                  )}
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

          {activeTab === 'profile' && (
            <motion.div
              key="profile"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5"
            >
              <div className="bg-[#0d131c] border border-white/10">
                <div className="p-5 border-b border-white/10">
                  <h3 className="font-sans font-black text-base uppercase text-white">Dados publicos</h3>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mt-1">
                    Estes dados aparecem na vitrine /fotografo/[slug].
                  </p>
                </div>
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-gray-500">Nome publico</span>
                    <input
                      value={profileForm.displayName}
                      onChange={(event) => setProfileForm((current) => ({ ...current, displayName: event.target.value }))}
                      className="h-12 w-full bg-[#080d14] border border-white/15 px-4 text-sm text-white outline-none focus:border-brutal-accent"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-gray-500">Nome cadastral</span>
                    <input
                      value={profileForm.name}
                      onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))}
                      className="h-12 w-full bg-[#080d14] border border-white/15 px-4 text-sm text-white outline-none focus:border-brutal-accent"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-gray-500">URL publica</span>
                    <div className="flex h-12 overflow-hidden border border-white/15 bg-[#080d14] focus-within:border-brutal-accent">
                      <span className="inline-flex items-center border-r border-white/10 px-3 font-mono text-[10px] uppercase text-gray-500">funpace.media/</span>
                      <input
                        value={profileForm.username}
                        onChange={(event) => setProfileForm((current) => ({ ...current, username: normalizePhotographerUsername(event.target.value) }))}
                        className="min-w-0 flex-1 bg-transparent px-3 text-sm text-white outline-none"
                      />
                    </div>
                  </label>
                  <label className="h-12 self-end px-4 bg-[#080d14] border border-white/15 flex items-center justify-between gap-3 cursor-pointer">
                    <span className="font-mono text-[10px] uppercase text-gray-300">Perfil publico</span>
                    <input
                      type="checkbox"
                      checked={profileForm.isPublic}
                      onChange={(event) => setProfileForm((current) => ({ ...current, isPublic: event.target.checked }))}
                      className="h-5 w-5 accent-brutal-accent"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-gray-500">Instagram</span>
                    <input
                      value={profileForm.instagram}
                      onChange={(event) => setProfileForm((current) => ({ ...current, instagram: event.target.value }))}
                      placeholder="@perfil"
                      className="h-12 w-full bg-[#080d14] border border-white/15 px-4 text-sm text-white outline-none focus:border-brutal-accent"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-gray-500">Cidade</span>
                    <input
                      value={profileForm.city}
                      onChange={(event) => setProfileForm((current) => ({ ...current, city: event.target.value }))}
                      className="h-12 w-full bg-[#080d14] border border-white/15 px-4 text-sm text-white outline-none focus:border-brutal-accent"
                    />
                  </label>
                  <ProfileImageUploader
                    kind="avatar"
                    label="Foto de perfil"
                    description="JPG, PNG ou WEBP até 5 MB. A imagem será recortada em 512x512."
                    actionLabel="Selecionar Foto"
                    previewUrl={pendingProfileImages.avatar?.previewUrl || profileForm.avatar}
                    error={profileImageErrors.avatar}
                    disabled={isSavingProfile}
                    onSelect={(file) => handleSelectProfileImage('avatar', file)}
                    onRemove={() => handleRemoveProfileImage('avatar')}
                  />
                  <ProfileImageUploader
                    kind="cover"
                    label="Banner de capa"
                    description="JPG, PNG ou WEBP até 15 MB. A imagem será otimizada em formato panorâmico."
                    actionLabel="Selecionar Banner"
                    previewUrl={pendingProfileImages.cover?.previewUrl || profileForm.coverPhoto}
                    error={profileImageErrors.cover}
                    disabled={isSavingProfile}
                    onSelect={(file) => handleSelectProfileImage('cover', file)}
                    onRemove={() => handleRemoveProfileImage('cover')}
                  />
                  <label className="space-y-2 md:col-span-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-gray-500">Biografia</span>
                    <textarea
                      value={profileForm.bio}
                      onChange={(event) => setProfileForm((current) => ({ ...current, bio: event.target.value }))}
                      rows={6}
                      className="w-full resize-none bg-[#080d14] border border-white/15 px-4 py-3 text-sm leading-relaxed text-white outline-none focus:border-brutal-accent"
                    />
                  </label>
                  {(profileSaveError || profileSaveSuccess) && (
                    <div className={`md:col-span-2 border p-3 font-mono text-[10px] uppercase tracking-widest ${profileSaveError
                      ? 'border-red-400/30 bg-red-500/10 text-red-200'
                      : 'border-green-400/30 bg-green-500/10 text-green-200'
                      }`}>
                      {profileSaveError || profileSaveSuccess}
                    </div>
                  )}
                  <div className="md:col-span-2 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between pt-2">
                    <a
                      href={publicProfileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] uppercase tracking-widest text-brutal-accent hover:text-white"
                    >
                      Abrir perfil publico
                    </a>
                    <button
                      type="button"
                      disabled={isSavingProfile}
                      onClick={handleSavePublicProfile}
                      className="h-12 px-6 bg-brutal-accent text-white border border-brutal-accent font-sans text-xs font-black uppercase tracking-wide hover:bg-white hover:text-brutal-accent transition-colors disabled:opacity-60"
                    >
                      {isSavingProfile ? 'Salvando...' : 'Salvar Perfil'}
                    </button>
                  </div>
                </div>
              </div>

              <aside className="bg-[#0d131c] border border-white/10 overflow-hidden">
                <div className="h-40 bg-[#05080d]">
                  {pendingProfileImages.cover?.previewUrl || profileForm.coverPhoto ? (
                    <img src={pendingProfileImages.cover?.previewUrl || profileForm.coverPhoto} alt="Banner" className="h-full w-full object-cover opacity-80" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-gray-600"><ImageIcon className="w-10 h-10" /></div>
                  )}
                </div>
                <div className="p-5 -mt-12">
                  <div className="w-24 h-24 bg-white border-4 border-[#0d131c] overflow-hidden">
                    {pendingProfileImages.avatar?.previewUrl || profileForm.avatar ? (
                      <img src={pendingProfileImages.avatar?.previewUrl || profileForm.avatar} alt="Perfil" className="h-full w-full object-cover" />
                    ) : (
                      <Users className="h-full w-full p-4 text-gray-300" />
                    )}
                  </div>
                  <h3 className="font-sans font-black text-2xl text-white mt-4">{profileForm.displayName || profileForm.name}</h3>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mt-2">{profileForm.city || 'Cidade não informada'}</p>
                  <div className="grid grid-cols-3 gap-2 mt-5">
                    <div className="bg-[#080d14] border border-white/10 p-3">
                      <p className="font-sans font-black text-2xl text-white">{availableEvents.length}</p>
                      <p className="font-mono text-[9px] uppercase text-gray-500">Eventos</p>
                    </div>
                    <div className="bg-[#080d14] border border-white/10 p-3">
                      <p className="font-sans font-black text-2xl text-white">{visibleProductStats.photos}</p>
                      <p className="font-mono text-[9px] uppercase text-gray-500">Fotos</p>
                    </div>
                    <div className="bg-[#080d14] border border-white/10 p-3">
                      <p className="font-sans font-black text-2xl text-white">{dashboardMetrics.salesCount}</p>
                      <p className="font-mono text-[9px] uppercase text-gray-500">Vendas</p>
                    </div>
                  </div>
                </div>
              </aside>
            </motion.div>
          )}

          {activeTab === 'referrals' && (
            <motion.div key="referrals" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
              <div className="bg-[#0d131c] border border-white/10 p-6">
                <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
                  <div>
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-brutal-accent/10 border border-brutal-accent/30 text-brutal-accent font-mono text-[10px] uppercase tracking-widest mb-4">
                      <LinkIcon className="w-3.5 h-3.5" />
                      Programa de indicação
                    </div>
                    <h3 className="font-sans font-black text-2xl uppercase text-white">Convide fotógrafos para a Funpace</h3>
                    <p className="font-mono text-xs uppercase leading-relaxed text-gray-400 mt-2 max-w-2xl">
                      Convide fotógrafos para a Funpace e ganhe recompensas quando eles começarem a vender.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyReferralLink}
                    className="h-12 inline-flex items-center justify-center gap-2 bg-brutal-accent border border-brutal-accent px-5 font-sans font-black text-xs uppercase text-white hover:bg-white hover:text-brutal-accent transition-colors"
                  >
                    <Copy className="w-4 h-4" />
                    Copiar meu link
                  </button>
                </div>
                <div className="mt-5 bg-[#080d14] border border-white/10 p-4">
                  <p className="break-all font-mono text-xs text-gray-300">{referralUrl}</p>
                  {referralCopyMessage && <p className="mt-3 font-mono text-[10px] uppercase text-green-400">{referralCopyMessage}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {[
                  ['Total de indicados', referralTotals.total],
                  ['Pendentes', referralTotals.pending],
                  ['Aprovadas', referralTotals.approved],
                  ['Bônus acumulado', formatCurrency(referralTotals.accumulated)],
                  ['Bônus pago', formatCurrency(referralTotals.paid)],
                ].map(([label, value]) => (
                  <div key={String(label)} className="bg-[#0d131c] border border-white/10 p-5">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">{label}</p>
                    <p className="font-sans font-black text-2xl text-white">{value}</p>
                  </div>
                ))}
              </div>

              <div className="bg-[#0d131c] border border-white/10">
                <div className="p-5 border-b border-white/10">
                  <h3 className="font-sans font-black text-base uppercase text-white">Histórico de indicações</h3>
                  <p className="font-mono text-[10px] uppercase text-gray-500">{referrals.length} registro(s)</p>
                </div>
                <div className="divide-y divide-white/10">
                  {referrals.length === 0 ? (
                    <div className="p-8 text-center">
                      <p className="font-sans font-black text-xl uppercase text-white">Nenhuma indicação ainda</p>
                      <p className="font-mono text-[10px] uppercase text-gray-500 mt-2">Compartilhe seu link para começar.</p>
                    </div>
                  ) : referrals.map((referral) => (
                    <div key={referral.id} className="p-5 grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                      <div className="min-w-0">
                        <p className="font-sans font-black text-sm uppercase text-white truncate">Indicado #{referral.referredPhotographerId.slice(0, 8)}</p>
                        <p className="font-mono text-[10px] uppercase text-gray-500">
                          Criado em {new Date(referral.createdAt).toLocaleDateString('pt-BR')} - Código {referral.referralCode}
                        </p>
                      </div>
                      <span className="w-fit border border-white/10 bg-white/5 px-3 py-1 font-mono text-[10px] uppercase text-gray-300">
                        {referral.status}
                      </span>
                      <div className="text-left md:text-right">
                        <p className="font-sans font-black text-lg text-brutal-accent">{formatCurrency(Number(referral.rewardAmount || 0))}</p>
                        <p className="font-mono text-[10px] uppercase text-gray-500">{referral.rewardStatus}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
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
              <div className="bg-[#0d131c] text-white border border-white/10 p-5 md:p-7 flex flex-col xl:flex-row justify-between gap-6 shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-400/10 border border-green-400/20 text-green-300 font-mono text-[10px] uppercase tracking-widest mb-5">
                    <DollarSign className="w-3.5 h-3.5" />
                    Carteira do fotógrafo
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Saldo disponível para repasse</p>
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
                <div className="w-full xl:w-[340px] bg-[#080d14] border border-white/10 p-5 flex flex-col gap-4">
                  <div className="bg-[#05080d] border border-white/10 p-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-widest text-gray-500">Vendas no periodo</p>
                      <p className="font-sans font-black text-4xl text-white leading-none mt-2">{periodMetrics.salesCount}</p>
                    </div>
                    <div className="w-12 h-12 bg-green-400/10 border border-green-400/20 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-6 h-6 text-green-400" />
                    </div>
                  </div>
                  <button
                    disabled={dashboardMetrics.availableBalance <= 0}
                    onClick={() => setShowWithdrawalModal(true)}
                    className="w-full h-14 bg-brutal-accent text-white border border-brutal-accent font-sans font-black text-sm uppercase tracking-widest hover:bg-white hover:text-brutal-accent transition-colors cursor-pointer disabled:bg-white/10 disabled:border-white/10 disabled:text-gray-400 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                  >
                    <DollarSign className="w-4 h-4" />
                    Solicitar Saque
                  </button>
                  <div className="border border-white/10 bg-[#05080d] px-4 py-3">
                    <p className="font-mono text-center text-[10px] text-gray-500 uppercase tracking-widest leading-relaxed">
                      Vendas recentes liberam após 7 dias
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
                <div className="bg-[#0d131c] border border-white/10 p-5 hover:border-white/20 transition-colors">
                  <div className="w-10 h-10 bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                    <TrendingUp className="w-5 h-5 text-green-400" />
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Ganhos totais</p>
                  <p className="font-sans font-black text-3xl text-white">{formatCurrency(periodMetrics.totalEarnings)}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">{periodMetrics.salesCount} venda(s)</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5 hover:border-white/20 transition-colors">
                  <div className="w-10 h-10 bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                    <AlertCircle className="w-5 h-5 text-yellow-400" />
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">A liberar</p>
                  <p className="font-sans font-black text-3xl text-yellow-400">{formatCurrency(periodMetrics.pendingEarnings)}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">Janela de 7 dias</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5 hover:border-white/20 transition-colors">
                  <div className="w-10 h-10 bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                    <Upload className="w-5 h-5 text-brutal-accent" />
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Saques em aberto</p>
                  <p className="font-sans font-black text-3xl text-brutal-accent">{formatCurrency(pendingWithdrawalTotal)}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">Pendentes/aprovados</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5 hover:border-white/20 transition-colors">
                  <div className="w-10 h-10 bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Ja pago</p>
                  <p className="font-sans font-black text-3xl text-green-400">{formatCurrency(paidWithdrawalTotal)}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">Histórico recebido</p>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-5">
                <div className="bg-[#0d131c] border border-white/10">
                  <div className="p-5 border-b border-white/10 flex items-center justify-between">
                    <div>
                      <h3 className="font-sans font-black text-base uppercase text-white">Histórico financeiro</h3>
                      <p className="font-mono text-[10px] uppercase text-gray-500">Vendas confirmadas e solicitações de saque</p>
                    </div>
                    <DollarSign className="w-5 h-5 text-gray-500" />
                  </div>
                  <div className="p-5 space-y-6">
                    {periodWithdrawals.length > 0 && (
                      <div className="space-y-3">
                        <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">Solicitacoes de saque</p>
                        {periodWithdrawals.slice(0, 4).map((withdrawal) => (
                          <div key={withdrawal.id} className="flex justify-between items-center gap-4 p-4 bg-[#080d14] border border-white/10 hover:border-white/20 transition-colors">
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
                          As movimentações aparecem quando pagamentos forem confirmados.
                        </p>
                      </div>
                    ) : periodSales.map((sale) => (
                      <div key={sale.id} className="grid grid-cols-[40px_1fr_auto] items-center gap-4 p-4 bg-[#080d14] border border-white/10 hover:border-green-400/25 transition-colors">
                        <div className="w-10 h-10 bg-green-400/10 border border-green-400/20 flex items-center justify-center">
                          <CheckCircle2 className="w-5 h-5 text-green-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-sans font-black text-sm uppercase text-white truncate">Venda confirmada</p>
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

                <div className="bg-[#0d131c] border border-white/10 p-6 flex flex-col justify-center">
                  <div className="w-14 h-14 bg-brutal-accent/15 border border-brutal-accent/20 flex items-center justify-center mb-5">
                    <TrendingUp className="w-7 h-7 text-brutal-accent" />
                  </div>
                  <div className="flex items-end justify-between gap-4 mb-4">
                    <div>
                      <h3 className="font-sans font-black text-xl uppercase text-white">Meta Mensal</h3>
                      <p className="font-mono text-[10px] uppercase text-gray-500 mt-1">Acompanhamento do mes atual</p>
                    </div>
                    <p className="font-sans font-black text-3xl text-brutal-accent">{monthlyGoalPercent}%</p>
                  </div>
                  <div className="w-full h-4 bg-[#080d14] border border-white/10 mb-4 overflow-hidden">
                    <div
                      className="h-full bg-brutal-accent"
                      style={{ width: `${monthlyGoalPercent}%` }}
                    />
                  </div>
                  <p className="font-mono text-sm text-gray-400 leading-relaxed">
                    Você atingiu <span className="font-bold text-white">{monthlyGoalPercent}%</span> da sua meta de <span className="font-bold text-white">{formatCurrency(periodMetrics.monthlyGoal)}</span>
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

      {/* Event Modal */}
      <AnimatePresence>
        {showEventModal && (
          <div className="fixed inset-0 z-100 flex items-center justify-center p-4 md:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={resetEventForm}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />

            <motion.div
              initial={{ scale: 0.94, y: 18 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 18 }}
              className="relative w-full max-w-4xl max-h-[92vh] overflow-y-auto bg-[#0d131c] border border-white/15 shadow-[0_30px_90px_rgba(0,0,0,0.6)] text-white"
            >
              <div className="h-1.5 bg-brutal-accent" />
              <button
                type="button"
                onClick={resetEventForm}
                className="absolute right-4 top-4 z-10 p-2 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="p-6 md:p-8 border-b border-white/10">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-brutal-accent/10 border border-brutal-accent/30 text-brutal-accent font-mono text-[10px] uppercase tracking-widest mb-4">
                  <CalendarDays className="w-3.5 h-3.5" />
                  {eventForm.id ? 'Editar evento' : 'Novo evento'}
                </div>
                <h3 className="font-sans font-black text-3xl md:text-4xl uppercase tracking-normal">
                  {eventForm.id ? 'Atualizar Evento' : 'Criar Evento'}
                </h3>
                <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest mt-2">
                  Eventos organizam uploads, capas, preços e publicação.
                </p>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  handleSaveEvent();
                }}
                className="p-6 md:p-8 space-y-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="md:col-span-2">
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Nome do evento</label>
                    <input
                      required
                      type="text"
                      value={eventForm.name}
                      onChange={(event) => setEventForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Ex: Maratona Manaus 2026"
                      className="w-full h-14 px-4 bg-[#05080d] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm uppercase outline-none focus:border-brutal-accent transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Data</label>
                    <input
                      required
                      type="date"
                      value={eventForm.date}
                      onChange={(event) => setEventForm((current) => ({ ...current, date: event.target.value }))}
                      className="w-full h-14 px-4 bg-[#05080d] border border-white/15 text-white font-mono text-sm outline-none focus:border-brutal-accent transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Status operacional</label>
                    <select
                      value={eventForm.status}
                      onChange={(event) => setEventForm((current) => ({ ...current, status: event.target.value as Event['status'] }))}
                      className="w-full h-14 px-4 bg-[#05080d] border border-white/15 text-white font-mono text-sm uppercase outline-none focus:border-brutal-accent transition-colors"
                    >
                      <option value="scheduled">Agendado</option>
                      <option value="active">Ativo</option>
                      <option value="closed">Fechado</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Local</label>
                    <input
                      type="text"
                      value={eventForm.location}
                      onChange={(event) => setEventForm((current) => ({ ...current, location: event.target.value }))}
                      placeholder="Cidade / local"
                      className="w-full h-14 px-4 bg-[#05080d] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm uppercase outline-none focus:border-brutal-accent transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Checkpoint padrao</label>
                    <input
                      type="text"
                      value={eventForm.checkpoint}
                      onChange={(event) => setEventForm((current) => ({ ...current, checkpoint: event.target.value }))}
                      placeholder="Chegada, KM 10..."
                      className="w-full h-14 px-4 bg-[#05080d] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm uppercase outline-none focus:border-brutal-accent transition-colors"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Descrição</label>
                    <textarea
                      value={eventForm.description}
                      onChange={(event) => setEventForm((current) => ({ ...current, description: event.target.value }))}
                      rows={3}
                      placeholder="Resumo para equipe e publicação"
                      className="w-full px-4 py-3 bg-[#05080d] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm uppercase outline-none focus:border-brutal-accent transition-colors resize-none"
                    />
                  </div>
                </div>

                <div className="bg-[#080d14] border border-white/10 p-4">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Capa do evento</label>
                      <p className="font-mono text-[10px] uppercase text-gray-600">
                        Escolha uma foto já enviada ou envie uma capa personalizada.
                        Use imagens horizontais em 16:9 para melhor resultado. Sugestão: 1920x1080.
                      </p>
                    </div>
                    {(eventForm.coverImage || pendingEventCover) && (
                      <button
                        type="button"
                        onClick={handleRemoveEventCover}
                        className="shrink-0 h-9 px-3 border border-white/15 text-gray-300 font-mono text-[10px] uppercase hover:text-white hover:border-brutal-accent"
                      >
                        Remover capa
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,360px)_1fr] gap-4">
                    <div className="space-y-4">
                      <div>
                        <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-gray-500">Capa atual</p>
                        <div className={`aspect-video bg-[#05080d] border overflow-hidden ${eventForm.coverImage || pendingEventCover ? 'border-brutal-accent' : 'border-white/10'}`}>
                          {pendingEventCover?.previewUrl || eventForm.coverImage ? (
                            <img
                              src={pendingEventCover?.previewUrl || eventForm.coverImage}
                              alt="Capa atual do evento"
                              style={{ objectPosition: eventForm.cover_position || 'center center' }}
                              className="w-full h-full object-contain"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <div className="h-full w-full flex flex-col items-center justify-center text-center p-5">
                              <ImageIcon className="w-9 h-9 text-gray-600 mb-3" />
                              <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">
                                Nenhuma capa selecionada.
                              </p>
                            </div>
                          )}
                        </div>
                        {eventForm.coverMediaId && !pendingEventCover && (
                          <p className="mt-2 font-mono text-[9px] uppercase tracking-widest text-brutal-accent">
                            Capa vinculada a foto do evento
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Enquadramento da capa</label>
                        <select
                          value={eventForm.cover_position}
                          onChange={(event) => setEventForm((current) => ({ ...current, cover_position: event.target.value }))}
                          className="w-full h-12 px-3 bg-[#05080d] border border-white/15 text-white font-mono text-xs uppercase outline-none focus:border-brutal-accent transition-colors"
                        >
                          {EVENT_COVER_POSITION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>

                      <ProfileImageUploader
                        kind="cover"
                        label="Enviar nova capa"
                        description="JPG, PNG ou WEBP até 15 MB. Capas acima de 5 MB serão otimizadas em WebP até 1920px."
                        actionLabel="Enviar Nova Capa"
                        previewUrl={pendingEventCover?.previewUrl || ''}
                        error={eventCoverError}
                        disabled={isSavingEvent}
                        onSelect={handleSelectEventCoverFile}
                        onRemove={() => {
                          setPendingEventCover((current) => {
                            if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
                            return null;
                          });
                          setEventCoverError('');
                        }}
                      />
                    </div>

                    <div>
                      <div className="mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div>
                          <p className="font-mono text-[10px] uppercase font-bold text-gray-500">Escolher foto do evento</p>
                          <p className="font-mono text-[10px] uppercase text-gray-600">
                            {eventCoverCandidates.length === 1 ? '1 foto encontrada' : `${eventCoverCandidates.length} fotos encontradas`} para "{eventForm.name || 'evento sem nome'}".
                          </p>
                        </div>
                      </div>

                      {eventCoverCandidates.length > 0 ? (
                        <div className="max-h-[28rem] overflow-y-auto pr-1">
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                            {eventCoverCandidates.map((product) => {
                              const coverUrl = product.thumbnailUrl || product.url;
                              const isSelected = !pendingEventCover && (eventForm.coverMediaId === product.id || eventForm.coverImage === coverUrl);
                              return (
                                <button
                                  key={product.id}
                                  type="button"
                                  onClick={() => handleSelectEventCoverProduct(product)}
                                  className={`group relative text-left bg-[#05080d] border overflow-hidden transition-colors ${isSelected ? 'border-brutal-accent ring-1 ring-brutal-accent' : 'border-white/10 hover:border-brutal-accent/70'
                                    }`}
                                >
                                  <div className="aspect-video bg-[#05080d] overflow-hidden">
                                    <img
                                      src={coverUrl}
                                      alt={product.name}
                                      className="w-full h-full object-contain"
                                      loading="lazy"
                                      decoding="async"
                                    />
                                  </div>
                                  {isSelected && (
                                    <div className="absolute top-2 right-2 h-7 w-7 bg-brutal-accent text-white border border-white flex items-center justify-center">
                                      <CheckCircle2 className="w-4 h-4" />
                                    </div>
                                  )}
                                  <div className="p-2">
                                    <p className="font-mono text-[9px] uppercase text-gray-400 truncate">{product.name}</p>
                                    <p className="font-mono text-[8px] uppercase text-gray-600">{isSelected ? 'Capa selecionada' : 'Usar como capa'}</p>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="border border-dashed border-white/10 p-5 text-center">
                          <ImageIcon className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                          <p className="font-mono text-[10px] uppercase text-gray-500">
                            Nenhuma foto enviada para este evento. Use "Enviar Nova Capa" para definir uma capa personalizada.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <label className="h-14 px-4 bg-[#05080d] border border-white/15 flex items-center justify-between gap-3 cursor-pointer">
                  <span className="font-mono text-[10px] uppercase text-gray-300">Publicado na operação</span>
                  <input
                    type="checkbox"
                    checked={eventForm.isPublished}
                    onChange={(event) => setEventForm((current) => ({ ...current, isPublished: event.target.checked }))}
                    className="h-5 w-5 accent-brutal-accent"
                  />
                </label>

                {eventError && (
                  <div className="border border-red-400/30 bg-red-500/10 p-3 font-mono text-[10px] uppercase text-red-200">
                    {eventError}
                  </div>
                )}

                <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
                  <button
                    type="button"
                    onClick={resetEventForm}
                    className="h-14 flex-1 border border-white/15 text-gray-300 font-mono text-xs uppercase tracking-widest hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingEvent}
                    className="h-14 flex-1 bg-brutal-accent text-white border border-brutal-accent font-sans font-black text-sm uppercase tracking-widest hover:bg-white hover:text-brutal-accent transition-colors cursor-pointer disabled:bg-gray-700 disabled:border-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    {isSavingEvent ? 'Salvando...' : eventForm.id ? 'Salvar evento' : 'Criar evento'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                  A solicitação fica pendente para processamento manual pela equipe Funpace.
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
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Preço</label>
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
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Evento / Coleção</label>
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

      {/* Duplicate Upload Modal */}
      <AnimatePresence>
        {duplicateConflict && (
          <div className="fixed inset-0 z-120 flex items-center justify-center p-4 md:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />

            <motion.div
              initial={{ scale: 0.94, y: 18 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 18 }}
              className="relative w-full max-w-5xl max-h-[92vh] overflow-y-auto bg-[#0d131c] border border-white/15 shadow-[0_30px_90px_rgba(0,0,0,0.7)] text-white"
              role="dialog"
              aria-modal="true"
              aria-labelledby="duplicate-upload-title"
            >
              <div className="p-5 md:p-7 border-b border-white/10">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div>
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 font-mono text-[10px] uppercase tracking-widest mb-3">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Nome duplicado
                    </div>
                    <h3 id="duplicate-upload-title" className="font-sans font-black text-2xl md:text-4xl uppercase tracking-normal">
                      Arquivo já existe neste evento
                    </h3>
                    <p className="mt-2 font-mono text-[10px] md:text-xs uppercase tracking-widest text-gray-500">
                      Evento: {duplicateConflict.eventName}
                      {duplicateConflict.remainingCount > 0 ? ` - ${duplicateConflict.remainingCount === 1 ? '1 arquivo restante' : `${duplicateConflict.remainingCount} arquivos restantes`} no lote` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => resolveDuplicateConflict('cancel')}
                    className="self-start p-2 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                    aria-label="Cancelar upload"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-5 md:p-7 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-white/10 bg-[#080d14] overflow-hidden">
                    <div className="aspect-video bg-black flex items-center justify-center">
                      {duplicateConflict.existingProduct.type === 'VIDEO' && !duplicateConflict.existingProduct.thumbnailUrl ? (
                        <video
                          src={duplicateConflict.existingProduct.url}
                          className="w-full h-full object-cover"
                          muted
                          preload="metadata"
                        />
                      ) : (
                        <img
                          src={duplicateConflict.existingProduct.thumbnailUrl || duplicateConflict.existingProduct.url}
                          alt={duplicateConflict.existingProduct.name}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="p-4">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-1">Foto existente</p>
                      <p className="font-mono text-sm break-all text-white">
                        {duplicateConflict.existingProduct.originalFileName || duplicateConflict.existingProduct.name}
                      </p>
                    </div>
                  </div>

                  <div className="border border-white/10 bg-[#080d14] overflow-hidden">
                    <div className="aspect-video bg-black flex items-center justify-center">
                      {duplicateConflict.item.file.type.startsWith('video') ? (
                        <video
                          src={duplicateConflict.item.previewUrl}
                          className="w-full h-full object-cover"
                          muted
                          preload="metadata"
                        />
                      ) : (
                        <img
                          src={duplicateConflict.item.previewUrl}
                          alt={duplicateConflict.item.file.name}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="p-4">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-1">Arquivo enviado</p>
                      <p className="font-mono text-sm break-all text-white">{duplicateConflict.item.file.name}</p>
                    </div>
                  </div>
                </div>

                <label className="flex items-start gap-3 border border-white/10 bg-white/[0.03] p-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyDuplicateChoiceToAll}
                    onChange={(event) => setApplyDuplicateChoiceToAll(event.target.checked)}
                    className="mt-1 h-4 w-4 accent-brutal-accent"
                  />
                  <span>
                    <span className="block font-sans font-black text-sm uppercase">Aplicar para todos</span>
                    <span className="block mt-1 font-mono text-[10px] uppercase tracking-widest text-gray-500">
                      Usa a mesma escolha para os proximos arquivos duplicados deste lote.
                    </span>
                  </span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                  <button
                    onClick={() => resolveDuplicateConflict('cancel')}
                    className="h-13 px-4 border border-white/15 bg-transparent text-white font-display text-sm uppercase tracking-widest hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => resolveDuplicateConflict('copy')}
                    className="h-13 px-4 border border-white/15 bg-white text-brutal-black font-display text-sm uppercase tracking-widest hover:bg-gray-200 transition-colors cursor-pointer"
                  >
                    Enviar como copia
                  </button>
                  <button
                    onClick={() => resolveDuplicateConflict('replace')}
                    className="h-13 px-4 bg-brutal-accent text-white border border-brutal-accent font-display text-sm uppercase tracking-widest hover:brightness-110 transition-colors cursor-pointer"
                  >
                    Substituir
                  </button>
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
                    Fotos são comprimidas automaticamente. Vídeos precisam ter até {formatFileSize(clientUploadMaxBytes)}.
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
                  onClick={handleResumableFilePicker}
                  className="aspect-video border border-dashed border-white/20 bg-[#080d14] flex flex-col items-center justify-center group hover:border-brutal-accent hover:bg-brutal-accent/5 transition-colors cursor-pointer mb-6"
                >
                  <div className="bg-brutal-accent text-white p-4 border border-brutal-accent group-hover:scale-110 transition-transform mb-4">
                    <Upload className="w-6 h-6" />
                  </div>
                  <p className="font-sans font-black text-lg uppercase mb-1">Escolher Arquivos</p>
                  <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest">
                    {supportsFileSystemUploadHandles() ? 'Modo retomavel ativo' : `Limite por arquivo: ${formatFileSize(clientUploadMaxBytes)}`}
                  </p>
                </div>

                {selectedFiles.length > 0 && (
                  <div className="space-y-3">
                    {resumeNotice && (
                      <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 text-yellow-200">
                        <p className="font-mono text-[10px] uppercase tracking-widest">{resumeNotice}</p>
                      </div>
                    )}
                    {uploadCompletionNotice && (
                      <div className="bg-[#0d131c] border border-brutal-accent/40 p-3 text-gray-200">
                        <p className="font-mono text-[10px] uppercase tracking-widest">{uploadCompletionNotice}</p>
                      </div>
                    )}
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
                        Você ainda pode ajustar o valor individual de cada captura abaixo.
                      </p>
                    </div>

                    <h4 className="font-mono text-[10px] uppercase font-bold text-gray-500">Arquivos Selecionados ({selectedFiles.length})</h4>
                    <div className="bg-[#080d14] border border-white/10 p-3">
                      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Publicadas</p>
                          <p className="font-sans text-xl font-black text-green-300">{completedUploadCount}</p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Pendentes</p>
                          <p className="font-sans text-xl font-black text-white">{pendingUploadCount}</p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Falhas</p>
                          <p className="font-sans text-xl font-black text-red-300">{failedUploadCount}</p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Em andamento</p>
                          <p className="font-sans text-xl font-black text-cyan-200">{inProgressUploadCount}</p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Storage ok</p>
                          <p className="font-sans text-xl font-black text-cyan-200">{uploadedOnlyCount}</p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Banco ok</p>
                          <p className="font-sans text-xl font-black text-green-200">{dbSavedUploadCount}</p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Duplicadas</p>
                          <p className="font-sans text-xl font-black text-blue-300">{skippedUploadCount}</p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Conexao</p>
                          <p className={`font-sans text-sm font-black uppercase ${isBrowserOnline ? 'text-green-300' : 'text-red-300'}`}>
                            {isBrowserOnline ? 'Online' : 'Offline'}
                          </p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Proc. fila</p>
                          <p className="font-sans text-xl font-black text-yellow-200">{mediaProcessingPendingCount}</p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Proc. ativo</p>
                          <p className="font-sans text-xl font-black text-cyan-200">{mediaProcessingActiveCount}</p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Proc. ok</p>
                          <p className="font-sans text-xl font-black text-green-300">{mediaProcessingDoneCount}</p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Proc. erro</p>
                          <p className="font-sans text-xl font-black text-red-300">{mediaProcessingFailedCount}</p>
                        </div>
                      </div>
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
                          : `${selectedFiles.length === 1 ? '1 arquivo carregado' : `${selectedFiles.length} arquivos carregados`}. ${hiddenSelectedFileCount > 0 ? `${hiddenSelectedFileCount} ocultos para manter o painel leve.` : 'Você já pode publicar.'}`}
                      </p>
                    </div>
                    <div className="max-h-96 overflow-y-auto space-y-3 pr-2">
                      {visibleSelectedFiles.map((item, idx) => (
                        <div
                          key={idx}
                          onClick={() => setPreviewIndex(idx)}
                          className={`w-full bg-[#080d14] p-3 border text-left transition-colors cursor-pointer ${previewIndex === idx ? 'border-brutal-accent ring-1 ring-brutal-accent' : 'border-white/10 hover:border-white/25'
                            }`}
                        >
                          <div className="grid grid-cols-[64px_1fr] gap-3">
                            <div className="w-16 h-16 bg-white/5 border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                              {item.file.type.startsWith('image') && item.previewUrl ? (
                                <img src={item.previewUrl} alt={item.name} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-black text-white">
                                  {item.file.type.startsWith('video') ? <VideoIcon className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0 space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <p className="font-mono text-[9px] uppercase truncate text-gray-500">{item.name}</p>
                                <span className={`shrink-0 font-mono text-[8px] uppercase border px-2 py-1 ${getUploadStatusClass(item.status)}`}>
                                  {getUploadStatusLabel(item.status)}
                                </span>
                              </div>
                              {item.productId && (
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`font-mono text-[8px] uppercase border px-2 py-1 ${getProcessingStatusClass(uploadProcessingJobsByProduct[item.productId])}`}>
                                    {getProcessingStatusLabel(uploadProcessingJobsByProduct[item.productId])}
                                  </span>
                                  {uploadProcessingJobsByProduct[item.productId]?.attempts > 0 && (
                                    <span className="font-mono text-[8px] uppercase text-gray-500">
                                      {uploadProcessingJobsByProduct[item.productId].attempts} tentativa(s)
                                    </span>
                                  )}
                                </div>
                              )}
                              {item.productId && uploadProcessingJobsByProduct[item.productId]?.error && (
                                <p className="font-mono text-[9px] uppercase text-red-300 line-clamp-2">
                                  {uploadProcessingJobsByProduct[item.productId].error}
                                </p>
                              )}
                              {item.error && (
                                <p className="font-mono text-[9px] uppercase text-red-300 line-clamp-2">{item.error}</p>
                              )}
                              <input
                                type="text"
                                value={item.description}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => updateSelectedFile(idx, { description: event.target.value })}
                                placeholder="Descrição desta foto"
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
                        currentPreview.file.type.startsWith('image') && currentPreview.previewUrl ? (
                          <img
                            src={currentPreview.previewUrl}
                            alt={currentPreview.name}
                            className="w-full h-full object-contain bg-brutal-black"
                          />
                        ) : currentPreview.file.type.startsWith('video') && currentPreview.previewUrl ? (
                          <video
                            src={currentPreview.previewUrl}
                            className="w-full h-full bg-brutal-black"
                            controls
                            preload="metadata"
                          />
                        ) : (
                          <div className="text-center px-8">
                            {currentPreview.file.type.startsWith('video') ? <VideoIcon className="w-10 h-10 text-white/30 mx-auto mb-4" /> : <ImageIcon className="w-10 h-10 text-white/30 mx-auto mb-4" />}
                            <p className="font-mono text-[10px] uppercase tracking-widest text-white/50">Preparando preview</p>
                          </div>
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
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Nome do Evento / Coleção</label>
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
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Checkpoint / Localização</label>
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
                        <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-gray-400">
                          {!isBrowserOnline && <WifiOff className="h-3.5 w-3.5 text-red-300" />}
                          {!isBrowserOnline ? 'Offline - upload pausado' : isUploadPaused ? 'Upload pausado' : isPublishing ? 'Publicando lote' : 'Ultimo envio'}
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
                      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Enviado</p>
                          <p className="font-sans text-sm font-black text-white">{formatFileSize(uploadRuntimeMetrics.uploadedBytes)}</p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Velocidade</p>
                          <p className="font-sans text-sm font-black text-cyan-200">{formatUploadSpeed(uploadAverageSpeed)}</p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Estimativa</p>
                          <p className="font-sans text-sm font-black text-green-200">{uploadEtaMs > 0 ? formatDurationMs(uploadEtaMs) : '-'}</p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Concorrencia</p>
                          <p className="font-sans text-sm font-black text-white">{uploadRuntimeMetrics.activeUploads}/{uploadRuntimeMetrics.concurrencyLimit}</p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Tempo</p>
                          <p className="font-sans text-sm font-black text-white">{formatDurationMs(uploadElapsedMs)}</p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Retries</p>
                          <p className="font-sans text-sm font-black text-yellow-200">{uploadRuntimeMetrics.retries}</p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Falhas lote</p>
                          <p className="font-sans text-sm font-black text-red-300">{uploadRuntimeMetrics.failedFiles}</p>
                        </div>
                        <div className="border border-white/10 bg-[#05080d] p-2">
                          <p className="font-mono text-[9px] uppercase text-gray-500">Total bruto</p>
                          <p className="font-sans text-sm font-black text-gray-200">{formatFileSize(uploadRuntimeMetrics.totalBytes)}</p>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <button
                          type="button"
                          disabled={!isPublishing || !isBrowserOnline}
                          onClick={() => setIsUploadPaused((current) => !current)}
                          className="inline-flex h-10 items-center justify-center gap-2 border border-white/15 bg-white/5 px-3 font-mono text-[10px] uppercase font-bold text-gray-200 transition-colors hover:border-brutal-accent disabled:opacity-50"
                        >
                          {isUploadPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                          {isUploadPaused ? 'Continuar' : 'Pausar'}
                        </button>
                        <button
                          type="button"
                          disabled={isPublishing || pendingUploadCount === 0 || !isBrowserOnline}
                          onClick={handleUpload}
                          className="inline-flex h-10 items-center justify-center gap-2 border border-white/15 bg-white/5 px-3 font-mono text-[10px] uppercase font-bold text-gray-200 transition-colors hover:border-brutal-accent disabled:opacity-50"
                        >
                          <RotateCcw className="h-4 w-4" />
                          {failedUploadCount > 0 ? 'Tentar falhas' : 'Continuar upload'}
                        </button>
                        <button
                          type="button"
                          disabled={failedUploadCount === 0}
                          onClick={exportUploadErrorReport}
                          className="inline-flex h-10 items-center justify-center gap-2 border border-white/15 bg-white/5 px-3 font-mono text-[10px] uppercase font-bold text-gray-200 transition-colors hover:border-brutal-accent disabled:opacity-50"
                        >
                          <Copy className="h-4 w-4" />
                          Exportar erros
                        </button>
                      </div>
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
                    ) : failedUploadCount > 0 && pendingUploadCount === failedUploadCount ? (
                      `Reenviar ${failedUploadCount} erro${failedUploadCount === 1 ? '' : 's'}`
                    ) : (
                      `Publicar ${pendingUploadCount || ''} Produto${pendingUploadCount === 1 ? '' : 's'}`
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
