import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck,
  Users,
  Camera,
  DollarSign,
  TrendingUp,
  LogOut,
  Settings,
  Search,
  MoreVertical,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowUpRight,
  Bell,
  CalendarDays,
  ChevronDown,
  Download,
  Filter,
  BarChart3,
  Plus,
  X,
  Mail,
  User as UserIcon,
  ShoppingCart,
  CreditCard,
  TicketPercent,
  FileText,
  Activity,
  EyeOff,
  Eye,
  ReceiptText,
  Pencil,
  RefreshCw,
  AlertTriangle,
  PauseCircle,
  FolderOpen,
  Trash2,
  Link as LinkIcon,
  Loader2,
} from 'lucide-react';
import { AdminActivityLog, AdminMetrics, Coupon, Customer, Event, Order, PaymentEventLog, PaymentRecord, PaymentRecoveryIssue, Photographer, PhotographerReferral, PlatformSettings, Product, ReferralSettings, WithdrawalRequest } from '../types';
import { adminService, eventService, photographerService, platformSettingsService, productService, referralService, withdrawalService, orderService } from '../lib/services';
import { formatCpf, isValidCpf, onlyCpfDigits } from '../lib/cpf';
import { getCurrentAccessToken } from '../lib/supabase';
import { FUNPACE_CONTACT_EMAIL } from '../lib/contact';

interface AdminDashboardProps {
  photographers: Photographer[];
  photos: Product[];
  videos: Product[];
  orders: Order[];
  withdrawals: WithdrawalRequest[];
  customers: Customer[];
  payments: PaymentRecord[];
  paymentEvents: PaymentEventLog[];
  coupons: Coupon[];
  adminLogs: AdminActivityLog[];
  metrics: AdminMetrics;
  onLogout: () => void;
  onRefresh: () => void;
}

type StorageStats = {
  bucket: string;
  usedBytes: number;
  quotaBytes: number;
  usagePercent: number;
  totalFiles: number;
  byType: Record<string, { count: number; bytes: number }>;
  updatedAt: string;
};

type AdminTab = 'overview' | 'users' | 'photographers' | 'events' | 'media' | 'orders' | 'payments' | 'sales' | 'referrals' | 'coupons' | 'logs' | 'settings';
type PhotographerStatusFilter = 'all' | 'active' | 'pending' | 'disabled';
type PhotographerAdminAction = 'disable' | 'reactivate' | 'delete';
const EVENT_COVER_POSITION_OPTIONS = [
  { label: 'Centro', value: 'center center' },
  { label: 'Topo', value: 'center top' },
  { label: 'Baixo', value: 'center bottom' },
  { label: 'Esquerda', value: 'left center' },
  { label: 'Direita', value: 'right center' },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function getOrderItemsRevenue(order: Order) {
  const items = order.items ?? [];
  if (items.length === 0) return Number(order.total || 0);

  return items.reduce((sum, item) => sum + Number(item.price || 0), 0);
}

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes || 0);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: value >= 10 || unitIndex === 0 ? 0 : 1,
  }).format(value)} ${units[unitIndex]}`;
}

type AdminPeriodKey = 'today' | 'week' | 'month' | 'year' | 'custom';

const ADMIN_PERIOD_OPTIONS: Array<{ key: AdminPeriodKey; label: string }> = [
  { key: 'today', label: 'Hoje' },
  { key: 'week', label: 'Esta semana' },
  { key: 'month', label: 'Este mes' },
  { key: 'year', label: 'Este ano' },
  { key: 'custom', label: 'Personalizado' },
];

const orderStatusLabels: Record<Order['status'], string> = {
  paid: 'Pago',
  pending: 'Pendente',
  failed: 'Falhou',
  cancelled: 'Cancelado',
  canceled: 'Cancelado',
  refused: 'Recusado',
  refunded: 'Reembolsado',
};

const orderStatusClasses: Record<Order['status'], string> = {
  paid: 'border-green-500/30 bg-green-500/10 text-green-300',
  pending: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
  failed: 'border-red-500/30 bg-red-500/10 text-red-300',
  cancelled: 'border-gray-500/30 bg-gray-500/10 text-gray-300',
  canceled: 'border-gray-500/30 bg-gray-500/10 text-gray-300',
  refused: 'border-red-500/30 bg-red-500/10 text-red-300',
  refunded: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
};

const adminListPageSizes = {
  users: 120,
  photographers: 120,
  media: 80,
  orders: 160,
  paymentIssues: 80,
  payments: 120,
  paymentEvents: 120,
  logs: 250,
} as const;

type AdminListKey = keyof typeof adminListPageSizes;

const initialVisibleAdminRows: Record<AdminListKey, number> = {
  users: adminListPageSizes.users,
  photographers: adminListPageSizes.photographers,
  media: adminListPageSizes.media,
  orders: adminListPageSizes.orders,
  paymentIssues: adminListPageSizes.paymentIssues,
  payments: adminListPageSizes.payments,
  paymentEvents: adminListPageSizes.paymentEvents,
  logs: adminListPageSizes.logs,
};

function AdminLoadMoreButton({ visible, total, onClick }: { visible: number; total: number; onClick: () => void }) {
  if (visible >= total) return null;

  return (
    <div className="border-t border-white/10 p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="font-mono text-[10px] uppercase text-gray-500">
        Exibindo {Math.min(visible, total)} de {total}
      </p>
      <button
        type="button"
        onClick={onClick}
        className="h-10 px-4 bg-[#080d14] border border-white/15 text-white font-mono text-[10px] uppercase hover:border-brutal-accent hover:text-brutal-accent transition-colors"
      >
        Carregar mais
      </button>
    </div>
  );
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

function getAdminPeriodRange(period: AdminPeriodKey, customStart: string, customEnd: string) {
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

function getPreviousPeriodRange(start: Date, end: Date) {
  const durationMs = end.getTime() - start.getTime() + 1;
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - durationMs + 1);
  return { start: previousStart, end: previousEnd };
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

function formatExportDate(date: Date) {
  return formatDateInput(date);
}

function downloadTextFile(fileName: string, content: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function htmlEscape(value: unknown) {
  return value == null
    ? ''
    : String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
}

function formatReportNumber(value: number) {
  return new Intl.NumberFormat('pt-BR').format(value);
}

function formatReportPercent(value: number) {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatTrendPercent(current: number, previous: number) {
  if (previous === 0) {
    if (current === 0) return '0,0%';
    return '+100,0%';
  }

  const value = ((current - previous) / Math.abs(previous)) * 100;
  const formatted = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
  return `${value > 0 ? '+' : ''}${formatted}%`;
}

function normalizeEventKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeInstagramInput(value: string) {
  const handle = value.trim().replace(/^@+/, '').toLowerCase();
  return handle ? `@${handle}` : '';
}

function buildSparklineBuckets<T>(
  items: T[],
  start: Date,
  end: Date,
  getDate: (item: T) => string | undefined,
  getValue: (item: T) => number,
) {
  const bucketCount = 12;
  const totals = Array.from({ length: bucketCount }, () => 0);
  const startTime = start.getTime();
  const duration = Math.max(1, end.getTime() - startTime + 1);

  for (const item of items) {
    const rawDate = getDate(item);
    const time = rawDate ? Date.parse(rawDate) : NaN;
    if (!Number.isFinite(time) || time < startTime || time > end.getTime()) continue;

    const index = Math.min(bucketCount - 1, Math.floor(((time - startTime) / duration) * bucketCount));
    totals[index] += getValue(item);
  }

  const max = Math.max(...totals, 0);
  return totals.map((value) => (max <= 0 ? 8 : Math.max(8, Math.round((value / max) * 42))));
}

function buildReportBarChart(title: string, rows: Array<{ label: string; value: number; meta?: string }>) {
  const width = 760;
  const rowHeight = 48;
  const top = 58;
  const height = Math.max(180, top + Math.max(rows.length, 1) * rowHeight + 24);
  const maxValue = Math.max(...rows.map((row) => row.value), 1);

  const bars = rows.length === 0
    ? `<text x="24" y="105" fill="#64748b" font-size="14">Sem dados no periodo selecionado.</text>`
    : rows.map((row, index) => {
      const y = top + index * rowHeight;
      const barWidth = Math.max(4, Math.round((row.value / maxValue) * 420));
      return `
          <text x="24" y="${y + 17}" fill="#0f172a" font-size="13" font-weight="700">${htmlEscape(row.label).slice(0, 42)}</text>
          <rect x="260" y="${y}" width="430" height="20" rx="4" fill="#e2e8f0"></rect>
          <rect x="260" y="${y}" width="${barWidth}" height="20" rx="4" fill="#ff4e00"></rect>
          <text x="704" y="${y + 15}" fill="#0f172a" font-size="12" text-anchor="end">${htmlEscape(formatCurrency(row.value))}</text>
          <text x="260" y="${y + 37}" fill="#64748b" font-size="11">${htmlEscape(row.meta ?? '')}</text>
        `;
    }).join('');

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" rx="16" fill="#f8fafc"></rect>
      <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="16" fill="none" stroke="#e2e8f0"></rect>
      <text x="24" y="34" fill="#0f172a" font-size="18" font-weight="800">${htmlEscape(title)}</text>
      ${bars}
    </svg>
  `;
}

async function createThumbnailFromMedia(product: Product): Promise<File> {
  const sourceUrl = product.thumbnailUrl || product.url;
  if (!sourceUrl) throw new Error('Midia sem URL para gerar preview.');
  const maxPreviewSide = 960;

  const response = await fetch(sourceUrl, { mode: 'cors' }).catch((error) => {
    throw new Error(`Não foi possível acessar a mídia. Verifique CORS/URL pública. ${error?.message || ''}`.trim());
  });
  if (!response.ok) throw new Error('Não foi possível baixar a mídia para gerar preview.');
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    if (product.type === 'IMG') {
      return await new Promise<File>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const maxSide = maxPreviewSide;
          const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) {
            reject(new Error('Canvas indisponivel.'));
            return;
          }
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';
          context.drawImage(image, 0, 0, width, height);
          canvas.toBlob((thumbBlob) => {
            if (!thumbBlob) {
              reject(new Error('Não foi possível gerar preview.'));
              return;
            }
            resolve(new File([thumbBlob], `${product.id}-preview.jpg`, { type: 'image/jpeg' }));
          }, 'image/jpeg', 0.84);
        };
        image.onerror = () => reject(new Error('Imagem invalida.'));
        image.src = objectUrl;
      });
    }

    return await new Promise<File>((resolve, reject) => {
      const video = document.createElement('video');
      let settled = false;
      let seekRequested = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Tempo esgotado ao gerar preview do video.'));
      }, 15000);
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        callback();
      };
      const captureFrame = () => {
        const canvas = document.createElement('canvas');
        const videoWidth = video.videoWidth || 1280;
        const videoHeight = video.videoHeight || 720;
        const scale = Math.min(1, maxPreviewSide / Math.max(videoWidth, videoHeight));
        canvas.width = Math.max(1, Math.round(videoWidth * scale));
        canvas.height = Math.max(1, Math.round(videoHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          finish(() => reject(new Error('Canvas indisponivel.')));
          return;
        }
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((thumbBlob) => {
          if (!thumbBlob) {
            finish(() => reject(new Error('Não foi possível gerar preview.')));
            return;
          }
          finish(() => resolve(new File([thumbBlob], `${product.id}-preview.jpg`, { type: 'image/jpeg' })));
        }, 'image/jpeg', 0.82);
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
          // Fallback to the first decodable frame.
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
      video.onerror = () => finish(() => reject(new Error('Vídeo inválido.')));
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
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function AdminDashboard({ photographers, photos, videos, orders, withdrawals, customers, payments, paymentEvents, coupons, adminLogs, metrics, onLogout, onRefresh }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPhotographer, setNewPhotographer] = useState({ name: '', email: '', instagram: '', bio: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openMenuPhotographerId, setOpenMenuPhotographerId] = useState<string | null>(null);
  const [editingPhotographer, setEditingPhotographer] = useState<Photographer | null>(null);
  const [editForm, setEditForm] = useState({ name: '', bio: '', cpf: '', phone: '', instagram: '', avatar: '' });
  const [isUpdatingPhotographer, setIsUpdatingPhotographer] = useState(false);
  const [updatingWithdrawalId, setUpdatingWithdrawalId] = useState<string | null>(null);
  const [isBackfillingThumbnails, setIsBackfillingThumbnails] = useState(false);
  const [thumbnailBackfillProgress, setThumbnailBackfillProgress] = useState('');
  const [photographerSearch, setPhotographerSearch] = useState('');
  const [photographerStatusFilter, setPhotographerStatusFilter] = useState<PhotographerStatusFilter>('all');
  const [photographerActionDialog, setPhotographerActionDialog] = useState<{ type: PhotographerAdminAction; photographer: Photographer } | null>(null);
  const [actingPhotographerId, setActingPhotographerId] = useState<string | null>(null);
  const [photographerFeedback, setPhotographerFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [mediaSearch, setMediaSearch] = useState('');
  const [mediaStatusFilter, setMediaStatusFilter] = useState<'all' | NonNullable<Product['status']>>('all');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | Order['status']>('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | Order['status']>('all');
  const [paymentRecoveryIssues, setPaymentRecoveryIssues] = useState<PaymentRecoveryIssue[]>([]);
  const [paymentRecoverySummary, setPaymentRecoverySummary] = useState<Record<string, number>>({});
  const [isAuditingPayments, setIsAuditingPayments] = useState(false);
  const [recoveringPaymentOrderId, setRecoveringPaymentOrderId] = useState<string | null>(null);
  const [logSearch, setLogSearch] = useState('');
  const [visibleAdminRows, setVisibleAdminRows] = useState<Record<AdminListKey, number>>(initialVisibleAdminRows);
  const [updatingProductId, setUpdatingProductId] = useState<string | null>(null);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [resendingEmailOrderId, setResendingEmailOrderId] = useState<string | null>(null);
  const [updatingCouponId, setUpdatingCouponId] = useState<string | null>(null);
  const [couponForm, setCouponForm] = useState({
    code: '',
    type: 'percent' as Coupon['type'],
    value: '10',
    maxUses: '',
    expiresAt: '',
    isActive: true,
  });
  const [isCreatingCoupon, setIsCreatingCoupon] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<AdminPeriodKey>('year');
  const [customPeriodStart, setCustomPeriodStart] = useState(() => formatDateInput(startOfDay(new Date())));
  const [customPeriodEnd, setCustomPeriodEnd] = useState(() => formatDateInput(endOfDay(new Date())));
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAllRecentActivity, setShowAllRecentActivity] = useState(false);
  const [showAllOrderLogs, setShowAllOrderLogs] = useState(false);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [storageStatsError, setStorageStatsError] = useState('');
  const [referrals, setReferrals] = useState<PhotographerReferral[]>([]);
  const [updatingReferralId, setUpdatingReferralId] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventForm, setEventForm] = useState({
    name: '',
    date: formatDateInput(new Date()),
    location: '',
    checkpoint: 'Ponto Principal',
    status: 'active' as Event['status'],
    coverImage: '',
    cover_position: 'center center',
  });
  const [settingsForm, setSettingsForm] = useState<Pick<PlatformSettings, 'platformFeePercent' | 'withdrawalFee' | 'autoBlockSuspicious' | 'paymentProvider' | 'brandName' | 'supportEmail' | 'maxUploadBytes' | 'referralSettings'>>({
    platformFeePercent: 30,
    withdrawalFee: 5,
    autoBlockSuspicious: true,
    paymentProvider: 'infinitepay',
    brandName: 'Funpace Media',
    supportEmail: FUNPACE_CONTACT_EMAIL,
    maxUploadBytes: 314572800,
    referralSettings: referralService.defaultSettings,
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const platformFeeRate = Math.max(0, Math.min(100, Number(settingsForm.platformFeePercent) || 0)) / 100;
  const platformFeePercentLabel = new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 2,
  }).format(Number(settingsForm.platformFeePercent) || 0);

  const getPhotographerStatus = React.useCallback((photographer: Photographer): 'active' | 'pending' | 'disabled' => {
    if (photographer.blockedAt) return 'disabled';
    return photographer.verified ? 'active' : 'pending';
  }, []);
  const pendingPhotographers = photographers.filter((p) => getPhotographerStatus(p) === 'pending');
  const activePhotographers = photographers.filter((p) => getPhotographerStatus(p) === 'active');
  const disabledPhotographers = photographers.filter((p) => getPhotographerStatus(p) === 'disabled');
  const filteredPhotographers = React.useMemo(() => {
    const normalizedSearch = photographerSearch.trim().toLowerCase();

    return photographers.filter((photographer) => {
      const status = getPhotographerStatus(photographer);
      const matchesStatus = photographerStatusFilter === 'all' || photographerStatusFilter === status;

      const matchesSearch = !normalizedSearch || [
        photographer.name,
        photographer.email,
        photographer.id,
        photographer.instagram,
        photographer.phone,
        photographer.cpf,
      ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch));

      return matchesStatus && matchesSearch;
    });
  }, [getPhotographerStatus, photographers, photographerSearch, photographerStatusFilter]);
  const photographerById = React.useMemo(
    () => new Map(photographers.map((photographer) => [photographer.id, photographer])),
    [photographers],
  );
  const customerRows = React.useMemo(() => {
    const ordersByEmail = new Map<string, { orders: number; paidOrders: number; spent: number }>();
    for (const order of orders) {
      const email = String(order.buyerEmail || '').toLowerCase();
      if (!email) continue;
      const current = ordersByEmail.get(email) ?? { orders: 0, paidOrders: 0, spent: 0 };
      current.orders += 1;
      if (order.status === 'paid') {
        current.paidOrders += 1;
        current.spent += Number(order.total || 0);
      }
      ordersByEmail.set(email, current);
    }

    const customerEmails = new Set(customers.map((customer) => customer.email.toLowerCase()));
    const fromOrders = Array.from(ordersByEmail.entries())
      .filter(([email]) => !customerEmails.has(email))
      .map(([email, stats]) => ({
        id: `order:${email}`,
        email,
        name: orders.find((order) => order.buyerEmail?.toLowerCase() === email)?.buyerName || 'Cliente sem conta',
        createdAt: orders.find((order) => order.buyerEmail?.toLowerCase() === email)?.createdAt,
        role: 'customer' as const,
        ...stats,
      }));

    return [
      ...customers.map((customer) => {
        const stats = ordersByEmail.get(customer.email.toLowerCase()) ?? { orders: 0, paidOrders: 0, spent: 0 };
        return {
          id: customer.id,
          email: customer.email,
          name: customer.name || 'Cliente',
          createdAt: customer.createdAt,
          role: 'customer' as const,
          ...stats,
        };
      }),
      ...fromOrders,
    ];
  }, [customers, orders]);
  const filteredUsers = React.useMemo(() => {
    const normalized = userSearch.trim().toLowerCase();
    if (!normalized) return customerRows;
    return customerRows.filter((customer) => [
      customer.name,
      customer.email,
      customer.id,
    ].some((value) => String(value || '').toLowerCase().includes(normalized)));
  }, [customerRows, userSearch]);
  const allMedia = React.useMemo(() => [...photos, ...videos], [photos, videos]);
  const filteredMedia = React.useMemo(() => {
    const normalized = mediaSearch.trim().toLowerCase();
    return allMedia.filter((product) => {
      const productStatus = product.status ?? 'published';
      const matchesStatus = mediaStatusFilter === 'all' || productStatus === mediaStatusFilter;
      const matchesSearch = !normalized || [
        product.name,
        product.event,
        product.checkpoint,
        product.bib,
        product.id,
        photographerById.get(product.vendedorId)?.name,
      ].some((value) => String(value || '').toLowerCase().includes(normalized));
      return matchesStatus && matchesSearch;
    });
  }, [allMedia, mediaSearch, mediaStatusFilter, photographerById]);
  const periodRange = React.useMemo(
    () => getAdminPeriodRange(selectedPeriod, customPeriodStart, customPeriodEnd),
    [selectedPeriod, customPeriodStart, customPeriodEnd],
  );
  const periodLabel = React.useMemo(
    () => formatPeriodLabel(periodRange.start, periodRange.end),
    [periodRange],
  );
  const periodOrders = React.useMemo(
    () => orders.filter((order) => isWithinPeriod(order.createdAt, periodRange.start, periodRange.end)),
    [orders, periodRange],
  );
  const periodPhotos = React.useMemo(
    () => photos.filter((product) => isWithinPeriod(product.createdAt, periodRange.start, periodRange.end)),
    [photos, periodRange],
  );
  const periodVideos = React.useMemo(
    () => videos.filter((product) => isWithinPeriod(product.createdAt, periodRange.start, periodRange.end)),
    [videos, periodRange],
  );
  const periodPhotographers = React.useMemo(
    () => photographers.filter((photographer) => isWithinPeriod(photographer.createdAt, periodRange.start, periodRange.end)),
    [photographers, periodRange],
  );
  const filteredOrders = React.useMemo(() => {
    const normalized = orderSearch.trim().toLowerCase();
    return periodOrders.filter((order) => {
      const matchesStatus = orderStatusFilter === 'all' || order.status === orderStatusFilter;
      const eventText = (order.items ?? []).map((item) => item.event).join(' ');
      const photographerText = (order.items ?? []).map((item) => photographerById.get(item.vendedorId)?.name ?? item.vendedorId).join(' ');
      const matchesSearch = !normalized || [
        order.id,
        order.buyerName,
        order.buyerEmail,
        order.paymentProvider,
        eventText,
        photographerText,
      ].some((value) => String(value || '').toLowerCase().includes(normalized));
      return matchesStatus && matchesSearch;
    });
  }, [periodOrders, orderSearch, orderStatusFilter, photographerById]);
  const filteredPayments = React.useMemo(() => {
    return payments.filter((payment) => (
      paymentStatusFilter === 'all' || payment.status === paymentStatusFilter
    ));
  }, [payments, paymentStatusFilter]);
  const localPaymentIssues = React.useMemo<PaymentRecoveryIssue[]>(() => {
    const paymentsByOrder = new Map<string, PaymentRecord[]>();
    const eventsByOrder = new Map<string, PaymentEventLog[]>();
    for (const payment of payments) {
      const rows = paymentsByOrder.get(payment.orderId) ?? [];
      rows.push(payment);
      paymentsByOrder.set(payment.orderId, rows);
    }
    for (const eventItem of paymentEvents) {
      if (!eventItem.orderId) continue;
      const rows = eventsByOrder.get(eventItem.orderId) ?? [];
      rows.push(eventItem);
      eventsByOrder.set(eventItem.orderId, rows);
    }

    return orders.map((order) => {
      const orderPayments = paymentsByOrder.get(order.id) ?? [];
      const orderEvents = eventsByOrder.get(order.id) ?? [];
      const reasons: string[] = [];
      if (order.status !== 'paid' && orderPayments.some((payment) => payment.status === 'paid')) reasons.push('payment_paid_order_not_paid');
      if (order.status !== 'paid' && orderEvents.some((eventItem) => eventItem.status === 'paid')) reasons.push('webhook_paid_order_not_paid');
      if (order.status === 'pending' && orderPayments.some((payment) => payment.status === 'pending') && orderEvents.length === 0) reasons.push('pending_without_webhook');
      if (order.status === 'pending' && !order.paymentExternalId) reasons.push('missing_provider_identifiers');

      return {
        orderId: order.id,
        status: order.status,
        buyerName: order.buyerName,
        buyerEmail: order.buyerEmail,
        total: Number(order.total || 0),
        paymentMethod: order.paymentMethod,
        paymentProvider: order.paymentProvider,
        paymentExternalId: order.paymentExternalId,
        createdAt: order.createdAt,
        itemCount: order.items?.length ?? 0,
        accessCount: 0,
        missingAccessCount: 0,
        paymentStatuses: orderPayments.map((payment) => payment.status),
        eventStatuses: orderEvents.map((eventItem) => eventItem.status || '').filter(Boolean),
        hasTransactionNsu: Boolean(order.paymentExternalId),
        hasSlug: false,
        reasons,
      };
    }).filter((issue) => issue.paymentProvider === 'infinitepay' && issue.reasons.length > 0);
  }, [orders, payments, paymentEvents]);
  const visiblePaymentIssues = paymentRecoveryIssues.length > 0 ? paymentRecoveryIssues : localPaymentIssues;
  const operationalLogs = React.useMemo(() => {
    const webhookLogs: AdminActivityLog[] = paymentEvents.map((eventItem) => ({
      id: `webhook:${eventItem.id}`,
      action: 'payment_webhook',
      targetType: 'payment_event',
      targetId: eventItem.eventId,
      metadata: { provider: eventItem.provider, status: eventItem.status, orderId: eventItem.orderId },
      createdAt: eventItem.createdAt,
    }));
    return [...adminLogs, ...webhookLogs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [adminLogs, paymentEvents]);
  const filteredLogs = React.useMemo(() => {
    const normalized = logSearch.trim().toLowerCase();
    if (!normalized) return operationalLogs;
    return operationalLogs.filter((log) => [
      log.action,
      log.actorEmail,
      log.targetType,
      log.targetId,
      JSON.stringify(log.metadata || {}),
    ].some((value) => String(value || '').toLowerCase().includes(normalized)));
  }, [logSearch, operationalLogs]);
  const showMoreAdminRows = React.useCallback((key: AdminListKey) => {
    setVisibleAdminRows((current) => ({
      ...current,
      [key]: current[key] + adminListPageSizes[key],
    }));
  }, []);

  React.useEffect(() => {
    setVisibleAdminRows((current) => ({ ...current, users: adminListPageSizes.users }));
  }, [userSearch, customerRows.length]);

  React.useEffect(() => {
    setVisibleAdminRows((current) => ({ ...current, photographers: adminListPageSizes.photographers }));
  }, [photographerSearch, photographerStatusFilter, photographers.length]);

  React.useEffect(() => {
    setVisibleAdminRows((current) => ({ ...current, media: adminListPageSizes.media }));
  }, [mediaSearch, mediaStatusFilter, allMedia.length]);

  React.useEffect(() => {
    setVisibleAdminRows((current) => ({ ...current, orders: adminListPageSizes.orders }));
  }, [orderSearch, orderStatusFilter, selectedPeriod, customPeriodStart, customPeriodEnd, periodOrders.length]);

  React.useEffect(() => {
    setVisibleAdminRows((current) => ({
      ...current,
      paymentIssues: adminListPageSizes.paymentIssues,
      payments: adminListPageSizes.payments,
      paymentEvents: adminListPageSizes.paymentEvents,
    }));
  }, [paymentStatusFilter, payments.length, paymentEvents.length, visiblePaymentIssues.length]);

  React.useEffect(() => {
    setVisibleAdminRows((current) => ({ ...current, logs: adminListPageSizes.logs }));
  }, [logSearch, operationalLogs.length]);
  const referralRanking = React.useMemo(() => {
    const rows = new Map<string, { photographer: Photographer | undefined; total: number; rewarded: number }>();
    for (const referral of referrals) {
      const row = rows.get(referral.referrerPhotographerId) ?? {
        photographer: photographerById.get(referral.referrerPhotographerId),
        total: 0,
        rewarded: 0,
      };
      row.total += 1;
      row.rewarded += Number(referral.rewardAmount || 0);
      rows.set(referral.referrerPhotographerId, row);
    }
    return Array.from(rows.entries())
      .map(([id, row]) => ({ id, ...row }))
      .sort((left, right) => right.total - left.total || right.rewarded - left.rewarded)
      .slice(0, 10);
  }, [photographerById, referrals]);
  const periodWithdrawals = React.useMemo(
    () => withdrawals.filter((withdrawal) => isWithinPeriod(withdrawal.createdAt, periodRange.start, periodRange.end)),
    [withdrawals, periodRange],
  );
  const periodProducts = React.useMemo(
    () => [...periodPhotos, ...periodVideos],
    [periodPhotos, periodVideos],
  );
  const periodMetrics = React.useMemo<AdminMetrics>(() => {
    const paid = periodOrders.filter((order) => order.status === 'paid');
    const pending = periodOrders.filter((order) => order.status === 'pending');
    const grossRevenue = paid.reduce((sum, order) => sum + getOrderItemsRevenue(order), 0);
    const publishedProducts = periodProducts.filter((product) => (product.status ?? 'published') === 'published');
    const removedProducts = periodProducts.filter((product) => product.status === 'removed');

    return {
      grossRevenue,
      platformFee: grossRevenue * platformFeeRate,
      paidOrders: paid.length,
      pendingOrders: pending.length,
      totalOrders: periodOrders.length,
      totalProducts: periodProducts.length,
      publishedProducts: publishedProducts.length,
      removedProducts: removedProducts.length,
      photoCount: periodPhotos.filter((product) => product.type === 'IMG').length,
      videoCount: periodVideos.filter((product) => product.type === 'VIDEO' || product.type === 'VIEW').length,
    };
  }, [periodOrders, periodPhotos, periodProducts, periodVideos, platformFeeRate]);
  const previousPeriodRange = React.useMemo(
    () => getPreviousPeriodRange(periodRange.start, periodRange.end),
    [periodRange],
  );
  const previousPeriodOrders = React.useMemo(
    () => orders.filter((order) => isWithinPeriod(order.createdAt, previousPeriodRange.start, previousPeriodRange.end)),
    [orders, previousPeriodRange],
  );
  const previousPeriodPhotos = React.useMemo(
    () => photos.filter((product) => isWithinPeriod(product.createdAt, previousPeriodRange.start, previousPeriodRange.end)),
    [photos, previousPeriodRange],
  );
  const previousPeriodVideos = React.useMemo(
    () => videos.filter((product) => isWithinPeriod(product.createdAt, previousPeriodRange.start, previousPeriodRange.end)),
    [videos, previousPeriodRange],
  );
  const previousPeriodProducts = React.useMemo(
    () => [...previousPeriodPhotos, ...previousPeriodVideos],
    [previousPeriodPhotos, previousPeriodVideos],
  );
  const previousPeriodPhotographers = React.useMemo(
    () => photographers.filter((photographer) => isWithinPeriod(photographer.createdAt, previousPeriodRange.start, previousPeriodRange.end)),
    [photographers, previousPeriodRange],
  );
  const previousPeriodMetrics = React.useMemo<AdminMetrics>(() => {
    const paid = previousPeriodOrders.filter((order) => order.status === 'paid');
    const pending = previousPeriodOrders.filter((order) => order.status === 'pending');
    const grossRevenue = paid.reduce((sum, order) => sum + getOrderItemsRevenue(order), 0);
    const publishedProducts = previousPeriodProducts.filter((product) => (product.status ?? 'published') === 'published');
    const removedProducts = previousPeriodProducts.filter((product) => product.status === 'removed');

    return {
      grossRevenue,
      platformFee: grossRevenue * platformFeeRate,
      paidOrders: paid.length,
      pendingOrders: pending.length,
      totalOrders: previousPeriodOrders.length,
      totalProducts: previousPeriodProducts.length,
      publishedProducts: publishedProducts.length,
      removedProducts: removedProducts.length,
      photoCount: previousPeriodPhotos.filter((product) => product.type === 'IMG').length,
      videoCount: previousPeriodVideos.filter((product) => product.type === 'VIDEO' || product.type === 'VIEW').length,
    };
  }, [previousPeriodOrders, previousPeriodPhotos, previousPeriodProducts, previousPeriodVideos, platformFeeRate]);
  const adminStatTrends = React.useMemo(() => ({
    grossRevenue: formatTrendPercent(periodMetrics.grossRevenue, previousPeriodMetrics.grossRevenue),
    platformFee: formatTrendPercent(periodMetrics.platformFee, previousPeriodMetrics.platformFee),
    photographers: '0,0%',
    videos: formatTrendPercent(periodMetrics.videoCount, previousPeriodMetrics.videoCount),
  }), [activePhotographers.length, periodMetrics, previousPeriodMetrics]);
  const adminStatSparklines = React.useMemo(() => ({
    grossRevenue: buildSparklineBuckets(
      periodOrders.filter((order) => order.status === 'paid'),
      periodRange.start,
      periodRange.end,
      (order) => order.createdAt,
      (order) => getOrderItemsRevenue(order),
    ),
    platformFee: buildSparklineBuckets(
      periodOrders.filter((order) => order.status === 'paid'),
      periodRange.start,
      periodRange.end,
      (order) => order.createdAt,
      (order) => getOrderItemsRevenue(order) * platformFeeRate,
    ),
    photographers: Array.from({ length: 12 }, () => activePhotographers.length > 0 ? 42 : 8),
    videos: buildSparklineBuckets(
      periodVideos.filter((product) => product.type === 'VIDEO' || product.type === 'VIEW'),
      periodRange.start,
      periodRange.end,
      (product) => product.createdAt,
      () => 1,
    ),
  }), [activePhotographers.length, periodOrders, periodRange, periodVideos, platformFeeRate]);
  const recentOrders = periodOrders.slice(0, 5);
  const visibleOrderLogs = showAllOrderLogs ? periodOrders : recentOrders;
  const pendingOrders = periodOrders.filter((order) => order.status === 'pending');
  const paidOrders = periodOrders.filter((order) => order.status === 'paid');
  const productsMissingThumbnails = [...photos, ...videos].filter((product) => (
    !product.thumbnailUrl &&
    Boolean(product.url) &&
    (product.status ?? 'published') !== 'removed'
  ));
  const pendingWithdrawals = periodWithdrawals.filter((withdrawal) => withdrawal.status === 'pending');
  const processedWithdrawals = periodWithdrawals.filter((withdrawal) => withdrawal.status !== 'pending');
  const adminNotifications = React.useMemo(() => {
    const pendingOrderCount = orders.filter((order) => order.status === 'pending').length;
    const pendingWithdrawalCount = withdrawals.filter((withdrawal) => withdrawal.status === 'pending').length;
    const missingThumbnailCount = productsMissingThumbnails.length;
    const notifications: Array<{ id: string; title: string; detail: string; tab: typeof activeTab }> = [];

    if (pendingPhotographers.length > 0) {
      notifications.push({
        id: 'pending-photographers',
        title: pendingPhotographers.length === 1 ? '1 fotógrafo pendente' : `${pendingPhotographers.length} fotógrafos pendentes`,
        detail: 'Aguardando aprovacao de cadastro',
        tab: 'photographers',
      });
    }

    if (pendingOrderCount > 0) {
      notifications.push({
        id: 'pending-orders',
        title: `${pendingOrderCount} pedido(s) pendente(s)`,
        detail: 'Pagamentos aguardando confirmacao',
        tab: 'sales',
      });
    }

    if (pendingWithdrawalCount > 0) {
      notifications.push({
        id: 'pending-withdrawals',
        title: `${pendingWithdrawalCount} saque(s) pendente(s)`,
        detail: 'Solicitacoes Pix para processamento',
        tab: 'sales',
      });
    }

    if (missingThumbnailCount > 0) {
      notifications.push({
        id: 'missing-thumbnails',
        title: `${missingThumbnailCount} preview(s) ausente(s)`,
        detail: 'Mídias precisam de thumbnail dedicado',
        tab: 'overview',
      });
    }

    return notifications;
  }, [orders, pendingPhotographers.length, productsMissingThumbnails.length, withdrawals]);
  const pendingWithdrawalTotal = pendingWithdrawals.reduce((sum, withdrawal) => sum + Number(withdrawal.amount || 0), 0);
  const paidOrderStoredTotal = paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const mediaEvents = React.useMemo(() => {
    const grouped = new Map<string, {
      name: string;
      checkpoint: string;
      coverImage: string;
      date: string;
      photoCount: number;
      videoCount: number;
      latestCreatedAt: string;
    }>();

    for (const product of [...photos, ...videos]) {
      if ((product.status ?? 'published') === 'removed') continue;

      const name = String(product.event || 'Geral').trim() || 'Geral';
      const key = normalizeEventKey(name);
      const current = grouped.get(key);
      const createdAt = product.createdAt || '';
      const isVideo = product.type === 'VIDEO' || product.type === 'VIEW';

      if (!current) {
        grouped.set(key, {
          name,
          checkpoint: product.checkpoint || 'Ponto principal',
          coverImage: product.thumbnailUrl || product.url || '',
          date: createdAt ? createdAt.slice(0, 10) : formatDateInput(new Date()),
          photoCount: product.type === 'IMG' ? 1 : 0,
          videoCount: isVideo ? 1 : 0,
          latestCreatedAt: createdAt,
        });
        continue;
      }

      if (product.type === 'IMG') current.photoCount += 1;
      if (isVideo) current.videoCount += 1;
      if (!current.checkpoint && product.checkpoint) current.checkpoint = product.checkpoint;
      if (!current.coverImage && (product.thumbnailUrl || product.url)) {
        current.coverImage = product.thumbnailUrl || product.url || '';
      }
      if (createdAt && (!current.latestCreatedAt || createdAt > current.latestCreatedAt)) {
        current.latestCreatedAt = createdAt;
        current.date = createdAt.slice(0, 10);
      }
    }

    return Array.from(grouped.values()).sort((left, right) =>
      right.latestCreatedAt.localeCompare(left.latestCreatedAt) || left.name.localeCompare(right.name)
    );
  }, [photos, videos]);
  const adminEventRows = React.useMemo(() => {
    const manualKeys = new Set(events.map((eventItem) => normalizeEventKey(eventItem.name)));
    return [
      ...events.map((eventItem) => ({
        id: eventItem.id,
        name: eventItem.name,
        location: eventItem.location || 'Local não informado',
        checkpoint: eventItem.checkpoint || 'Ponto padrao',
        date: eventItem.date,
        status: eventItem.status,
        coverImage: eventItem.coverImage || '',
        cover_position: eventItem.cover_position || 'center center',
        source: 'Cadastro',
        mediaLabel: '',
        canEdit: true,
      })),
      ...mediaEvents
        .filter((eventItem) => !manualKeys.has(normalizeEventKey(eventItem.name)))
        .map((eventItem) => ({
          id: `media-${normalizeEventKey(eventItem.name)}`,
          name: eventItem.name,
          location: 'Criado pelas mídias publicadas',
          checkpoint: eventItem.checkpoint,
          date: eventItem.date,
          status: 'active' as const,
          coverImage: eventItem.coverImage,
          cover_position: 'center center',
          source: 'Mídias',
          mediaLabel: `${eventItem.photoCount} foto(s) / ${eventItem.videoCount} video(s)`,
          canEdit: true,
        })),
    ];
  }, [events, mediaEvents]);
  const eventCoverCandidates = React.useMemo(() => {
    const normalizedName = normalizeEventKey(eventForm.name);
    if (!normalizedName) return [];

    return allMedia
      .filter((product) => (
        (product.status ?? 'published') !== 'removed' &&
        normalizeEventKey(product.event || '') === normalizedName &&
        Boolean(product.thumbnailUrl || product.url)
      ))
      .slice(0, 24);
  }, [allMedia, eventForm.name]);
  const reportItemsByPaidOrder = React.useMemo(() => {
    const allProducts = [...photos, ...videos].filter((product) => (product.status ?? 'published') !== 'removed');

    return new Map(paidOrders.map((order) => {
      const explicitItems = (order.items ?? []).filter((item) => item.vendedorId);
      if (explicitItems.length > 0) return [order.id, explicitItems];

      if (allProducts.length === 1) {
        const product = allProducts[0];
        return [order.id, [{
          id: `fallback-${order.id}-${product.id}`,
          orderId: order.id,
          productId: product.id,
          name: product.name,
          type: product.type,
          price: Number(order.total || product.price || 0),
          url: product.url,
          vendedorId: product.vendedorId,
          bib: product.bib,
          event: product.event || 'Geral',
          checkpoint: product.checkpoint,
          thumbnailUrl: product.thumbnailUrl ?? null,
          createdAt: order.createdAt,
        }]];
      }

      return [order.id, []];
    }));
  }, [paidOrders, photos, videos]);
  const paidSaleItems = React.useMemo(
    () => paidOrders.flatMap((order) => reportItemsByPaidOrder.get(order.id) ?? []),
    [paidOrders, reportItemsByPaidOrder],
  );
  const paidOrdersWithoutItems = paidOrders.filter((order) => (order.items?.length ?? 0) === 0);
  const paidRevenueTotal = paidOrders.reduce((sum, order) => sum + getOrderItemsRevenue(order), 0);
  const paidRevenueMismatch = Math.abs(paidRevenueTotal - paidOrderStoredTotal) > 0.01;
  const recentActivity = React.useMemo(() => {
    type Activity = { id: string; kind: 'photographer' | 'product' | 'order'; at: number; title: string; meta: string };

    const toTs = (iso?: string) => {
      const t = iso ? Date.parse(iso) : NaN;
      return Number.isFinite(t) ? t : 0;
    };

    const timeAgo = (ts: number) => {
      if (!ts) return 'Agora';
      const diffMs = Date.now() - ts;
      const min = Math.max(0, Math.floor(diffMs / 60000));
      if (min < 1) return 'Agora';
      if (min < 60) return `Ha ${min} minuto${min === 1 ? '' : 's'}`;
      const h = Math.floor(min / 60);
      if (h < 24) return `Ha ${h} hora${h === 1 ? '' : 's'}`;
      const d = Math.floor(h / 24);
      return `Ha ${d} dia${d === 1 ? '' : 's'}`;
    };

    const activities: Activity[] = [];

    for (const p of periodPhotographers) {
      const at = toTs(p.createdAt);
      if (!at) continue;
      activities.push({
        id: `p:${p.id}`,
        kind: 'photographer',
        at,
        title: `Novo fotógrafo cadastrado: ${p.name}`,
        meta: `${timeAgo(at)} • Sistema`,
      });
    }

    for (const prod of periodProducts) {
      const at = toTs(prod.createdAt);
      if (!at) continue;
      const label = prod.type === 'IMG' ? 'Nova foto publicada' : 'Novo video publicado';
      const eventLabel = prod.event || 'Geral';
      activities.push({
        id: `m:${prod.id}`,
        kind: 'product',
        at,
        title: `${label}: ${eventLabel}`,
        meta: `${timeAgo(at)} • Catalogo`,
      });
    }

    for (const o of periodOrders) {
      const at = toTs(o.status === 'paid' ? (o.updatedAt || o.createdAt) : o.createdAt);
      if (!at) continue;
      const label = ({
        paid: 'Pagamento confirmado',
        pending: 'Checkout iniciado',
        failed: 'Pagamento falhou',
        cancelled: 'Pedido cancelado',
        refunded: 'Pedido reembolsado',
      } as Record<Order['status'], string>)[o.status] ?? 'Atualizacao de pedido';
      activities.push({
        id: `o:${o.id}`,
        kind: 'order',
        at,
        title: `${label}: Pedido #${o.id.slice(0, 8)}`,
        meta: `${timeAgo(at)} - ${formatCurrency(Number(o.total || 0))} - ${(o.items?.length ?? 0) === 1 ? '1 item' : `${o.items?.length ?? 0} itens`}`,
      });
    }

    return activities
      .sort((a, b) => b.at - a.at);
  }, [periodPhotographers, periodProducts, periodOrders]);
  const visibleRecentActivity = showAllRecentActivity ? recentActivity : recentActivity.slice(0, 6);
  const eventReports = React.useMemo(() => {
    const reports = new Map<string, { event: string; items: number; orders: Set<string>; revenue: number }>();

    for (const order of paidOrders) {
      for (const item of reportItemsByPaidOrder.get(order.id) ?? []) {
        const event = item.event || 'Geral';
        const current = reports.get(event) ?? { event, items: 0, orders: new Set<string>(), revenue: 0 };
        current.items += 1;
        current.orders.add(order.id);
        current.revenue += Number(item.price || 0);
        reports.set(event, current);
      }
    }

    return Array.from(reports.values())
      .map((report) => ({ ...report, ordersCount: report.orders.size }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [paidOrders, reportItemsByPaidOrder]);
  const photographerReports = React.useMemo(() => {
    const photographersById = new Map(photographers.map((photographer) => [photographer.id, photographer]));
    const reports = new Map<string, { photographerId: string; name: string; items: number; orders: Set<string>; revenue: number }>();

    for (const order of paidOrders) {
      for (const item of reportItemsByPaidOrder.get(order.id) ?? []) {
        const photographer = photographersById.get(item.vendedorId);
        const current = reports.get(item.vendedorId) ?? {
          photographerId: item.vendedorId,
          name: photographer?.name ?? item.vendedorId,
          items: 0,
          orders: new Set<string>(),
          revenue: 0,
        };
        current.items += 1;
        current.orders.add(order.id);
        current.revenue += Number(item.price || 0);
        reports.set(item.vendedorId, current);
      }
    }

    return Array.from(reports.values())
      .map((report) => ({ ...report, ordersCount: report.orders.size }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [paidOrders, photographers, reportItemsByPaidOrder]);
  const topPhotoReports = React.useMemo(() => {
    const reports = new Map<string, { productId: string; name: string; event: string; bib: string; items: number; orders: Set<string>; revenue: number }>();

    for (const order of paidOrders) {
      for (const item of reportItemsByPaidOrder.get(order.id) ?? []) {
        if (item.type !== 'IMG') continue;

        const current = reports.get(item.productId) ?? {
          productId: item.productId,
          name: item.name,
          event: item.event || 'Geral',
          bib: item.bib || '',
          items: 0,
          orders: new Set<string>(),
          revenue: 0,
        };
        current.items += 1;
        current.orders.add(order.id);
        current.revenue += Number(item.price || 0);
        reports.set(item.productId, current);
      }
    }

    return Array.from(reports.values())
      .map((report) => ({ ...report, ordersCount: report.orders.size }))
      .sort((a, b) => b.items - a.items || b.revenue - a.revenue)
      .slice(0, 5);
  }, [paidOrders, reportItemsByPaidOrder]);
  const storageUsagePercent = storageStats?.usagePercent ?? 0;
  const paidConversionPercent = periodMetrics.totalOrders === 0
    ? 0
    : Math.round((periodMetrics.paidOrders / periodMetrics.totalOrders) * 1000) / 10;

  React.useEffect(() => {
    async function loadSettings() {
      try {
        const settings = await platformSettingsService.getSettings();
        setSettingsForm({
          platformFeePercent: Number(settings.platformFeePercent),
          withdrawalFee: Number(settings.withdrawalFee),
          autoBlockSuspicious: Boolean(settings.autoBlockSuspicious),
          paymentProvider: settings.paymentProvider || 'infinitepay',
          brandName: settings.brandName || 'Funpace Media',
          supportEmail: settings.supportEmail || FUNPACE_CONTACT_EMAIL,
          maxUploadBytes: Number(settings.maxUploadBytes || 314572800),
          referralSettings: settings.referralSettings || referralService.defaultSettings,
        });
      } catch (error) {
        console.error('Erro ao carregar configuracoes:', error);
      }
    }

    loadSettings();
  }, []);

  const loadReferrals = React.useCallback(async () => {
    const rows = await referralService.getAdminReferrals().catch(() => []);
    setReferrals(rows);
  }, []);

  React.useEffect(() => {
    loadReferrals();
  }, [loadReferrals]);

  React.useEffect(() => {
    async function loadStorageStats() {
      try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('/api/media/storage-stats', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload?.error || 'Não foi possível consultar o storage.');
        }

        setStorageStats(payload as StorageStats);
        setStorageStatsError('');
      } catch (error) {
        console.error('Erro ao carregar estatisticas do storage:', error);
        setStorageStatsError(error instanceof Error ? error.message : 'Storage indisponivel.');
      }
    }

    loadStorageStats();
  }, []);

  const loadEvents = React.useCallback(async () => {
    setIsLoadingEvents(true);
    try {
      const rows = await eventService.getEvents();
      setEvents(rows);
    } catch (error) {
      console.error('Erro ao carregar eventos:', error);
    } finally {
      setIsLoadingEvents(false);
    }
  }, []);

  React.useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  React.useEffect(() => {
    if (!openMenuPhotographerId) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest('[data-photographer-menu]')) return;
      setOpenMenuPhotographerId(null);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [openMenuPhotographerId]);

  const handleVerifyPhotographer = async (id: string) => {
    try {
      await photographerService.setPhotographerAdminStatus(id, 'reactivate');
      onRefresh();
      alert("Fotógrafo aprovado com sucesso!");
    } catch (error) {
      console.error(error);
      alert("Erro ao aprovar fotógrafo.");
    }
  };

  const handleAddPhotographer = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const token = await getCurrentAccessToken();
      if (!token) {
        throw new Error('Sessão admin expirada. Entre novamente para convidar fotógrafos.');
      }

      const response = await fetch('/api/admin/photographers/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newPhotographer.name,
          email: newPhotographer.email,
          instagram: normalizeInstagramInput(newPhotographer.instagram),
          bio: newPhotographer.bio,
        }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload?.error || errorPayload?.message || 'Erro ao convidar fotógrafo.');
      }

      const payload = await response.json().catch(() => ({}));

      onRefresh();
      setShowAddModal(false);
      setNewPhotographer({ name: '', email: '', instagram: '', bio: '' });
      alert(payload?.message || "Fotógrafo cadastrado e convite de senha enviado por e-mail.");
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Erro ao cadastrar fotógrafo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetEventForm = () => {
    setEditingEventId(null);
    setShowEventModal(false);
    setEventForm({
      name: '',
      date: formatDateInput(new Date()),
      location: '',
      checkpoint: 'Ponto Principal',
      status: 'active',
      coverImage: '',
      cover_position: 'center center',
    });
  };

  const openCreateEvent = () => {
    setEditingEventId(null);
    setEventForm({
      name: '',
      date: formatDateInput(new Date()),
      location: '',
      checkpoint: 'Ponto Principal',
      status: 'active',
      coverImage: '',
      cover_position: 'center center',
    });
    setShowEventModal(true);
  };

  const openEditEvent = (eventItem: Pick<Event, 'id' | 'name' | 'date' | 'location' | 'checkpoint' | 'status'> & { coverImage?: string | null; cover_position?: string | null }) => {
    setEditingEventId(eventItem.id);
    setEventForm({
      name: eventItem.name,
      date: eventItem.date,
      location: eventItem.location ?? '',
      checkpoint: eventItem.checkpoint ?? 'Ponto Principal',
      status: eventItem.status,
      coverImage: eventItem.coverImage ?? '',
      cover_position: eventItem.cover_position ?? 'center center',
    });
    setShowEventModal(true);
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = eventForm.name.trim();
    if (!name) {
      alert('Informe o nome do evento.');
      return;
    }

    setIsCreatingEvent(true);
    try {
      const payload = {
        name,
        date: eventForm.date,
        location: eventForm.location.trim() || null,
        checkpoint: eventForm.checkpoint.trim() || null,
        status: eventForm.status,
        coverImage: eventForm.coverImage.trim() || null,
        cover_position: eventForm.cover_position || 'center center',
      };

      if (editingEventId && !editingEventId.startsWith('media-')) {
        const updated = await eventService.updateEvent(editingEventId, payload);
        setEvents((current) => current.map((eventItem) => (eventItem.id === updated.id ? updated : eventItem)));
        resetEventForm();
        alert('Evento atualizado com sucesso.');
        return;
      }

      const created = await eventService.createEvent(payload);
      setEvents((current) => [created, ...current]);
      resetEventForm();
      alert(created.id.startsWith('local-event-')
        ? 'Evento salvo localmente. A tabela public.events ainda precisa ser criada no Supabase para sincronizar entre usuários.'
        : 'Evento criado com sucesso.');
    } catch (error) {
      console.error('Erro ao salvar evento:', error);
      alert(error instanceof Error ? error.message : 'Não foi possível salvar o evento.');
    } finally {
      setIsCreatingEvent(false);
    }
  };

  const openEditPhotographer = (photographer: Photographer) => {
    setEditingPhotographer(photographer);
    setEditForm({
      name: photographer.name ?? '',
      bio: photographer.bio ?? '',
      cpf: formatCpf(photographer.cpf ?? ''),
      phone: photographer.phone ?? '',
      instagram: photographer.instagram ?? '',
      avatar: photographer.avatar ?? '',
    });
    setOpenMenuPhotographerId(null);
  };

  const handleSavePhotographer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPhotographer) return;

    const cpfDigits = onlyCpfDigits(editForm.cpf);
    if (cpfDigits && !isValidCpf(cpfDigits)) {
      alert('CPF inválido.');
      return;
    }

    setIsUpdatingPhotographer(true);
    try {
      const instagram = normalizeInstagramInput(editForm.instagram);
      if (instagram && !/^@[a-z0-9._]{1,29}$/.test(instagram)) {
        alert('Instagram inválido. Use apenas letras, números, ponto ou underline.');
        return;
      }

      await photographerService.updatePhotographerAdmin(editingPhotographer.id, {
        name: editForm.name.trim(),
        bio: editForm.bio,
        cpf: cpfDigits || null,
        phone: editForm.phone.trim() || null,
        instagram: instagram || null,
        avatar: editForm.avatar.trim() || editingPhotographer.avatar,
      } as any);
      await onRefresh();
      setEditingPhotographer(null);
      alert('Fotógrafo atualizado com sucesso.');
    } catch (error) {
      console.error(error);
      alert('Erro ao atualizar fotógrafo.');
    } finally {
      setIsUpdatingPhotographer(false);
    }
  };

  const openPhotographerPublicProfile = (photographer: Photographer) => {
    const slug = photographer.username || photographer.slug;
    setOpenMenuPhotographerId(null);
    if (!slug) {
      setPhotographerFeedback({ type: 'error', message: 'Este fotógrafo ainda não possui URL pública configurada.' });
      return;
    }
    window.open(`/${slug}`, '_blank', 'noopener,noreferrer');
  };

  const openPhotographerEvents = () => {
    setOpenMenuPhotographerId(null);
    setActiveTab('events');
  };

  const openPhotographerActionDialog = (type: PhotographerAdminAction, photographer: Photographer) => {
    setOpenMenuPhotographerId(null);
    setPhotographerFeedback(null);
    setPhotographerActionDialog({ type, photographer });
  };

  const handleConfirmPhotographerAction = async () => {
    if (!photographerActionDialog) return;

    const { type, photographer } = photographerActionDialog;
    setActingPhotographerId(photographer.id);
    setIsUpdatingPhotographer(true);
    setPhotographerFeedback(null);
    try {
      if (type === 'delete') {
        await photographerService.deletePhotographerAdmin(photographer.id);
        setPhotographerFeedback({ type: 'success', message: 'Fotógrafo excluído com sucesso.' });
      } else {
        await photographerService.setPhotographerAdminStatus(photographer.id, type);
        setPhotographerFeedback({
          type: 'success',
          message: type === 'disable' ? 'Fotógrafo desativado com sucesso.' : 'Fotógrafo reativado com sucesso.',
        });
      }
      setPhotographerActionDialog(null);
      await onRefresh();
    } catch (error) {
      console.error(error);
      setPhotographerFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível concluir a operação.',
      });
    } finally {
      setActingPhotographerId(null);
      setIsUpdatingPhotographer(false);
    }
  };

  const handleWithdrawalStatus = async (withdrawal: WithdrawalRequest, status: WithdrawalRequest['status']) => {
    const photographer = photographerById.get(withdrawal.photographerId);
    const actionLabel = status === 'paid' ? 'marcar como pago' : 'recusar';
    const confirmed = window.confirm(
      `Deseja ${actionLabel} o saque de ${formatCurrency(Number(withdrawal.amount))}${photographer ? ` para ${photographer.name}` : ''}?`,
    );
    if (!confirmed) return;

    setUpdatingWithdrawalId(withdrawal.id);
    try {
      await withdrawalService.updateWithdrawalStatus(
        withdrawal.id,
        status,
        status === 'paid' ? 'Transferencia Pix realizada pelo admin.' : 'Solicitacao recusada pelo admin.',
      );
      await onRefresh();
      alert(status === 'paid' ? 'Saque marcado como pago.' : 'Saque recusado.');
    } catch (error) {
      console.error(error);
      alert('Erro ao atualizar saque.');
    } finally {
      setUpdatingWithdrawalId(null);
    }
  };

  const handleBackfillThumbnails = async () => {
    const targets = productsMissingThumbnails.slice(0, 25);
    if (targets.length === 0) return;

    const confirmed = window.confirm(`Gerar previews para ${targets.length === 1 ? '1 produto' : `${targets.length} produtos`} sem thumbnail?`);
    if (!confirmed) return;

    setIsBackfillingThumbnails(true);
    setThumbnailBackfillProgress(`0/${targets.length}`);

    let completed = 0;
    let failed = 0;

    try {
      for (const product of targets) {
        try {
          const thumbnail = await createThumbnailFromMedia(product);
          const uploaded = await productService.uploadProductThumbnail(product.vendedorId, thumbnail);
          await productService.updateProductThumbnail(product.id, uploaded.path);
          completed += 1;
        } catch (error) {
          failed += 1;
          console.error(`Erro ao gerar preview do produto ${product.id}:`, error);
        }
        setThumbnailBackfillProgress(`${completed + failed}/${targets.length}`);
      }

      await onRefresh();
      alert(failed > 0
        ? `Previews gerados: ${completed}. Falhas: ${failed}. Se falhar para mídias externas, confira se a URL pública permite CORS.`
        : `Previews gerados com sucesso: ${completed}.`);
    } finally {
      setIsBackfillingThumbnails(false);
    }
  };

  const handleSaveSettings = async () => {
    if (settingsForm.platformFeePercent < 0 || settingsForm.platformFeePercent > 100) {
      alert('A taxa da plataforma deve ficar entre 0 e 100%.');
      return;
    }

    if (settingsForm.withdrawalFee < 0) {
      alert('A taxa de saque não pode ser negativa.');
      return;
    }

    const referralSettings = {
      ...referralService.defaultSettings,
      ...(settingsForm.referralSettings || {}),
    };
    if (
      referralSettings.approvalRewardAmount < 0 ||
      referralSettings.firstSaleRewardAmount < 0 ||
      referralSettings.recurringCommissionPercent < 0 ||
      referralSettings.recurringCommissionPercent > 100 ||
      referralSettings.recurringCommissionMonths < 1
    ) {
      alert('Revise os valores do programa de indicacao.');
      return;
    }

    setIsSavingSettings(true);
    try {
      const updated = await platformSettingsService.updateSettings({ ...settingsForm, referralSettings });
      setSettingsForm({
        platformFeePercent: Number(updated.platformFeePercent),
        withdrawalFee: Number(updated.withdrawalFee),
        autoBlockSuspicious: Boolean(updated.autoBlockSuspicious),
        paymentProvider: updated.paymentProvider || settingsForm.paymentProvider,
        brandName: updated.brandName || settingsForm.brandName,
        supportEmail: updated.supportEmail || '',
        maxUploadBytes: Number(updated.maxUploadBytes || settingsForm.maxUploadBytes),
        referralSettings: updated.referralSettings || referralSettings,
      });
      await adminService.logAction({
        action: 'platform_settings_updated',
        targetType: 'platform_settings',
        targetId: 'default',
        metadata: settingsForm,
      });
      alert('Configurações salvas com sucesso.');
    } catch (error) {
      console.error(error);
      alert('Erro ao salvar configuracoes.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleReferralAction = async (referral: PhotographerReferral, action: 'approve' | 'cancel' | 'mark_paid') => {
    setUpdatingReferralId(referral.id);
    try {
      await referralService.updateReferralAdmin(referral.id, action);
      await loadReferrals();
      await onRefresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Nao foi possivel atualizar a indicacao.');
    } finally {
      setUpdatingReferralId(null);
    }
  };

  const handleModerateProduct = async (product: Product, status: NonNullable<Product['status']>) => {
    setUpdatingProductId(product.id);
    try {
      await productService.updateProductStatus(product.id, status);
      await adminService.logAction({
        action: 'product_status_updated',
        targetType: 'product',
        targetId: product.id,
        metadata: { status, previousStatus: product.status ?? 'published' },
      });
      await onRefresh();
    } catch (error) {
      console.error(error);
      alert('Não foi possível atualizar a mídia.');
    } finally {
      setUpdatingProductId(null);
    }
  };

  const handleAdminOrderStatus = async (order: Order, status: Order['status']) => {
    if (order.status === status) return;

    if (status === 'paid') {
      await handleManualReleaseOrder(order);
      return;
    }

    const confirmed = window.confirm(`Atualizar pedido #${order.id.slice(0, 8)} para ${orderStatusLabels[status]}?`);
    if (!confirmed) return;

    setUpdatingOrderId(order.id);
    try {
      await orderService.updateOrderStatus(order.id, status);
      await adminService.logAction({
        action: 'order_status_updated',
        targetType: 'order',
        targetId: order.id,
        metadata: { status, previousStatus: order.status },
      });
      await onRefresh();
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error || '');
      alert(message || 'Não foi possível atualizar o pedido.');
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handleManualReleaseOrder = async (order: Order) => {
    if (order.status === 'paid') return;

    const reason = window.prompt(`Informe o comprovante/motivo detalhado para liberar #${order.id.slice(0, 8)}:`)?.trim() || '';
    if (reason.length < 20) {
      if (reason) alert('Informe pelo menos 20 caracteres com comprovante/motivo da liberação.');
      return;
    }

    const confirmed = window.confirm(`Liberar manualmente o pedido #${order.id.slice(0, 8)} como pago?`);
    if (!confirmed) return;

    setRecoveringPaymentOrderId(order.id);
    try {
      await adminService.recoverPayment({ orderId: order.id, action: 'manual_release', reason });
      await handleAuditPayments();
      await onRefresh();
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : 'Não foi possível liberar o pedido.');
    } finally {
      setRecoveringPaymentOrderId(null);
    }
  };

  const handleResendDownloadEmail = async (order: Order) => {
    if (order.status !== 'paid') {
      alert('O e-mail de download so pode ser reenviado para pedidos pagos.');
      return;
    }
    const confirmed = window.confirm(`Reenviar e-mail de download para ${order.buyerEmail}?`);
    if (!confirmed) return;

    setResendingEmailOrderId(order.id);
    try {
      await orderService.resendDownloadEmail(order.id, 'admin');
      await adminService.logAction({
        action: 'download_email_resent',
        targetType: 'order',
        targetId: order.id,
        metadata: { buyerEmail: order.buyerEmail, source: 'admin_dashboard' },
      });
      alert('E-mail de download reenviado.');
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : 'Nao foi possivel reenviar o e-mail.');
    } finally {
      setResendingEmailOrderId(null);
    }
  };

  const handleAuditPayments = async () => {
    setIsAuditingPayments(true);
    try {
      const result = await adminService.getPaymentRecoveryIssues();
      setPaymentRecoveryIssues(result.issues);
      setPaymentRecoverySummary(result.summary);
    } catch (error) {
      console.error(error);
      alert('Não foi possível auditar pagamentos.');
    } finally {
      setIsAuditingPayments(false);
    }
  };

  const handleRecoverPayment = async (issue: PaymentRecoveryIssue, action: 'reprocess' | 'manual_release' | 'fulfill') => {
    let reason = '';
    if (action === 'manual_release') {
      reason = window.prompt(`Informe o comprovante/motivo para liberar #${issue.orderId.slice(0, 8)}:`)?.trim() || '';
      if (reason.length < 8) return;
    }

    const label = action === 'reprocess' ? 'reprocessar' : action === 'fulfill' ? 'reexecutar liberacao' : 'liberar manualmente';
    const confirmed = window.confirm(`Confirmar ${label} do pedido #${issue.orderId.slice(0, 8)}?`);
    if (!confirmed) return;

    setRecoveringPaymentOrderId(issue.orderId);
    try {
      await adminService.recoverPayment({ orderId: issue.orderId, action, reason });
      await handleAuditPayments();
      await onRefresh();
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : 'Não foi possível recuperar o pagamento.');
    } finally {
      setRecoveringPaymentOrderId(null);
    }
  };

  const handleCreateCoupon = async (event: React.FormEvent) => {
    event.preventDefault();
    const code = couponForm.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const value = Number(couponForm.value);
    const maxUses = couponForm.maxUses ? Number(couponForm.maxUses) : null;

    if (code.length < 3) {
      alert('Informe um codigo de cupom com pelo menos 3 caracteres.');
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      alert('Informe um desconto valido.');
      return;
    }
    if (couponForm.type === 'percent' && value > 100) {
      alert('Cupom percentual não pode passar de 100%.');
      return;
    }

    setIsCreatingCoupon(true);
    try {
      const created = await adminService.createCoupon({
        code,
        type: couponForm.type,
        value,
        maxUses,
        startsAt: null,
        expiresAt: couponForm.expiresAt ? new Date(`${couponForm.expiresAt}T23:59:59`).toISOString() : null,
        isActive: couponForm.isActive,
      });
      await adminService.logAction({
        action: 'coupon_created',
        targetType: 'coupon',
        targetId: created.id,
        metadata: { code: created.code, type: created.type, value: created.value },
      });
      setCouponForm({ code: '', type: 'percent', value: '10', maxUses: '', expiresAt: '', isActive: true });
      await onRefresh();
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : 'Não foi possível criar o cupom.');
    } finally {
      setIsCreatingCoupon(false);
    }
  };

  const handleToggleCoupon = async (coupon: Coupon) => {
    setUpdatingCouponId(coupon.id);
    try {
      await adminService.updateCoupon(coupon.id, { isActive: !coupon.isActive });
      await adminService.logAction({
        action: 'coupon_status_updated',
        targetType: 'coupon',
        targetId: coupon.id,
        metadata: { isActive: !coupon.isActive, code: coupon.code },
      });
      await onRefresh();
    } catch (error) {
      console.error(error);
      alert('Não foi possível atualizar o cupom.');
    } finally {
      setUpdatingCouponId(null);
    }
  };

  const handleExportReport = () => {
    const topEvent = eventReports[0];
    const topPhotographer = photographerReports[0];
    const avgTicket = periodMetrics.paidOrders > 0 ? periodMetrics.grossRevenue / periodMetrics.paidOrders : 0;
    const conversion = periodMetrics.totalOrders === 0 ? 0 : (periodMetrics.paidOrders / periodMetrics.totalOrders) * 100;
    const generatedAt = new Date().toLocaleString('pt-BR');
    const eventChart = buildReportBarChart(
      'Receita por evento',
      eventReports.map((report) => ({
        label: report.event,
        value: report.revenue,
        meta: `${report.ordersCount === 1 ? '1 pedido' : `${report.ordersCount} pedidos`} - ${report.items === 1 ? '1 item' : `${report.items} itens`}`,
      })),
    );
    const photographerChart = buildReportBarChart(
      'Receita por fotógrafo',
      photographerReports.map((report) => ({
        label: report.name,
        value: report.revenue,
        meta: `${report.ordersCount === 1 ? '1 pedido' : `${report.ordersCount} pedidos`} - ${report.items === 1 ? '1 item' : `${report.items} itens`}`,
      })),
    );

    const orderRows = periodOrders.slice(0, 60).map((order) => `
      <tr>
        <td>#${htmlEscape(order.id.slice(0, 8))}</td>
        <td>${htmlEscape(order.status)}</td>
        <td>${htmlEscape(order.buyerName)}</td>
        <td>${htmlEscape(formatCurrency(Number(order.total || 0)))}</td>
        <td>${htmlEscape(new Date(order.createdAt).toLocaleDateString('pt-BR'))}</td>
        <td>${htmlEscape(order.items?.length ?? 0)}</td>
      </tr>
    `).join('');
    const productRows = periodProducts.slice(0, 60).map((product) => `
      <tr>
        <td>${htmlEscape(product.name)}</td>
        <td>${htmlEscape(product.type)}</td>
        <td>${htmlEscape(product.status ?? 'published')}</td>
        <td>${htmlEscape(formatCurrency(Number(product.price || 0)))}</td>
        <td>${htmlEscape(product.event || 'Geral')}</td>
        <td>${htmlEscape(new Date(product.createdAt || '').toLocaleDateString('pt-BR'))}</td>
      </tr>
    `).join('');

    const reportHtml = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Relatorio FunPace Admin</title>
        <style>
          @page { margin: 22mm 18mm; }
          body { margin: 0; color: #0f172a; font-family: Arial, Helvetica, sans-serif; background: #ffffff; }
          .cover { padding: 42px; background: #080d14; color: #ffffff; border-radius: 18px; }
          .brand { color: #ff4e00; font-size: 13px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; }
          h1 { margin: 12px 0 10px; font-size: 38px; line-height: 1.05; }
          h2 { margin: 34px 0 14px; font-size: 22px; }
          h3 { margin: 0 0 8px; font-size: 14px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; }
          .muted { color: #64748b; font-size: 12px; line-height: 1.5; }
          .cover .muted { color: #cbd5e1; }
          .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 22px; }
          .card { border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px; background: #f8fafc; }
          .card strong { display: block; font-size: 22px; margin-top: 8px; }
          .insights { border-left: 4px solid #ff4e00; padding: 12px 16px; background: #fff7ed; border-radius: 10px; }
          .chart { margin: 16px 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
          th { text-align: left; background: #0f172a; color: #ffffff; padding: 9px; }
          td { border-bottom: 1px solid #e2e8f0; padding: 8px; vertical-align: top; }
          .section { page-break-inside: avoid; margin-top: 28px; }
          .footer { margin-top: 34px; padding-top: 12px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 11px; }
        </style>
      </head>
      <body>
        <div class="cover">
          <div class="brand">FunPace Media</div>
          <h1>Relatorio Administrativo</h1>
          <p class="muted">Período analisado: ${htmlEscape(periodLabel)}<br/>Gerado em ${htmlEscape(generatedAt)}</p>
        </div>

        <div class="grid">
          <div class="card"><h3>GMV</h3><strong>${htmlEscape(formatCurrency(periodMetrics.grossRevenue))}</strong><p class="muted">Volume bruto pago</p></div>
          <div class="card"><h3>Fees</h3><strong>${htmlEscape(formatCurrency(periodMetrics.platformFee))}</strong><p class="muted">Taxa configurada: ${htmlEscape(platformFeePercentLabel)}%</p></div>
          <div class="card"><h3>Pedidos</h3><strong>${htmlEscape(formatReportNumber(periodMetrics.totalOrders))}</strong><p class="muted">${htmlEscape(formatReportPercent(conversion))} conversao paga</p></div>
          <div class="card"><h3>Ticket medio</h3><strong>${htmlEscape(formatCurrency(avgTicket))}</strong><p class="muted">Pedidos pagos</p></div>
        </div>

        <div class="section insights">
          <h2>Leitura executiva</h2>
          <p>
            O periodo registrou <strong>${htmlEscape(formatReportNumber(periodMetrics.paidOrders))}</strong> pedido(s) pago(s),
            <strong>${htmlEscape(formatReportNumber(periodMetrics.pendingOrders))}</strong> pendente(s) e
            <strong>${htmlEscape(formatReportNumber(periodMetrics.totalProducts))}</strong> produto(s) publicado(s)/criado(s) no intervalo.
            ${topEvent ? `O evento com maior receita foi <strong>${htmlEscape(topEvent.event)}</strong>, com ${htmlEscape(formatCurrency(topEvent.revenue))}.` : 'Não houve receita por evento no período.'}
            ${topPhotographer ? `O fotógrafo com maior receita foi <strong>${htmlEscape(topPhotographer.name)}</strong>, com ${htmlEscape(formatCurrency(topPhotographer.revenue))}.` : ''}
          </p>
        </div>

        <div class="section chart">${eventChart}</div>
        <div class="section chart">${photographerChart}</div>

        <div class="section">
          <h2>Pedidos do periodo</h2>
          <p class="muted">Amostra com até 60 registros mais recentes do período.</p>
          <table>
            <thead><tr><th>ID</th><th>Status</th><th>Comprador</th><th>Total</th><th>Data</th><th>Itens</th></tr></thead>
            <tbody>${orderRows || '<tr><td colspan="6">Sem pedidos no periodo.</td></tr>'}</tbody>
          </table>
        </div>

        <div class="section">
          <h2>Produtos do periodo</h2>
          <table>
            <thead><tr><th>Nome</th><th>Tipo</th><th>Status</th><th>Preço</th><th>Evento</th><th>Data</th></tr></thead>
            <tbody>${productRows || '<tr><td colspan="6">Sem produtos no periodo.</td></tr>'}</tbody>
          </table>
        </div>

        <div class="footer">
          Relatorio gerado automaticamente pelo Painel Administrativo FunPace. Dados sujeitos ao periodo e filtros carregados no painel.
        </div>
      </body>
      </html>
    `;

    const fileName = `funpace-relatorio-admin-${formatExportDate(periodRange.start)}-${formatExportDate(periodRange.end)}.doc`;
    downloadTextFile(fileName, `\uFEFF${reportHtml}`, 'application/msword;charset=utf-8');
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#080d14] font-sans text-white">
      {/* Sidebar */}
      <aside className="w-full md:w-72 bg-[#05080d] text-white border-r border-white/10 flex flex-col shadow-[20px_0_60px_rgba(0,0,0,0.35)]">
        <div className="p-6 border-b border-white/10 flex items-center gap-3">
          <div className="bg-brutal-accent p-2 brutal-border-thin border-brutal-accent shadow-[0_0_24px_rgba(255,78,0,0.35)]">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-display text-2xl tracking-normal">ADMIN</h1>
            <p className="font-mono text-[10px] text-brutal-accent uppercase tracking-widest">Control Center</p>
          </div>
        </div>

        <nav className="flex-1 p-5 space-y-3">
          <AdminSidebarLink
            icon={<BarChart3 />}
            label="Visão Geral"
            active={activeTab === 'overview'}
            onClick={() => setActiveTab('overview')}
          />
          <AdminSidebarLink
            icon={<UserIcon />}
            label="Usuários"
            active={activeTab === 'users'}
            onClick={() => setActiveTab('users')}
          />
          <AdminSidebarLink
            icon={<Users />}
            label="Fotógrafos"
            active={activeTab === 'photographers'}
            onClick={() => setActiveTab('photographers')}
          />
          <AdminSidebarLink
            icon={<CalendarDays />}
            label="Eventos"
            active={activeTab === 'events'}
            onClick={() => setActiveTab('events')}
          />
          <AdminSidebarLink
            icon={<Camera />}
            label="Fotos"
            active={activeTab === 'media'}
            onClick={() => setActiveTab('media')}
          />
          <AdminSidebarLink
            icon={<ReceiptText />}
            label="Pedidos"
            active={activeTab === 'orders'}
            onClick={() => setActiveTab('orders')}
          />
          <AdminSidebarLink
            icon={<CreditCard />}
            label="Pagamentos"
            active={activeTab === 'payments'}
            onClick={() => setActiveTab('payments')}
          />
          <AdminSidebarLink
            icon={<DollarSign />}
            label="Financeiro"
            active={activeTab === 'sales'}
            onClick={() => setActiveTab('sales')}
          />
          <AdminSidebarLink
            icon={<LinkIcon />}
            label="Indicações"
            active={activeTab === 'referrals'}
            onClick={() => setActiveTab('referrals')}
          />
          <AdminSidebarLink
            icon={<TicketPercent />}
            label="Cupons"
            active={activeTab === 'coupons'}
            onClick={() => setActiveTab('coupons')}
          />
          <AdminSidebarLink
            icon={<Activity />}
            label="Logs"
            active={activeTab === 'logs'}
            onClick={() => setActiveTab('logs')}
          />
          <AdminSidebarLink
            icon={<Settings />}
            label="Configurações"
            active={activeTab === 'settings'}
            onClick={() => setActiveTab('settings')}
          />
        </nav>

        <div className="p-5 border-t border-white/10 space-y-4">
          <div className="bg-white/5 border border-white/10 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center font-display">A</div>
            <div className="min-w-0">
              <p className="font-mono text-xs uppercase truncate">Administrador</p>
              <p className="font-mono text-[10px] text-gray-500 truncate">admin@funpace.media</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-3 py-4 bg-transparent border border-white/10 font-mono text-xs uppercase font-bold hover:bg-red-500 hover:border-red-500 transition-all cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sair do Admin
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-5 md:p-8 overflow-y-auto">
        <header className="mb-8 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">
          <div>
            <h2 className="font-sans font-black text-3xl md:text-4xl tracking-normal normal-case mb-2">
              {activeTab === 'overview' && 'Painel Administrativo'}
              {activeTab === 'users' && 'Gestão de Usuários'}
              {activeTab === 'photographers' && 'Gestão de Fotógrafos'}
              {activeTab === 'events' && 'Eventos'}
              {activeTab === 'media' && 'Mídias Globais'}
              {activeTab === 'orders' && 'Pedidos'}
              {activeTab === 'payments' && 'Pagamentos'}
              {activeTab === 'sales' && 'Fluxo de Caixa'}
              {activeTab === 'referrals' && 'Indicações de Fotógrafos'}
              {activeTab === 'coupons' && 'Cupons e Promoções'}
              {activeTab === 'logs' && 'Logs e Auditoria'}
              {activeTab === 'settings' && 'Preferências'}
            </h2>
            <div className="flex items-center gap-2 font-mono text-sm text-gray-500">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Sistema Online • Versão 2.4.0
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full xl:w-auto">
            <div className="h-12 px-4 bg-[#0d131c] border border-white/15 flex items-center justify-between sm:justify-start gap-4 min-w-0 sm:min-w-70">
              <div className="flex items-center gap-3 min-w-0">
                <CalendarDays className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="font-sans text-sm text-gray-200 truncate">{periodLabel}</span>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
            </div>
            <div className="h-12 px-4 bg-[#0d131c] border border-white/15 flex items-center gap-4">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowNotifications((current) => !current)}
                  className="relative h-9 w-9 flex items-center justify-center border border-transparent hover:border-white/15 hover:bg-white/5 transition-colors cursor-pointer"
                  aria-label="Abrir notificacoes"
                >
                  <Bell className="w-5 h-5 text-gray-300" />
                  {adminNotifications.length > 0 && (
                    <span className="absolute -right-2 -top-2 h-5 min-w-5 px-1 rounded-full bg-brutal-accent text-white font-sans text-[10px] font-black flex items-center justify-center">
                      {adminNotifications.length > 9 ? '9+' : adminNotifications.length}
                    </span>
                  )}
                </button>
                {showNotifications && (
                  <div className="absolute right-0 top-12 z-50 w-[320px] max-w-[calc(100vw-2rem)] bg-[#0d131c] border border-white/15 shadow-2xl">
                    <div className="p-4 border-b border-white/10">
                      <p className="font-sans font-black text-sm uppercase text-white">Notificações</p>
                      <p className="font-mono text-[10px] uppercase text-gray-500">
                        {adminNotifications.length === 1 ? '1 item requer atenção' : `${adminNotifications.length} itens requerem atenção`}
                      </p>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {adminNotifications.length === 0 ? (
                        <div className="p-5 text-center">
                          <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-3" />
                          <p className="font-mono text-[10px] uppercase text-gray-400">Nenhuma pendencia no momento.</p>
                        </div>
                      ) : adminNotifications.map((notification) => (
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
              <div className="h-7 w-px bg-white/10" />
              <div>
                <p className="font-mono text-[9px] text-gray-500 uppercase tracking-widest">Uptime</p>
                <p className="font-sans text-sm font-black text-white">99.9%</p>
              </div>
              <TrendingUp className="w-5 h-5 text-green-400" />
            </div>
            <button
              type="button"
              onClick={handleExportReport}
              className="h-12 px-5 bg-brutal-accent text-white border border-brutal-accent font-sans text-xs font-black uppercase tracking-wide flex items-center justify-center gap-2 hover:bg-white hover:text-brutal-accent transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Exportar relatorio Word
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-5"
            >
              <div className="bg-[#0d131c] border border-white/10 p-4 flex flex-wrap items-center gap-3">
                <span className="font-mono text-[10px] uppercase tracking-widest text-gray-400 mr-2">Periodo</span>
                {ADMIN_PERIOD_OPTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedPeriod(key)}
                    className={`h-10 px-4 border font-mono text-xs uppercase transition-colors ${selectedPeriod === key
                      ? 'bg-brutal-accent/20 border-brutal-accent text-white'
                      : 'bg-[#080d14] border-white/10 text-gray-300 hover:border-white/30'
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

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
                <AdminStatCardReal
                  label="GMV (Volume Bruto)"
                  value={`R$ ${periodMetrics.grossRevenue.toFixed(2)}`}
                  icon={<DollarSign />}
                  sub="Acumulado no periodo"
                  trend={adminStatTrends.grossRevenue}
                  previousValue={previousPeriodMetrics.grossRevenue}
                  bars={adminStatSparklines.grossRevenue}
                  accent
                />
                <AdminStatCardReal
                  label="Receita Líquida (Fees)"
                  value={`R$ ${periodMetrics.platformFee.toFixed(2)}`}
                  icon={<TrendingUp />}
                  sub={`Margem de ${platformFeePercentLabel}%`}
                  trend={adminStatTrends.platformFee}
                  previousValue={previousPeriodMetrics.platformFee}
                  bars={adminStatSparklines.platformFee}
                />
                <AdminStatCardReal
                  label="Total Fotógrafos"
                  value={activePhotographers.length}
                  icon={<Users />}
                  sub={`${pendingPhotographers.length} pendentes no total`}
                  trend={adminStatTrends.photographers}
                  previousValue={activePhotographers.length}
                  bars={adminStatSparklines.photographers}
                />
                <AdminStatCardReal
                  label="Total Vídeos"
                  value={metrics.videoCount}
                  icon={<Camera />}
                  sub="Replays em 4k"
                  trend={adminStatTrends.videos}
                  previousValue={metrics.videoCount}
                  bars={adminStatSparklines.videos}
                />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_1fr_0.95fr] gap-5">
                <div className="bg-[#0d131c] p-6 border border-white/10">
                  <h3 className="font-sans font-black text-base mb-6 uppercase flex items-center justify-between">
                    Atividade Recente
                    {recentActivity.length > 6 && (
                      <button
                        type="button"
                        onClick={() => setShowAllRecentActivity((current) => !current)}
                        className="font-mono text-[10px] text-gray-500 uppercase font-normal hover:text-white transition-colors cursor-pointer"
                      >
                        {showAllRecentActivity ? 'Ver menos' : 'Ver todas'}
                      </button>
                    )}
                  </h3>
                  <div className="space-y-6">
                    {visibleRecentActivity.length === 0 ? (
                      <div className="p-6 bg-white/5 border border-white/10 text-center">
                        <p className="font-mono text-[10px] text-gray-400 uppercase">Nenhuma atividade recente encontrada.</p>
                      </div>
                    ) : (
                      visibleRecentActivity.map((activity) => (
                        <div key={activity.id} className="flex items-center gap-4 pb-5 border-b border-white/10 last:border-0 last:pb-0">
                          <div className={`p-3 border rounded-md ${activity.kind === 'product' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
                            : activity.kind === 'photographer' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                              : 'bg-green-500/10 border-green-500/20 text-green-400'
                            }`}>
                            {activity.kind === 'product'
                              ? <Camera className="w-5 h-5" />
                              : activity.kind === 'photographer'
                                ? <Users className="w-5 h-5" />
                                : <DollarSign className="w-5 h-5" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-sans font-bold text-sm truncate text-white">{activity.title}</p>
                            <p className="font-mono text-[10px] text-gray-400 uppercase">{activity.meta}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="bg-[#0d131c] p-6 border border-white/10 space-y-6">
                  <h3 className="font-sans font-black text-base uppercase">Manutenção de mídias</h3>
                  <div className="bg-[#080d14] border border-dashed border-white/20 p-5 flex flex-col md:items-center justify-between gap-4 text-center">
                    <div>
                      <p className="font-sans font-bold text-lg uppercase">
                        {productsMissingThumbnails.length > 0 ? 'Previews pendentes' : 'Previews em dia'}
                      </p>
                      <p className="font-mono text-[10px] uppercase text-gray-500 mt-1">
                        {productsMissingThumbnails.length > 0
                          ? `${productsMissingThumbnails.length === 1 ? '1 produto ativo' : `${productsMissingThumbnails.length} produtos ativos`} sem thumbnail dedicado.`
                          : 'Todos os produtos ativos já possuem thumbnail ou não precisam de reparo.'}
                      </p>
                      {thumbnailBackfillProgress && (
                        <p className="font-mono text-[10px] uppercase text-brutal-accent mt-2">
                          Processando {thumbnailBackfillProgress}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={handleBackfillThumbnails}
                      disabled={isBackfillingThumbnails || productsMissingThumbnails.length === 0}
                      className="h-12 px-5 bg-transparent text-brutal-accent border border-brutal-accent font-display text-sm uppercase tracking-widest hover:bg-brutal-accent hover:text-white transition-colors cursor-pointer disabled:border-gray-700 disabled:text-gray-600 disabled:cursor-not-allowed"
                    >
                      {isBackfillingThumbnails ? 'Gerando...' : 'Gerar Previews'}
                    </button>
                  </div>
                  <p className="font-mono text-[10px] uppercase leading-relaxed text-gray-400">
                    Repara produtos antigos sem preview. Baixa a mídia, gera thumbnail e salva no bucket. Processa até 25 itens por vez.
                  </p>
                </div>

                <div className="bg-[#0d131c] text-white p-6 border border-white/10">
                  <h3 className="font-display text-2xl mb-6 uppercase">Saúde da Plataforma</h3>
                  <div className="space-y-8">
                    <div className="space-y-2">
                      <div className="flex justify-between font-mono text-[10px] uppercase">
                        <span>Ocupação do Storage</span>
                        <span>{storageStats ? `${storageUsagePercent}%` : '--'}</span>
                      </div>
                      <div className="h-3 bg-white/10 overflow-hidden rounded-full">
                        <div className="h-full bg-brutal-accent" style={{ width: `${storageUsagePercent}%` }} />
                      </div>
                      <p className="font-mono text-[9px] uppercase text-gray-500">
                        {storageStats
                          ? `${formatBytes(storageStats.usedBytes)} usados de ${formatBytes(storageStats.quotaBytes)} - ${storageStats.totalFiles} arquivo(s)`
                          : storageStatsError || 'Consultando bucket...'}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between font-mono text-[10px] uppercase">
                        <span>Conversão de Vendas</span>
                        <span>{paidConversionPercent}%</span>
                      </div>
                      <div className="h-3 bg-white/10 overflow-hidden rounded-full">
                        <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, paidConversionPercent)}%` }} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 pt-4">
                      <div className="p-4 bg-white/5 border border-white/10 text-center text-brutal-accent">
                        <p className="font-display text-3xl">{storageStats?.totalFiles ?? periodMetrics.totalProducts}</p>
                        <p className="font-mono text-[8px] uppercase">Arquivos</p>
                      </div>
                      <div className="p-4 bg-white/5 border border-white/10 text-center text-green-500">
                        <p className="font-display text-3xl">{periodMetrics.totalOrders}</p>
                        <p className="font-mono text-[8px] uppercase">Pedidos</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <ReportCard
                  title="Receita por Evento"
                  emptyLabel="Nenhuma venda paga por evento."
                  rows={eventReports.map((report) => ({
                    id: report.event,
                    title: report.event,
                    subtitle: `${report.ordersCount} pedidos - ${report.items} itens`,
                    value: `R$ ${report.revenue.toFixed(2)}`,
                  }))}
                />
                <ReportCard
                  title="Receita por Fotógrafo"
                  emptyLabel="Nenhuma venda paga por fotógrafo."
                  rows={photographerReports.map((report) => ({
                    id: report.photographerId,
                    title: report.name,
                    subtitle: `${report.ordersCount} pedidos - ${report.items} itens`,
                    value: `R$ ${report.revenue.toFixed(2)}`,
                  }))}
                />
                <ReportCard
                  title="Fotos mais vendidas"
                  emptyLabel="Nenhuma foto vendida no periodo."
                  rows={topPhotoReports.map((report, index) => ({
                    id: report.productId,
                    title: `#${index + 1} ${report.name}`,
                    subtitle: `${report.items} venda(s) - ${report.ordersCount} pedido(s) - peito ${report.bib || 'N/I'} - ${report.event}`,
                    value: `R$ ${report.revenue.toFixed(2)}`,
                  }))}
                />
              </div>
            </motion.div>
          )}

          {activeTab === 'users' && (
            <motion.div key="users" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase text-gray-500 mb-2">Clientes</p>
                  <p className="font-sans font-black text-3xl">{customerRows.length}</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase text-gray-500 mb-2">Compradores pagantes</p>
                  <p className="font-sans font-black text-3xl text-green-400">{customerRows.filter((row) => row.paidOrders > 0).length}</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase text-gray-500 mb-2">Receita clientes</p>
                  <p className="font-sans font-black text-3xl text-brutal-accent">{formatCurrency(customerRows.reduce((sum, row) => sum + row.spent, 0))}</p>
                </div>
              </div>
              <div className="bg-[#0d131c] border border-white/10">
                <div className="p-5 border-b border-white/10 flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
                  <div>
                    <h3 className="font-sans font-black text-base uppercase">Usuários e clientes</h3>
                    <p className="font-mono text-[10px] uppercase text-gray-500">Compras, gasto total e origem do cadastro</p>
                  </div>
                  <div className="relative w-full md:w-80">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Buscar usuário" className="w-full h-11 pl-10 pr-3 bg-[#080d14] border border-white/15 text-white font-mono text-xs outline-none focus:border-brutal-accent" />
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-[#05080d] text-gray-500 font-mono text-[10px] uppercase">
                      <tr><th className="px-5 py-3">Nome</th><th className="px-5 py-3">E-mail</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Compras</th><th className="px-5 py-3">Total gasto</th><th className="px-5 py-3">Cadastro</th></tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {filteredUsers.slice(0, visibleAdminRows.users).map((row) => (
                        <tr key={row.id} className="hover:bg-white/3">
                          <td className="px-5 py-4 font-sans font-bold text-white">{row.name}</td>
                          <td className="px-5 py-4 font-mono text-xs text-gray-400">{row.email}</td>
                          <td className="px-5 py-4"><span className="px-2 py-1 border border-white/10 bg-white/5 font-mono text-[10px] uppercase">customer</span></td>
                          <td className="px-5 py-4 font-mono text-xs">{row.paidOrders}/{row.orders}</td>
                          <td className="px-5 py-4 font-sans font-black text-green-400">{formatCurrency(row.spent)}</td>
                          <td className="px-5 py-4 font-mono text-[10px] text-gray-500">{row.createdAt ? new Date(row.createdAt).toLocaleDateString('pt-BR') : 'N/I'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <AdminLoadMoreButton
                  visible={visibleAdminRows.users}
                  total={filteredUsers.length}
                  onClick={() => showMoreAdminRows('users')}
                />
              </div>
            </motion.div>
          )}

          {activeTab === 'photographers' && (
            <motion.div
              key="photographers"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-5"
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Credenciados</p>
                  <p className="font-sans font-black text-3xl text-white">{photographers.length}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">{activePhotographers.length} ativos</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Pendentes</p>
                  <p className="font-sans font-black text-3xl text-yellow-400">{pendingPhotographers.length}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">Aguardando aprovacao</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Desativados</p>
                  <p className="font-sans font-black text-3xl text-red-300">{disabledPhotographers.length}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">Sem acesso ao painel</p>
                </div>
              </div>

              <div className="bg-[#0d131c] border border-white/10 p-4 flex flex-col xl:flex-row gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
                  <input
                    type="text"
                    value={photographerSearch}
                    onChange={(event) => setPhotographerSearch(event.target.value)}
                    placeholder="Buscar por nome, email, Instagram, CPF, telefone ou ID"
                    className="w-full h-12 pl-12 pr-4 bg-[#080d14] border border-white/15 text-white font-mono text-xs outline-none focus:border-brutal-accent transition-colors"
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="h-12 bg-[#080d14] border border-white/15 flex items-center">
                    {[
                      ['all', 'Todos'],
                      ['active', 'Ativos'],
                      ['pending', 'Pendentes'],
                      ['disabled', 'Desativados'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setPhotographerStatusFilter(value as PhotographerStatusFilter)}
                        className={`h-full px-4 font-mono text-[10px] uppercase tracking-widest border-r border-white/10 last:border-r-0 transition-colors ${photographerStatusFilter === value
                          ? 'bg-brutal-accent text-white'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                          }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="h-12 px-5 bg-brutal-accent text-white border border-brutal-accent flex items-center justify-center gap-2 font-sans text-xs font-black uppercase tracking-wide hover:bg-white hover:text-brutal-accent transition-colors cursor-pointer"
                  >
                    <Plus className="w-5 h-5" />
                    Novo Fotógrafo
                  </button>
                </div>
              </div>

              {photographerFeedback && (
                <div className={`border px-4 py-3 flex items-center justify-between gap-3 ${photographerFeedback.type === 'success'
                  ? 'bg-green-500/10 border-green-500/25 text-green-200'
                  : 'bg-red-500/10 border-red-500/25 text-red-200'
                  }`}>
                  <div className="flex items-center gap-3">
                    {photographerFeedback.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                    <p className="font-mono text-[10px] uppercase tracking-widest">{photographerFeedback.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPhotographerFeedback(null)}
                    className="p-1 text-current opacity-70 hover:opacity-100"
                    aria-label="Fechar aviso"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div className="bg-[#0d131c] border border-white/10 overflow-visible relative">
                <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-sans font-black text-base uppercase text-white">Fotógrafos</h3>
                    <p className="font-mono text-[10px] uppercase text-gray-500">{filteredPhotographers.length} resultado(s)</p>
                  </div>
                  {(photographerSearch || photographerStatusFilter !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setPhotographerSearch('');
                        setPhotographerStatusFilter('all');
                      }}
                      className="font-mono text-[10px] uppercase tracking-widest text-brutal-accent hover:text-white transition-colors"
                    >
                      Limpar filtros
                    </button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-245 text-left font-mono text-xs">
                    <thead className="bg-[#05080d] text-gray-400 uppercase text-[10px] tracking-widest">
                      <tr>
                        <th className="p-6">Fotógrafo</th>
                        <th className="p-6">Status</th>
                        <th className="p-6 text-center">Mídias</th>
                        <th className="p-6 text-center">Receita Gerada</th>
                        <th className="p-6 text-center">Score</th>
                        <th className="p-6"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {filteredPhotographers.slice(0, visibleAdminRows.photographers).map((p) => {
                        const photographerStatus = getPhotographerStatus(p);
                        const statusBadge = photographerStatus === 'disabled'
                          ? {
                              label: 'Desativado',
                              className: 'bg-red-500/10 text-red-300 border-red-500/25',
                              dotClassName: 'bg-red-300',
                              icon: <XCircle className="w-3.5 h-3.5" />,
                            }
                          : photographerStatus === 'pending'
                            ? {
                                label: 'Pendente',
                                className: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/25',
                                dotClassName: 'bg-yellow-300',
                                icon: <Clock className="w-3.5 h-3.5" />,
                              }
                            : {
                                label: 'Ativo',
                                className: 'bg-green-500/10 text-green-300 border-green-500/25',
                                dotClassName: 'bg-green-300',
                                icon: <CheckCircle2 className="w-3.5 h-3.5" />,
                              };
                        const isActing = actingPhotographerId === p.id;

                        return (
                        <tr key={p.id} className="hover:bg-white/3 transition-colors">
                          <td className="p-6">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 bg-white/10 border border-white/15 overflow-hidden flex items-center justify-center shrink-0">
                                {p.avatar ? (
                                  <img src={p.avatar} alt={p.name} className="w-full h-full object-cover grayscale" />
                                ) : (
                                  <span className="font-sans font-black text-sm text-white">{p.name.slice(0, 2).toUpperCase()}</span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="font-sans font-black text-sm uppercase text-white truncate max-w-70">{p.name || 'Sem nome'}</p>
                                <p className="text-[10px] text-gray-400 lowercase truncate max-w-70">{p.email}</p>
                                <p className={`text-[10px] lowercase truncate max-w-70 ${p.instagram ? 'text-brutal-accent' : 'text-gray-600'}`}>
                                  {p.instagram || 'Instagram não informado'}
                                </p>
                                <p className="text-[9px] text-gray-600 uppercase truncate max-w-70">ID {p.id}</p>
                              </div>
                            </div>
                          </td>
                          <td className="p-6">
                            <span className={`inline-flex items-center gap-2 border px-3 py-1 text-[10px] font-bold uppercase ${statusBadge.className}`}>
                              {statusBadge.icon}
                              <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dotClassName}`} />
                              {statusBadge.label}
                            </span>
                          </td>
                          <td className="p-6 text-center text-white font-sans font-black">{p.stats?.photos || 0}</td>
                          <td className="p-6 text-center text-white font-sans font-black">{formatCurrency(Number(p.stats?.totalEarnings || 0))}</td>
                          <td className="p-6 text-center">
                            <div className="flex items-center justify-center gap-1 text-gray-200">
                              <CheckCircle2 className="w-4 h-4 text-brutal-accent" />
                              {p.stats?.rating || 5.0}
                            </div>
                          </td>
                          <td className="p-6 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {photographerStatus === 'pending' && (
                                <button
                                  onClick={() => handleVerifyPhotographer(p.id)}
                                  className="h-9 px-3 bg-green-500 text-white border border-green-500 text-[10px] font-bold uppercase hover:bg-green-400 transition-colors cursor-pointer"
                                >
                                  Aprovar
                                </button>
                              )}
                              <div className="relative" data-photographer-menu>
                                <button
                                  type="button"
                                  onClick={() => setOpenMenuPhotographerId((current) => (current === p.id ? null : p.id))}
                                  className="p-2 border border-white/10 text-gray-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                                  aria-label="Opções do fotógrafo"
                                >
                                  <MoreVertical className="w-5 h-5" />
                                </button>

                                <AnimatePresence>
                                  {openMenuPhotographerId === p.id && (
                                    <motion.div
                                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                                      animate={{ opacity: 1, y: 0, scale: 1 }}
                                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                                      className="absolute right-0 mt-2 w-56 bg-[#05080d] border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.45)] z-200 overflow-hidden"
                                    >
                                      <button
                                        type="button"
                                        onClick={() => openEditPhotographer(p)}
                                        className="w-full px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-gray-200 hover:bg-white/10 hover:text-white cursor-pointer flex items-center gap-3"
                                      >
                                        <Pencil className="w-4 h-4 text-gray-400" />
                                        Editar Perfil
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openPhotographerPublicProfile(p)}
                                        className="w-full px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-gray-300 hover:bg-white/10 hover:text-white cursor-pointer flex items-center gap-3"
                                      >
                                        <Eye className="w-4 h-4 text-gray-400" />
                                        Ver Perfil Publico
                                      </button>
                                      <button
                                        type="button"
                                        onClick={openPhotographerEvents}
                                        className="w-full px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-gray-300 hover:bg-white/10 hover:text-white cursor-pointer flex items-center gap-3"
                                      >
                                        <FolderOpen className="w-4 h-4 text-gray-400" />
                                        Ver Eventos
                                      </button>
                                      <div className="my-1 border-t border-white/10" />
                                      {photographerStatus === 'disabled' ? (
                                        <button
                                          type="button"
                                          disabled={isUpdatingPhotographer || isActing}
                                          onClick={() => openPhotographerActionDialog('reactivate', p)}
                                          className="w-full px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-green-300 hover:bg-green-500/10 disabled:text-gray-500 cursor-pointer flex items-center gap-3"
                                        >
                                          <RefreshCw className="w-4 h-4" />
                                          Reativar Fotógrafo
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          disabled={isUpdatingPhotographer || isActing}
                                          onClick={() => openPhotographerActionDialog('disable', p)}
                                          className="w-full px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-yellow-200 hover:bg-yellow-500/10 disabled:text-gray-500 cursor-pointer flex items-center gap-3"
                                        >
                                          <PauseCircle className="w-4 h-4" />
                                          Desativar Fotógrafo
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        disabled={isUpdatingPhotographer || isActing}
                                        onClick={() => openPhotographerActionDialog('delete', p)}
                                        className="w-full px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-red-300 hover:bg-red-500/10 disabled:text-gray-500 cursor-pointer flex items-center gap-3"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                        Excluir Fotógrafo
                                      </button>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                      {filteredPhotographers.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-5 py-14 text-center">
                            <Users className="w-10 h-10 text-gray-600 mx-auto mb-4" />
                            <p className="font-sans font-black text-sm uppercase text-white">Nenhum fotógrafo encontrado</p>
                            <p className="font-mono text-[10px] uppercase text-gray-500 mt-2">Ajuste a busca ou limpe os filtros.</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <AdminLoadMoreButton
                  visible={visibleAdminRows.photographers}
                  total={filteredPhotographers.length}
                  onClick={() => showMoreAdminRows('photographers')}
                />
              </div>
            </motion.div>
          )}

          {activeTab === 'events' && (
            <motion.div
              key="events"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-5"
            >
              <div className="bg-[#0d131c] border border-white/10 p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-brutal-accent mb-2">Gestao de eventos</p>
                  <h3 className="font-sans font-black text-xl uppercase text-white">Cadastro e edição</h3>
                  <p className="font-mono text-[10px] uppercase text-gray-500 mt-1">Crie eventos oficiais ou edite dados de eventos ja cadastrados.</p>
                </div>
                <button
                  type="button"
                  onClick={openCreateEvent}
                  className="h-12 px-5 bg-brutal-accent text-white border border-brutal-accent font-sans text-xs font-black uppercase tracking-wide hover:bg-white hover:text-brutal-accent transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Criar Evento
                </button>
              </div>

              <div className="bg-[#0d131c] border border-white/10">
                <div className="p-5 border-b border-white/10 flex items-center justify-between">
                  <div>
                    <h3 className="font-sans font-black text-base uppercase text-white">Eventos cadastrados</h3>
                    <p className="font-mono text-[10px] uppercase text-gray-500">
                      {adminEventRows.length === 1 ? '1 evento' : `${adminEventRows.length} eventos`} - {events.length === 1 ? '1 cadastrado' : `${events.length} cadastrados`}, {mediaEvents.length === 1 ? '1 vindo das mídias' : `${mediaEvents.length} vindos das mídias`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={loadEvents}
                    className="h-10 px-4 border border-white/15 font-mono text-[10px] uppercase text-gray-300 hover:text-white hover:border-white/30"
                  >
                    Atualizar
                  </button>
                </div>
                <div className="divide-y divide-white/10">
                  {isLoadingEvents ? (
                    <div className="p-8 text-center font-mono text-xs uppercase text-gray-500">Carregando eventos...</div>
                  ) : adminEventRows.length === 0 ? (
                    <div className="p-8 text-center font-mono text-xs uppercase text-gray-500">Nenhum evento cadastrado.</div>
                  ) : adminEventRows.map((eventItem) => (
                    <div key={eventItem.id} className="p-5 grid gap-3 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                      <div className="min-w-0">
                        <p className="font-sans font-black text-lg uppercase text-white truncate">{eventItem.name}</p>
                        <p className="font-mono text-[10px] uppercase text-gray-500 truncate">
                          {eventItem.location || 'Local não informado'} - {eventItem.checkpoint || 'Ponto padrão'}
                        </p>
                        {eventItem.mediaLabel && (
                          <p className="font-mono text-[10px] uppercase text-gray-600 mt-1">{eventItem.mediaLabel}</p>
                        )}
                      </div>
                      <span className="font-mono text-xs uppercase text-gray-300">
                        {new Date(`${eventItem.date}T00:00:00`).toLocaleDateString('pt-BR')}
                      </span>
                      <span className="w-fit px-2 py-1 border border-white/10 bg-white/5 font-mono text-[10px] uppercase text-brutal-accent">
                        {eventItem.source} - {eventItem.status}
                      </span>
                      {eventItem.canEdit ? (
                        <button
                          type="button"
                          onClick={() => openEditEvent(eventItem)}
                          className="h-8 px-3 border border-white/15 font-mono text-[10px] uppercase text-gray-300 hover:text-white hover:border-brutal-accent inline-flex items-center justify-center gap-2"
                        >
                          <Pencil className="w-3 h-3" />
                          Editar
                        </button>
                      ) : (
                        <span className="hidden md:block w-20" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'media' && (
            <motion.div key="media" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
                <div className="bg-[#0d131c] border border-white/10 p-5"><p className="font-mono text-[10px] uppercase text-gray-500 mb-2">Mídias</p><p className="font-sans font-black text-3xl">{allMedia.length}</p></div>
                <div className="bg-[#0d131c] border border-white/10 p-5"><p className="font-mono text-[10px] uppercase text-gray-500 mb-2">Publicadas</p><p className="font-sans font-black text-3xl text-green-400">{allMedia.filter((item) => (item.status ?? 'published') === 'published').length}</p></div>
                <div className="bg-[#0d131c] border border-white/10 p-5"><p className="font-mono text-[10px] uppercase text-gray-500 mb-2">Ocultas</p><p className="font-sans font-black text-3xl text-yellow-400">{allMedia.filter((item) => item.status === 'hidden').length}</p></div>
                <div className="bg-[#0d131c] border border-white/10 p-5"><p className="font-mono text-[10px] uppercase text-gray-500 mb-2">Sem preview</p><p className="font-sans font-black text-3xl text-red-300">{productsMissingThumbnails.length}</p></div>
              </div>
              <div className="bg-[#0d131c] border border-white/10">
                <div className="p-5 border-b border-white/10 flex flex-col xl:flex-row gap-4 xl:items-center xl:justify-between">
                  <div><h3 className="font-sans font-black text-base uppercase">Fotos e videos</h3><p className="font-mono text-[10px] uppercase text-gray-500">{filteredMedia.length} resultado(s)</p></div>
                  <div className="flex flex-col md:flex-row gap-3">
                    <input value={mediaSearch} onChange={(event) => setMediaSearch(event.target.value)} placeholder="Buscar por evento, fotógrafo ou peito" className="h-11 px-3 bg-[#080d14] border border-white/15 text-white font-mono text-xs outline-none focus:border-brutal-accent md:w-80" />
                    <select value={mediaStatusFilter} onChange={(event) => setMediaStatusFilter(event.target.value as typeof mediaStatusFilter)} className="h-11 px-3 bg-[#080d14] border border-white/15 text-white font-mono text-xs uppercase outline-none focus:border-brutal-accent">
                      <option value="all">Todos status</option><option value="published">Publicado</option><option value="hidden">Oculto</option><option value="draft">Rascunho</option><option value="processing">Processando</option><option value="removed">Removido</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 p-5">
                  {filteredMedia.slice(0, visibleAdminRows.media).map((product) => (
                    <div key={product.id} className="bg-[#080d14] border border-white/10 overflow-hidden">
                      <div className="aspect-4/3 bg-black relative">
                        {product.thumbnailUrl || product.type === 'IMG' ? <img src={product.thumbnailUrl || product.url} alt={product.name} className="w-full h-full object-cover" /> : <video src={product.url} className="w-full h-full object-cover" muted preload="metadata" />}
                        <span className="absolute left-2 top-2 bg-black/80 border border-white/10 px-2 py-1 font-mono text-[8px] uppercase">{product.type}</span>
                        <span className="absolute right-2 top-2 bg-brutal-accent px-2 py-1 font-mono text-[8px] uppercase">{product.status ?? 'published'}</span>
                      </div>
                      <div className="p-4 space-y-3">
                        <div><p className="font-sans font-black text-sm uppercase truncate">{product.name}</p><p className="font-mono text-[10px] uppercase text-gray-500 truncate">{product.event || 'Geral'} - {photographerById.get(product.vendedorId)?.name ?? product.vendedorId}</p></div>
                        <div className="grid grid-cols-2 gap-2">
                          <button disabled={updatingProductId === product.id} onClick={() => handleModerateProduct(product, 'published')} className="h-9 border border-green-500/30 text-green-300 font-mono text-[10px] uppercase hover:bg-green-500/10">Publicar</button>
                          <button disabled={updatingProductId === product.id} onClick={() => handleModerateProduct(product, 'hidden')} className="h-9 border border-yellow-500/30 text-yellow-300 font-mono text-[10px] uppercase hover:bg-yellow-500/10"><EyeOff className="w-3 h-3 inline mr-1" />Ocultar</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <AdminLoadMoreButton
                  visible={visibleAdminRows.media}
                  total={filteredMedia.length}
                  onClick={() => showMoreAdminRows('media')}
                />
              </div>
            </motion.div>
          )}

          {activeTab === 'orders' && (
            <motion.div key="orders" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
              <div className="bg-[#0d131c] border border-white/10">
                <div className="p-5 border-b border-white/10 flex flex-col xl:flex-row gap-4 xl:items-center xl:justify-between">
                  <div><h3 className="font-sans font-black text-base uppercase">Pedidos</h3><p className="font-mono text-[10px] uppercase text-gray-500">{filteredOrders.length} no periodo selecionado</p></div>
                  <div className="flex flex-col md:flex-row gap-3">
                    <input value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} placeholder="Buscar pedido, cliente, evento" className="h-11 px-3 bg-[#080d14] border border-white/15 text-white font-mono text-xs outline-none focus:border-brutal-accent md:w-80" />
                    <select value={orderStatusFilter} onChange={(event) => setOrderStatusFilter(event.target.value as typeof orderStatusFilter)} className="h-11 px-3 bg-[#080d14] border border-white/15 text-white font-mono text-xs uppercase outline-none focus:border-brutal-accent">
                      <option value="all">Todos os status</option><option value="pending">Pendente</option><option value="paid">Pago</option><option value="refused">Recusado</option><option value="canceled">Cancelado</option><option value="refunded">Reembolsado</option>
                    </select>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-[#05080d] text-gray-500 font-mono text-[10px] uppercase"><tr><th className="px-5 py-3">Pedido</th><th className="px-5 py-3">Cliente</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Valor</th><th className="px-5 py-3">Método</th><th className="px-5 py-3">Evento/Fotógrafo</th><th className="px-5 py-3">Ação</th></tr></thead>
                    <tbody className="divide-y divide-white/10">
                      {filteredOrders.slice(0, visibleAdminRows.orders).map((order) => {
                        const firstItem = order.items?.[0];
                        const isRecoveringOrderPayment = recoveringPaymentOrderId === order.id;
                        return (
                          <tr key={order.id} className="hover:bg-white/3">
                            <td className="px-5 py-4 font-mono text-xs">#{order.id.slice(0, 8)}<p className="text-[10px] text-gray-600">{new Date(order.createdAt).toLocaleString('pt-BR')}</p></td>
                            <td className="px-5 py-4"><p className="font-sans font-bold">{order.buyerName}</p><p className="font-mono text-[10px] text-gray-500">{order.buyerEmail}</p></td>
                            <td className="px-5 py-4"><span className={`px-2 py-1 border font-mono text-[10px] uppercase ${orderStatusClasses[order.status]}`}>{orderStatusLabels[order.status]}</span></td>
                            <td className="px-5 py-4 font-sans font-black text-green-400">{formatCurrency(Number(order.total || 0))}</td>
                            <td className="px-5 py-4 font-mono text-xs uppercase">{order.paymentMethod || 'checkout'}</td>
                            <td className="px-5 py-4 font-mono text-[10px] text-gray-400">{firstItem?.event || 'N/I'}<br />{firstItem ? photographerById.get(firstItem.vendedorId)?.name ?? firstItem.vendedorId : 'N/I'}</td>
                            <td className="px-5 py-4">
                              <div className="flex flex-col gap-2">
                                <select disabled={updatingOrderId === order.id || isRecoveringOrderPayment} value={order.status} onChange={(event) => handleAdminOrderStatus(order, event.target.value as Order['status'])} className="h-9 bg-[#080d14] border border-white/15 text-white font-mono text-[10px] uppercase"><option value="pending">Pendente</option><option value="paid">Pago via recuperação</option><option value="refused">Recusado</option><option value="canceled">Cancelado</option><option value="refunded">Reembolsado</option></select>
                                {order.status !== 'paid' && (
                                  <button
                                    type="button"
                                    disabled={isRecoveringOrderPayment}
                                    onClick={() => handleManualReleaseOrder(order)}
                                    className="h-9 px-3 bg-[#080d14] border border-brutal-accent/60 text-brutal-accent font-mono text-[10px] uppercase inline-flex items-center justify-center gap-2 hover:bg-brutal-accent/10 disabled:text-gray-500 disabled:border-white/10 disabled:cursor-not-allowed"
                                  >
                                    {isRecoveringOrderPayment ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                                    Liberar pagamento
                                  </button>
                                )}
                                {order.status === 'paid' && (
                                  <button
                                    type="button"
                                    disabled={resendingEmailOrderId === order.id}
                                    onClick={() => handleResendDownloadEmail(order)}
                                    className="h-9 px-3 bg-[#080d14] border border-white/15 text-white font-mono text-[10px] uppercase inline-flex items-center justify-center gap-2 hover:border-brutal-accent disabled:text-gray-500 disabled:cursor-not-allowed"
                                  >
                                    {resendingEmailOrderId === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                                    Reenviar e-mail
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <AdminLoadMoreButton
                  visible={visibleAdminRows.orders}
                  total={filteredOrders.length}
                  onClick={() => showMoreAdminRows('orders')}
                />
              </div>
            </motion.div>
          )}

          {activeTab === 'payments' && (
            <motion.div key="payments" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
              <div className="bg-[#0d131c] border border-white/10">
                <div className="p-5 border-b border-white/10 flex flex-col xl:flex-row gap-4 xl:items-center xl:justify-between">
                  <div>
                    <h3 className="font-sans font-black text-base uppercase flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-yellow-300" /> Recuperacao de pagamentos</h3>
                    <p className="font-mono text-[10px] uppercase text-gray-500">{visiblePaymentIssues.length} inconsistencia(s) detectada(s)</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAuditPayments}
                    disabled={isAuditingPayments}
                    className="h-11 px-4 bg-[#080d14] border border-white/15 text-white font-mono text-[10px] uppercase inline-flex items-center justify-center gap-2 hover:border-brutal-accent disabled:text-gray-500 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className={`w-4 h-4 ${isAuditingPayments ? 'animate-spin' : ''}`} />
                    Auditar banco
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-5 border-b border-white/10">
                  <div className="bg-[#080d14] border border-white/10 p-4"><p className="font-mono text-[9px] uppercase text-gray-500">Sem webhook</p><p className="font-sans font-black text-2xl text-yellow-300">{paymentRecoverySummary.pendingWithoutWebhook ?? localPaymentIssues.filter((issue) => issue.reasons.includes('pending_without_webhook')).length}</p></div>
                  <div className="bg-[#080d14] border border-white/10 p-4"><p className="font-mono text-[9px] uppercase text-gray-500">Sem IDs InfinitePay</p><p className="font-sans font-black text-2xl text-red-300">{paymentRecoverySummary.missingProviderIdentifiers ?? localPaymentIssues.filter((issue) => issue.reasons.includes('missing_provider_identifiers')).length}</p></div>
                  <div className="bg-[#080d14] border border-white/10 p-4"><p className="font-mono text-[9px] uppercase text-gray-500">Download faltando</p><p className="font-sans font-black text-2xl text-brutal-accent">{paymentRecoverySummary.missingDownloadAccess ?? 0}</p></div>
                  <div className="bg-[#080d14] border border-white/10 p-4"><p className="font-mono text-[9px] uppercase text-gray-500">Total em risco</p><p className="font-sans font-black text-2xl text-white">{visiblePaymentIssues.length}</p></div>
                </div>
                <div className="divide-y divide-white/10 max-h-96 overflow-y-auto">
                  {visiblePaymentIssues.slice(0, visibleAdminRows.paymentIssues).map((issue) => {
                    const canReprocess = issue.hasTransactionNsu && issue.hasSlug;
                    const isBusy = recoveringPaymentOrderId === issue.orderId;
                    return (
                      <div key={issue.orderId} className="p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-sans font-black text-sm uppercase truncate">#{issue.orderId.slice(0, 8)} - {issue.buyerName}</p>
                          <p className="font-mono text-[10px] text-gray-500 truncate">{issue.buyerEmail} - {formatCurrency(Number(issue.total || 0))} - {issue.paymentMethod || 'checkout'}</p>
                          <p className="font-mono text-[9px] text-yellow-300 uppercase mt-1">{issue.reasons.join(', ')}</p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={isBusy || !canReprocess}
                            onClick={() => handleRecoverPayment(issue, 'reprocess')}
                            className="h-9 px-3 border border-blue-400/30 text-blue-300 font-mono text-[9px] uppercase hover:bg-blue-500/10 disabled:text-gray-600 disabled:border-white/10 disabled:cursor-not-allowed"
                          >
                            Reprocessar
                          </button>
                          <button
                            type="button"
                            disabled={isBusy || issue.status !== 'paid'}
                            onClick={() => handleRecoverPayment(issue, 'fulfill')}
                            className="h-9 px-3 border border-green-400/30 text-green-300 font-mono text-[9px] uppercase hover:bg-green-500/10 disabled:text-gray-600 disabled:border-white/10 disabled:cursor-not-allowed"
                          >
                            Liberar downloads
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleRecoverPayment(issue, 'manual_release')}
                            className="h-9 px-3 border border-brutal-accent/60 text-brutal-accent font-mono text-[9px] uppercase hover:bg-brutal-accent/10 disabled:text-gray-600 disabled:border-white/10 disabled:cursor-not-allowed"
                          >
                            Manual
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {visiblePaymentIssues.length === 0 && (
                    <div className="p-6 text-center font-mono text-[10px] uppercase text-gray-500">Nenhuma inconsistencia encontrada.</div>
                  )}
                </div>
                <AdminLoadMoreButton
                  visible={visibleAdminRows.paymentIssues}
                  total={visiblePaymentIssues.length}
                  onClick={() => showMoreAdminRows('paymentIssues')}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
                <div className="bg-[#0d131c] border border-white/10 p-5"><p className="font-mono text-[10px] uppercase text-gray-500 mb-2">Pagamentos</p><p className="font-sans font-black text-3xl">{payments.length}</p></div>
                <div className="bg-[#0d131c] border border-white/10 p-5"><p className="font-mono text-[10px] uppercase text-gray-500 mb-2">Aprovados</p><p className="font-sans font-black text-3xl text-green-400">{payments.filter((item) => item.status === 'paid').length}</p></div>
                <div className="bg-[#0d131c] border border-white/10 p-5"><p className="font-mono text-[10px] uppercase text-gray-500 mb-2">Pendentes</p><p className="font-sans font-black text-3xl text-yellow-400">{payments.filter((item) => item.status === 'pending').length}</p></div>
                <div className="bg-[#0d131c] border border-white/10 p-5"><p className="font-mono text-[10px] uppercase text-gray-500 mb-2">Webhooks</p><p className="font-sans font-black text-3xl text-brutal-accent">{paymentEvents.length}</p></div>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <div className="bg-[#0d131c] border border-white/10">
                  <div className="p-5 border-b border-white/10 flex items-center justify-between"><h3 className="font-sans font-black text-base uppercase">Histórico de pagamentos</h3><select value={paymentStatusFilter} onChange={(event) => setPaymentStatusFilter(event.target.value as typeof paymentStatusFilter)} className="h-10 bg-[#080d14] border border-white/15 text-white font-mono text-[10px] uppercase"><option value="all">Todos</option><option value="paid">Pago</option><option value="pending">Pendente</option><option value="refused">Recusado</option><option value="failed">Falhou</option></select></div>
                  <div className="divide-y divide-white/10 max-h-160 overflow-y-auto">{filteredPayments.slice(0, visibleAdminRows.payments).map((payment) => <div key={payment.id} className="p-4 flex justify-between gap-4"><div><p className="font-sans font-black text-sm uppercase">{payment.provider} - {payment.method}</p><p className="font-mono text-[10px] text-gray-500">Pedido #{payment.orderId.slice(0, 8)} - {payment.providerPaymentId}</p></div><span className={`h-fit px-2 py-1 border font-mono text-[10px] uppercase ${orderStatusClasses[payment.status]}`}>{payment.status}</span></div>)}</div>
                  <AdminLoadMoreButton
                    visible={visibleAdminRows.payments}
                    total={filteredPayments.length}
                    onClick={() => showMoreAdminRows('payments')}
                  />
                </div>
                <div className="bg-[#0d131c] border border-white/10">
                  <div className="p-5 border-b border-white/10"><h3 className="font-sans font-black text-base uppercase">Logs de webhook</h3><p className="font-mono text-[10px] uppercase text-gray-500">Auditoria do gateway</p></div>
                  <div className="divide-y divide-white/10 max-h-160 overflow-y-auto">{paymentEvents.slice(0, visibleAdminRows.paymentEvents).map((eventItem) => <div key={eventItem.id} className="p-4"><p className="font-sans font-black text-sm uppercase">{eventItem.provider} - {eventItem.status || 'received'}</p><p className="font-mono text-[10px] text-gray-500">{eventItem.eventId} - {new Date(eventItem.createdAt).toLocaleString('pt-BR')}</p></div>)}</div>
                  <AdminLoadMoreButton
                    visible={visibleAdminRows.paymentEvents}
                    total={paymentEvents.length}
                    onClick={() => showMoreAdminRows('paymentEvents')}
                  />
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'sales' && (
            <motion.div
              key="sales"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-5"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Saques pendentes</p>
                  <p className="font-sans font-black text-3xl text-brutal-accent">{formatCurrency(pendingWithdrawalTotal)}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">{pendingWithdrawals.length === 1 ? '1 solicitação' : `${pendingWithdrawals.length} solicitações`}</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Receita paga</p>
                  <p className="font-sans font-black text-3xl text-green-400">{formatCurrency(paidRevenueTotal)}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">
                    {paidSaleItems.length === 1 ? '1 item pago' : `${paidSaleItems.length} itens pagos`} em {paidOrders.length === 1 ? '1 pedido' : `${paidOrders.length} pedidos`}
                  </p>
                  {paidRevenueMismatch && (
                    <p className="font-mono text-[9px] uppercase text-yellow-300 mt-2">
                      Total salvo nos pedidos: {formatCurrency(paidOrderStoredTotal)}
                    </p>
                  )}
                  {paidOrdersWithoutItems.length > 0 && (
                    <p className="font-mono text-[9px] uppercase text-red-300 mt-2">
                      {paidOrdersWithoutItems.length} pedido(s) pago(s) sem item vinculado
                    </p>
                  )}
                </div>
              </div>

              <div className="bg-[#0d131c] border border-white/10 space-y-6">
                <div className="px-5 py-4 border-b border-white/10 flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div>
                    <h3 className="font-sans font-black text-base uppercase text-white">Fila de Saques Pix</h3>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mt-1">
                      Transferências Pix solicitadas pelos fotógrafos
                    </p>
                  </div>
                  <div className="bg-[#080d14] text-white border border-white/10 px-4 py-3">
                    <p className="font-mono text-[9px] uppercase text-gray-400">Total pendente</p>
                    <p className="font-sans font-black text-2xl text-brutal-accent">{formatCurrency(pendingWithdrawalTotal)}</p>
                  </div>
                </div>

                {pendingWithdrawals.length > 0 ? (
                  <div className="divide-y divide-white/10">
                    {pendingWithdrawals.map((withdrawal) => {
                      const photographer = photographerById.get(withdrawal.photographerId);
                      return (
                        <div key={withdrawal.id} className="p-5 space-y-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <p className="font-sans font-black text-lg uppercase text-white truncate">{photographer?.name ?? 'Fotógrafo'}</p>
                              <p className="font-mono text-[10px] text-gray-500 truncate">{photographer?.email ?? withdrawal.photographerId}</p>
                              <p className="font-mono text-[10px] text-gray-500 uppercase mt-2">
                                Solicitado em {new Date(withdrawal.createdAt).toLocaleString('pt-BR')}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-sans font-black text-2xl text-brutal-accent">{formatCurrency(Number(withdrawal.amount))}</p>
                              <p className="font-mono text-[9px] text-yellow-300 uppercase">Pendente</p>
                            </div>
                          </div>

                          <div className="bg-[#080d14] border border-white/10 p-3">
                            <p className="font-mono text-[9px] uppercase text-gray-500">Chave Pix</p>
                            <p className="font-mono text-xs text-gray-200 break-all">{withdrawal.pixKey || 'Chave não informada'}</p>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <button
                              disabled={updatingWithdrawalId === withdrawal.id}
                              onClick={() => handleWithdrawalStatus(withdrawal, 'paid')}
                              className="h-10 bg-green-500 text-white border border-green-500 font-mono text-[10px] uppercase font-bold hover:bg-green-400 disabled:bg-gray-700 disabled:border-gray-700 disabled:text-gray-400 transition-colors cursor-pointer"
                            >
                              {updatingWithdrawalId === withdrawal.id ? 'Salvando...' : 'Marcar Pago'}
                            </button>
                            <button
                              disabled={updatingWithdrawalId === withdrawal.id}
                              onClick={() => handleWithdrawalStatus(withdrawal, 'rejected')}
                              className="h-10 bg-transparent text-red-300 border border-red-500/30 font-mono text-[10px] uppercase font-bold hover:bg-red-500/10 disabled:text-gray-500 disabled:border-gray-700 transition-colors cursor-pointer"
                            >
                              Recusar
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-5 py-12 text-center">
                    <DollarSign className="w-10 h-10 text-gray-600 mx-auto mb-4" />
                    <p className="font-sans font-black text-sm uppercase text-white">Nenhum saque pendente</p>
                    <p className="font-mono text-[10px] uppercase text-gray-500 mt-2">Novas solicitações Pix aparecem aqui.</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <div className="bg-[#05080d] text-white border border-white/10">
                  <div className="p-5 border-b border-white/10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                    <div>
                      <h3 className="font-sans font-black text-base uppercase text-brutal-accent">Log de Pedidos</h3>
                      <p className="font-mono text-[10px] uppercase text-gray-500">
                        {showAllOrderLogs ? `Todos os ${periodOrders.length} registros do periodo` : 'Ultimas transacoes registradas'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="hidden sm:flex items-center gap-2 font-mono text-[9px] uppercase text-gray-500">
                        <span className="px-2 py-1 border border-green-500/20 text-green-300">{paidOrders.length} pagos</span>
                        <span className="px-2 py-1 border border-yellow-500/20 text-yellow-300">{pendingOrders.length} pendentes</span>
                      </div>
                      {periodOrders.length > recentOrders.length && (
                        <button
                          type="button"
                          onClick={() => setShowAllOrderLogs((current) => !current)}
                          className="inline-flex h-9 items-center gap-2 border border-white/10 bg-white/5 px-3 font-mono text-[10px] uppercase text-gray-300 hover:border-brutal-accent hover:text-white transition-colors cursor-pointer"
                        >
                          {showAllOrderLogs ? 'Ver menos' : 'Ver todos'}
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className={`${showAllOrderLogs ? 'max-h-130 overflow-y-auto' : ''}`}>
                    <div className="divide-y divide-white/10">
                      {visibleOrderLogs.length > 0 ? visibleOrderLogs.map((order) => {
                        const itemCount = order.items?.length ?? 0;
                        const itemRevenue = getOrderItemsRevenue(order);
                        const hasMismatch = Math.abs(itemRevenue - Number(order.total || 0)) > 0.01;

                        return (
                          <div key={order.id} className="px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-xs font-mono hover:bg-white/3 transition-colors">
                            <div className="min-w-0 flex gap-3">
                              <span className="w-20 shrink-0 text-gray-600">#{order.id.slice(0, 8)}</span>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="uppercase text-white truncate">{order.buyerName || 'Cliente sem nome'}</p>
                                  <span className={`px-2 py-0.5 border text-[9px] uppercase ${orderStatusClasses[order.status]}`}>
                                    {orderStatusLabels[order.status]}
                                  </span>
                                  {hasMismatch && (
                                    <span className="px-2 py-0.5 border border-yellow-500/30 bg-yellow-500/10 text-[9px] uppercase text-yellow-300">
                                      Divergencia
                                    </span>
                                  )}
                                </div>
                                <p className="text-gray-500 text-[10px] mt-1">
                                  {order.paymentProvider} - {new Date(order.createdAt).toLocaleString('pt-BR')} - {itemCount === 1 ? '1 item' : `${itemCount} itens`}
                                </p>
                              </div>
                            </div>
                            <div className="text-left sm:text-right shrink-0">
                              <p className={order.status === 'paid' ? 'text-green-400' : order.status === 'cancelled' ? 'text-red-300' : 'text-yellow-400'}>
                                {formatCurrency(itemRevenue)}
                              </p>
                              {hasMismatch ? (
                                <p className="text-yellow-300 text-[9px] uppercase">
                                  Pedido: {formatCurrency(Number(order.total || 0))}
                                </p>
                              ) : Number(order.discountTotal || 0) > 0 ? (
                                <p className="text-green-300 text-[9px] uppercase">
                                  Desconto: {formatCurrency(Number(order.discountTotal || 0))}
                                </p>
                              ) : (
                                <p className="text-gray-600 text-[9px] uppercase">
                                  Total conciliado
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      }) : (
                        <div className="p-5 text-xs font-mono text-gray-500 uppercase">Nenhuma transacao registrada.</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-[#05080d] text-white border border-white/10 p-5">
                  <div className="flex items-center justify-between gap-4 mb-5">
                    <div>
                      <h3 className="font-sans font-black text-base uppercase text-white">Histórico de saques</h3>
                      <p className="font-mono text-[10px] uppercase text-gray-500">Pagos e recusados recentemente</p>
                    </div>
                    <DollarSign className="w-5 h-5 text-gray-500" />
                  </div>
                  <div className="divide-y divide-white/10">
                    {processedWithdrawals.length > 0 ? processedWithdrawals.slice(0, 6).map((withdrawal) => {
                      const photographer = photographerById.get(withdrawal.photographerId);
                      return (
                        <div key={withdrawal.id} className="py-4 first:pt-0 last:pb-0 flex justify-between items-start gap-4 text-xs font-mono">
                          <div className="min-w-0">
                            <p className="uppercase text-white truncate">{photographer?.name ?? 'Fotógrafo'}</p>
                            <p className="text-gray-500 text-[10px]">{withdrawal.status} - {new Date(withdrawal.createdAt).toLocaleDateString('pt-BR')}</p>
                          </div>
                          <p className={withdrawal.status === 'paid' ? 'text-green-400' : 'text-red-300'}>
                            {formatCurrency(Number(withdrawal.amount))}
                          </p>
                        </div>
                      );
                    }) : (
                      <div className="text-xs font-mono text-gray-500 uppercase">Nenhum saque processado.</div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'referrals' && (
            <motion.div key="referrals" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Indicações</p>
                  <p className="font-sans font-black text-3xl text-white">{referrals.length}</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Pendentes</p>
                  <p className="font-sans font-black text-3xl text-yellow-300">{referrals.filter((referral) => referral.status === 'pending').length}</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Bônus disponível</p>
                  <p className="font-sans font-black text-3xl text-brutal-accent">{formatCurrency(referrals.filter((referral) => referral.rewardStatus === 'available').reduce((sum, referral) => sum + Number(referral.rewardAmount || 0), 0))}</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Bônus pago</p>
                  <p className="font-sans font-black text-3xl text-green-400">{formatCurrency(referrals.filter((referral) => referral.rewardStatus === 'paid').reduce((sum, referral) => sum + Number(referral.rewardAmount || 0), 0))}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">
                <div className="bg-[#0d131c] border border-white/10">
                  <div className="p-5 border-b border-white/10">
                    <h3 className="font-sans font-black text-base uppercase text-white">Indicações de Fotógrafos</h3>
                    <p className="font-mono text-[10px] uppercase text-gray-500">Auditoria, aprovação e pagamento de bônus</p>
                  </div>
                  <div className="divide-y divide-white/10">
                    {referrals.length === 0 ? (
                      <div className="p-8 text-center font-mono text-[10px] uppercase text-gray-500">Nenhuma indicação registrada.</div>
                    ) : referrals.map((referral) => {
                      const referrer = photographerById.get(referral.referrerPhotographerId);
                      const referred = photographerById.get(referral.referredPhotographerId);
                      return (
                        <div key={referral.id} className="p-5 grid gap-4 lg:grid-cols-[1.2fr_1fr_auto] lg:items-center">
                          <div className="min-w-0">
                            <p className="font-sans font-black text-sm uppercase text-white truncate">{referrer?.name || referral.referrerPhotographerId}</p>
                            <p className="font-mono text-[10px] uppercase text-gray-500 truncate">indicou {referred?.name || referral.referredPhotographerId}</p>
                            <p className="font-mono text-[10px] uppercase text-gray-600 mt-1">Código {referral.referralCode} - {new Date(referral.createdAt).toLocaleString('pt-BR')}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className="border border-white/10 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase text-gray-300">{referral.status}</span>
                            <span className="border border-brutal-accent/30 bg-brutal-accent/10 px-2 py-1 font-mono text-[10px] uppercase text-brutal-accent">{formatCurrency(Number(referral.rewardAmount || 0))} / {referral.rewardStatus}</span>
                          </div>
                          <div className="flex flex-wrap gap-2 justify-start lg:justify-end">
                            <button disabled={updatingReferralId === referral.id || referral.status === 'approved'} onClick={() => handleReferralAction(referral, 'approve')} className="h-9 px-3 border border-white/15 font-mono text-[10px] uppercase hover:border-green-400 disabled:opacity-40">Aprovar</button>
                            <button disabled={updatingReferralId === referral.id || referral.rewardStatus !== 'available'} onClick={() => handleReferralAction(referral, 'mark_paid')} className="h-9 px-3 border border-white/15 font-mono text-[10px] uppercase hover:border-brutal-accent disabled:opacity-40">Pago</button>
                            <button disabled={updatingReferralId === referral.id || referral.status === 'canceled'} onClick={() => handleReferralAction(referral, 'cancel')} className="h-9 px-3 border border-white/15 font-mono text-[10px] uppercase hover:border-red-400 disabled:opacity-40">Cancelar</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="bg-[#0d131c] border border-white/10 p-5">
                    <h3 className="font-sans font-black text-base uppercase text-white mb-4">Ranking</h3>
                    <div className="space-y-3">
                      {referralRanking.length === 0 ? <p className="font-mono text-[10px] uppercase text-gray-500">Sem ranking ainda.</p> : referralRanking.map((row, index) => (
                        <div key={row.id} className="flex items-center justify-between gap-3 border-b border-white/10 pb-3 last:border-0 last:pb-0">
                          <div className="min-w-0">
                            <p className="font-sans font-black text-sm uppercase text-white truncate">#{index + 1} {row.photographer?.name || row.id}</p>
                            <p className="font-mono text-[10px] uppercase text-gray-500">{row.total} indicação(ões)</p>
                          </div>
                          <p className="font-sans font-black text-brutal-accent">{formatCurrency(row.rewarded)}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-[#0d131c] border border-white/10 p-5 space-y-4">
                    <h3 className="font-sans font-black text-base uppercase text-white">Regra de recompensa</h3>
                    <select
                      value={(settingsForm.referralSettings as ReferralSettings)?.rewardRuleType || 'first_sale_fixed'}
                      onChange={(event) => setSettingsForm((current) => ({ ...current, referralSettings: { ...referralService.defaultSettings, ...(current.referralSettings || {}), rewardRuleType: event.target.value as ReferralSettings['rewardRuleType'] } }))}
                      className="w-full h-12 px-3 bg-[#080d14] border border-white/15 text-white font-mono text-xs uppercase outline-none focus:border-brutal-accent"
                    >
                      <option value="approval_fixed">Bônus fixo por aprovação</option>
                      <option value="first_sale_fixed">Bônus após primeira venda</option>
                      <option value="recurring_commission">Comissão recorrente</option>
                    </select>
                    {[
                      ['approvalRewardAmount', 'Bônus aprovação (R$)'],
                      ['firstSaleRewardAmount', 'Bônus primeira venda (R$)'],
                      ['recurringCommissionPercent', 'Comissão recorrente (%)'],
                      ['recurringCommissionMonths', 'Meses de comissão'],
                    ].map(([key, label]) => (
                      <label key={key} className="block space-y-2">
                        <span className="font-mono text-[10px] uppercase text-gray-500">{label}</span>
                        <input
                          type="number"
                          min="0"
                          step={key === 'recurringCommissionMonths' ? '1' : '0.01'}
                          value={Number((settingsForm.referralSettings as any)?.[key] ?? (referralService.defaultSettings as any)[key])}
                          onChange={(event) => setSettingsForm((current) => ({ ...current, referralSettings: { ...referralService.defaultSettings, ...(current.referralSettings || {}), [key]: Number(event.target.value) } }))}
                          className="w-full h-12 px-3 bg-[#080d14] border border-white/15 text-white font-mono text-xs outline-none focus:border-brutal-accent"
                        />
                      </label>
                    ))}
                    <button onClick={handleSaveSettings} disabled={isSavingSettings} className="w-full h-12 bg-brutal-accent border border-brutal-accent text-white font-sans font-black text-xs uppercase hover:bg-white hover:text-brutal-accent disabled:opacity-60">
                      {isSavingSettings ? 'Salvando...' : 'Salvar regra'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'coupons' && (
            <motion.div key="coupons" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
              <form onSubmit={handleCreateCoupon} className="bg-[#0d131c] border border-white/10 p-5 grid gap-4 lg:grid-cols-[1fr_150px_150px_150px_180px_auto] lg:items-end">
                <div><label className="block font-mono text-[10px] uppercase text-gray-500 mb-2">Codigo</label><input value={couponForm.code} onChange={(event) => setCouponForm((current) => ({ ...current, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') }))} placeholder="FUNPACE10" className="w-full h-12 px-4 bg-[#080d14] border border-white/15 text-white font-mono text-xs uppercase outline-none focus:border-brutal-accent" /></div>
                <div><label className="block font-mono text-[10px] uppercase text-gray-500 mb-2">Tipo</label><select value={couponForm.type} onChange={(event) => setCouponForm((current) => ({ ...current, type: event.target.value as Coupon['type'] }))} className="w-full h-12 px-3 bg-[#080d14] border border-white/15 text-white font-mono text-xs uppercase outline-none focus:border-brutal-accent"><option value="percent">Percentual</option><option value="fixed">Valor fixo</option></select></div>
                <div><label className="block font-mono text-[10px] uppercase text-gray-500 mb-2">Desconto</label><input type="number" min="0" step="0.01" value={couponForm.value} onChange={(event) => setCouponForm((current) => ({ ...current, value: event.target.value }))} className="w-full h-12 px-4 bg-[#080d14] border border-white/15 text-white font-mono text-xs outline-none focus:border-brutal-accent" /></div>
                <div><label className="block font-mono text-[10px] uppercase text-gray-500 mb-2">Limite</label><input type="number" min="1" value={couponForm.maxUses} onChange={(event) => setCouponForm((current) => ({ ...current, maxUses: event.target.value }))} placeholder="Sem limite" className="w-full h-12 px-4 bg-[#080d14] border border-white/15 text-white font-mono text-xs outline-none focus:border-brutal-accent" /></div>
                <div><label className="block font-mono text-[10px] uppercase text-gray-500 mb-2">Validade</label><input type="date" value={couponForm.expiresAt} onChange={(event) => setCouponForm((current) => ({ ...current, expiresAt: event.target.value }))} className="w-full h-12 px-4 bg-[#080d14] border border-white/15 text-white font-mono text-xs outline-none focus:border-brutal-accent" /></div>
                <button disabled={isCreatingCoupon} className="h-12 px-5 bg-brutal-accent border border-brutal-accent text-white font-sans text-xs font-black uppercase hover:bg-white hover:text-brutal-accent">{isCreatingCoupon ? 'Criando...' : 'Criar'}</button>
              </form>
              <div className="bg-[#0d131c] border border-white/10">
                <div className="p-5 border-b border-white/10"><h3 className="font-sans font-black text-base uppercase">Cupons ativos e historico</h3><p className="font-mono text-[10px] uppercase text-gray-500">{coupons.length} cupom(ns)</p></div>
                <div className="divide-y divide-white/10">{coupons.map((coupon) => <div key={coupon.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"><div><p className="font-sans font-black text-xl text-white">{coupon.code}</p><p className="font-mono text-[10px] uppercase text-gray-500">{coupon.type === 'percent' ? `${coupon.value}%` : formatCurrency(Number(coupon.value))} - usado {coupon.usedCount}/{coupon.maxUses || '∞'}</p></div><div className="flex items-center gap-3"><span className={`px-2 py-1 border font-mono text-[10px] uppercase ${coupon.isActive ? 'border-green-500/30 text-green-300 bg-green-500/10' : 'border-gray-500/30 text-gray-400 bg-gray-500/10'}`}>{coupon.isActive ? 'Ativo' : 'Inativo'}</span><button disabled={updatingCouponId === coupon.id} onClick={() => handleToggleCoupon(coupon)} className="h-10 px-4 border border-white/15 font-mono text-[10px] uppercase hover:border-brutal-accent">{coupon.isActive ? 'Desativar' : 'Ativar'}</button></div></div>)}</div>
              </div>
            </motion.div>
          )}

          {activeTab === 'logs' && (
            <motion.div key="logs" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
              <div className="bg-[#0d131c] border border-white/10">
                <div className="p-5 border-b border-white/10 flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
                  <div><h3 className="font-sans font-black text-base uppercase">Auditoria operacional</h3><p className="font-mono text-[10px] uppercase text-gray-500">{filteredLogs.length} registro(s)</p></div>
                  <input value={logSearch} onChange={(event) => setLogSearch(event.target.value)} placeholder="Buscar acao, alvo, webhook" className="h-11 px-3 bg-[#080d14] border border-white/15 text-white font-mono text-xs outline-none focus:border-brutal-accent md:w-90" />
                </div>
                <div className="divide-y divide-white/10 max-h-[70vh] overflow-y-auto">
                  {filteredLogs.slice(0, visibleAdminRows.logs).map((log) => (
                    <div key={log.id} className="p-4 grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-start">
                      <div><p className="font-sans font-black text-sm uppercase text-white">{log.action}</p><p className="font-mono text-[10px] text-gray-500">{log.actorEmail || 'sistema'}</p></div>
                      <div><p className="font-mono text-[10px] uppercase text-gray-400">{log.targetType || 'evento'} {log.targetId ? `#${String(log.targetId).slice(0, 12)}` : ''}</p><pre className="mt-2 whitespace-pre-wrap break-all font-mono text-[10px] text-gray-600 max-h-24 overflow-hidden">{JSON.stringify(log.metadata || {}, null, 2)}</pre></div>
                      <p className="font-mono text-[10px] text-gray-500">{new Date(log.createdAt).toLocaleString('pt-BR')}</p>
                    </div>
                  ))}
                </div>
                <AdminLoadMoreButton
                  visible={visibleAdminRows.logs}
                  total={filteredLogs.length}
                  onClick={() => showMoreAdminRows('logs')}
                />
              </div>
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-5xl space-y-5"
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Taxa plataforma</p>
                  <p className="font-sans font-black text-3xl text-white">{settingsForm.platformFeePercent}%</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">Comissão sobre vendas</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Taxa saque</p>
                  <p className="font-sans font-black text-3xl text-brutal-accent">{formatCurrency(settingsForm.withdrawalFee)}</p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">Cobrada por solicitação Pix</p>
                </div>
                <div className="bg-[#0d131c] border border-white/10 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-2">Segurança</p>
                  <p className={`font-sans font-black text-3xl ${settingsForm.autoBlockSuspicious ? 'text-green-400' : 'text-yellow-400'}`}>
                    {settingsForm.autoBlockSuspicious ? 'ON' : 'OFF'}
                  </p>
                  <p className="font-mono text-[10px] uppercase text-gray-400 mt-3">Bloqueio automatico</p>
                </div>
              </div>

              <div className="bg-[#0d131c] border border-white/10">
                <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-sans font-black text-base uppercase text-white">Taxas do Marketplace</h3>
                    <p className="font-mono text-[10px] uppercase text-gray-500">Parametros usados em comissao, saldo e saques</p>
                  </div>
                  <DollarSign className="w-5 h-5 text-gray-500" />
                </div>
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <label className="font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Platform Fee (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={settingsForm.platformFeePercent}
                      onChange={(event) => setSettingsForm((current) => ({
                        ...current,
                        platformFeePercent: Number(event.target.value),
                      }))}
                      className="w-full h-14 px-4 bg-[#080d14] border border-white/15 text-white font-sans font-black text-2xl outline-none focus:border-brutal-accent transition-colors"
                    />
                    <p className="font-mono text-[10px] uppercase text-gray-600">Valor entre 0 e 100.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Taxa de Saque (R$)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={settingsForm.withdrawalFee}
                      onChange={(event) => setSettingsForm((current) => ({
                        ...current,
                        withdrawalFee: Number(event.target.value),
                      }))}
                      className="w-full h-14 px-4 bg-[#080d14] border border-white/15 text-white font-sans font-black text-2xl outline-none focus:border-brutal-accent transition-colors"
                    />
                    <p className="font-mono text-[10px] uppercase text-gray-600">Use 0 para saque sem tarifa.</p>
                  </div>
                </div>
              </div>

              <div className="bg-[#0d131c] border border-white/10">
                <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-sans font-black text-base uppercase text-white">Segurança Operacional</h3>
                    <p className="font-mono text-[10px] uppercase text-gray-500">Regras de protecao para comportamento suspeito</p>
                  </div>
                  <ShieldCheck className="w-5 h-5 text-gray-500" />
                </div>
                <div className="p-5 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <label className="font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Gateway ativo</label>
                      <select
                        value={settingsForm.paymentProvider}
                        onChange={(event) => setSettingsForm((current) => ({ ...current, paymentProvider: event.target.value }))}
                        className="w-full h-12 px-4 bg-[#080d14] border border-white/15 text-white font-mono text-xs uppercase outline-none focus:border-brutal-accent"
                      >
                        <option value="infinitepay">InfinitePay</option>
                        <option value="pagarme">Pagar.me futuro</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Limite upload bytes</label>
                      <input
                        type="number"
                        min="1048576"
                        value={settingsForm.maxUploadBytes}
                        onChange={(event) => setSettingsForm((current) => ({ ...current, maxUploadBytes: Number(event.target.value) }))}
                        className="w-full h-12 px-4 bg-[#080d14] border border-white/15 text-white font-mono text-xs outline-none focus:border-brutal-accent"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Nome da marca</label>
                      <input
                        value={settingsForm.brandName}
                        onChange={(event) => setSettingsForm((current) => ({ ...current, brandName: event.target.value }))}
                        className="w-full h-12 px-4 bg-[#080d14] border border-white/15 text-white font-mono text-xs outline-none focus:border-brutal-accent"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">E-mail suporte</label>
                      <input
                        type="email"
                        value={settingsForm.supportEmail}
                        onChange={(event) => setSettingsForm((current) => ({ ...current, supportEmail: event.target.value }))}
                        className="w-full h-12 px-4 bg-[#080d14] border border-white/15 text-white font-mono text-xs outline-none focus:border-brutal-accent"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-[#080d14] border border-white/10">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 border border-white/10 bg-white/5 flex items-center justify-center shrink-0">
                        <Clock className="w-5 h-5 text-brutal-accent" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-sans font-black text-sm uppercase text-white">Auto-block suspicious</p>
                        <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest">Bloqueio automático após 3 falhas</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSettingsForm((current) => ({
                        ...current,
                        autoBlockSuspicious: !current.autoBlockSuspicious,
                      }))}
                      className={`w-14 h-8 relative cursor-pointer border transition-colors shrink-0 ${settingsForm.autoBlockSuspicious ? 'bg-brutal-accent border-brutal-accent' : 'bg-[#05080d] border-white/20'
                        }`}
                      aria-pressed={settingsForm.autoBlockSuspicious}
                    >
                      <span className={`absolute top-1 w-6 h-6 bg-white transition-all ${settingsForm.autoBlockSuspicious ? 'right-1' : 'left-1'
                        }`} />
                    </button>
                  </div>
                  <button
                    disabled={isSavingSettings}
                    onClick={handleSaveSettings}
                    className="w-full h-14 bg-brutal-accent text-white border border-brutal-accent font-sans font-black text-sm uppercase tracking-widest hover:bg-white hover:text-brutal-accent transition-colors cursor-pointer disabled:bg-gray-700 disabled:border-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    {isSavingSettings ? 'Salvando...' : 'Salvar Alteracoes Globais'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Event Modal */}
      <AnimatePresence>
        {showEventModal && (
          <div className="fixed inset-0 z-150 flex items-center justify-center p-4 md:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={resetEventForm}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />
            <motion.div
              initial={{ scale: 0.96, y: 18 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 18 }}
              className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto bg-[#0d131c] border border-white/15 shadow-[0_30px_90px_rgba(0,0,0,0.6)] text-white"
            >
              <div className="h-1.5 bg-brutal-accent" />
              <button
                type="button"
                onClick={resetEventForm}
                className="absolute top-5 right-5 p-2 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Fechar modal"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="p-7 md:p-9 border-b border-white/10">
                <div className="flex flex-col md:flex-row md:items-center gap-5 pr-10">
                  <div className="w-16 h-16 bg-brutal-accent/10 border border-brutal-accent/30 text-brutal-accent flex items-center justify-center shrink-0">
                    <CalendarDays className="w-8 h-8" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-brutal-accent mb-2">
                      {editingEventId ? 'Editar cadastro' : 'Novo cadastro'}
                    </p>
                    <h3 className="font-sans font-black text-3xl md:text-4xl uppercase tracking-normal">
                      {editingEventId ? 'Editar Evento' : 'Criar Evento'}
                    </h3>
                    <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest mt-2">
                      Dados exibidos no marketplace e nos fluxos de mídia
                    </p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSaveEvent} className="p-7 md:p-9 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-2 md:col-span-2">
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Nome do evento</label>
                    <input
                      required
                      value={eventForm.name}
                      onChange={(event) => setEventForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Corrida Funpace"
                      className="w-full h-14 px-4 bg-[#080d14] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm outline-none focus:border-brutal-accent transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Data</label>
                    <input
                      required
                      type="date"
                      value={eventForm.date}
                      onChange={(event) => setEventForm((current) => ({ ...current, date: event.target.value }))}
                      className="w-full h-14 px-4 bg-[#080d14] border border-white/15 text-white font-mono text-sm outline-none focus:border-brutal-accent transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Status</label>
                    <select
                      value={eventForm.status}
                      onChange={(event) => setEventForm((current) => ({ ...current, status: event.target.value as Event['status'] }))}
                      className="w-full h-14 px-4 bg-[#080d14] border border-white/15 text-white font-mono text-sm uppercase outline-none focus:border-brutal-accent transition-colors"
                    >
                      <option value="active">Ativo</option>
                      <option value="scheduled">Agendado</option>
                      <option value="closed">Encerrado</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Local</label>
                    <input
                      value={eventForm.location}
                      onChange={(event) => setEventForm((current) => ({ ...current, location: event.target.value }))}
                      placeholder="Parque / Cidade"
                      className="w-full h-14 px-4 bg-[#080d14] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm outline-none focus:border-brutal-accent transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Ponto padrao</label>
                    <input
                      value={eventForm.checkpoint}
                      onChange={(event) => setEventForm((current) => ({ ...current, checkpoint: event.target.value }))}
                      placeholder="Chegada"
                      className="w-full h-14 px-4 bg-[#080d14] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm outline-none focus:border-brutal-accent transition-colors"
                    />
                  </div>
                </div>

                <div className="bg-[#080d14] border border-white/10 p-4">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest mb-2">Capa do evento</label>
                      <p className="font-mono text-[10px] uppercase text-gray-600">
                        Escolha uma foto ou preview ja enviado neste evento. Use imagens horizontais em 16:9 para melhor resultado. Sugestao: 1920x1080.
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
                          <video src={eventForm.coverImage} className="w-full h-full object-contain" muted preload="metadata" />
                        ) : (
                          <img src={eventForm.coverImage} alt="Capa atual do evento" style={{ objectPosition: eventForm.cover_position || 'center center' }} className="w-full h-full object-contain" />
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mb-4">
                    <label className="mb-2 block font-mono text-[10px] uppercase font-bold tracking-widest text-gray-400">Enquadramento da capa</label>
                    <select
                      value={eventForm.cover_position}
                      onChange={(event) => setEventForm((current) => ({ ...current, cover_position: event.target.value }))}
                      className="h-12 w-full bg-[#05080d] border border-white/15 px-3 font-mono text-xs uppercase text-white outline-none focus:border-brutal-accent"
                    >
                      {EVENT_COVER_POSITION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>

                  {eventCoverCandidates.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
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
                            <div className="aspect-video bg-[#05080d] overflow-hidden">
                              {coverUrl.match(/\.(mp4|webm|mov)(\?|$)/i) ? (
                                <video src={coverUrl} className="w-full h-full object-contain" muted preload="metadata" />
                              ) : (
                                <img src={coverUrl} alt={product.name} className="w-full h-full object-contain" />
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
                    <div className="border border-dashed border-white/10 p-5 text-center">
                      <Camera className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                      <p className="font-mono text-[10px] uppercase text-gray-500">
                        Envie fotos para este evento e depois escolha uma capa aqui.
                      </p>
                    </div>
                  )}
                </div>

                <div className="bg-[#080d14] border border-white/10 p-4 flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-brutal-accent shrink-0 mt-0.5" />
                  <p className="font-mono text-[10px] uppercase leading-relaxed text-gray-400">
                    Eventos cadastrados aqui podem ser reutilizados pelos fotógrafos e aparecem organizados nas áreas de busca e gestão de mídia.
                  </p>
                </div>

                <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
                  <button
                    type="button"
                    onClick={resetEventForm}
                    className="h-13 sm:h-14 flex-1 border border-white/15 text-gray-300 font-mono text-xs uppercase tracking-widest hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    disabled={isCreatingEvent}
                    type="submit"
                    className="h-13 sm:h-14 flex-1 bg-brutal-accent text-white border border-brutal-accent font-sans font-black text-sm uppercase tracking-widest hover:bg-white hover:text-brutal-accent transition-colors cursor-pointer disabled:bg-gray-700 disabled:border-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    {isCreatingEvent ? 'Salvando...' : editingEventId ? 'Salvar alterações' : 'Criar evento'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Photographer Action Confirmation */}
      <AnimatePresence>
        {photographerActionDialog && (
          <div className="fixed inset-0 z-170 flex items-center justify-center p-4 md:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isUpdatingPhotographer && setPhotographerActionDialog(null)}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />
            <motion.div
              initial={{ scale: 0.96, y: 18 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 18 }}
              className="relative w-full max-w-xl bg-[#0d131c] border border-white/15 shadow-[0_30px_90px_rgba(0,0,0,0.65)] text-white overflow-hidden"
            >
              <div className={`h-1.5 ${photographerActionDialog.type === 'delete' ? 'bg-red-500' : photographerActionDialog.type === 'disable' ? 'bg-yellow-400' : 'bg-green-500'}`} />
              <div className="p-7 md:p-8 space-y-6">
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 border flex items-center justify-center shrink-0 ${photographerActionDialog.type === 'delete'
                    ? 'bg-red-500/10 border-red-500/25 text-red-300'
                    : photographerActionDialog.type === 'disable'
                      ? 'bg-yellow-500/10 border-yellow-500/25 text-yellow-200'
                      : 'bg-green-500/10 border-green-500/25 text-green-300'
                    }`}>
                    {photographerActionDialog.type === 'delete'
                      ? <Trash2 className="w-6 h-6" />
                      : photographerActionDialog.type === 'disable'
                        ? <PauseCircle className="w-6 h-6" />
                        : <RefreshCw className="w-6 h-6" />}
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gray-500 mb-2">
                      {photographerActionDialog.type === 'delete' ? 'Atenção' : photographerActionDialog.type === 'disable' ? 'Desativar fotógrafo' : 'Reativar fotógrafo'}
                    </p>
                    <h3 className="font-sans font-black text-2xl md:text-3xl uppercase leading-tight">
                      {photographerActionDialog.type === 'delete'
                        ? 'Excluir fotógrafo'
                        : photographerActionDialog.type === 'disable'
                          ? 'Bloquear acesso'
                          : 'Restaurar acesso'}
                    </h3>
                  </div>
                </div>

                <div className="bg-[#080d14] border border-white/10 p-4">
                  <p className="font-sans font-black text-base uppercase text-white">{photographerActionDialog.photographer.name || 'Fotógrafo sem nome'}</p>
                  <p className="font-mono text-[10px] text-gray-500 lowercase mt-1">{photographerActionDialog.photographer.email}</p>
                </div>

                {photographerActionDialog.type === 'delete' ? (
                  <div className="space-y-3 text-gray-300">
                    <p className="font-sans text-sm leading-relaxed">Você realmente deseja excluir este fotógrafo?</p>
                    <div className="border border-red-500/25 bg-red-500/10 p-4">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-red-200 mb-3">Esta acao podera remover:</p>
                      <ul className="space-y-2 font-mono text-[10px] uppercase text-red-100/80">
                        <li>Perfil publico</li>
                        <li>Eventos vinculados</li>
                        <li>Fotos vinculadas</li>
                        <li>Histórico da conta</li>
                      </ul>
                    </div>
                  </div>
                ) : photographerActionDialog.type === 'disable' ? (
                  <p className="font-sans text-sm leading-relaxed text-gray-300">
                    O fotógrafo perderá acesso à plataforma até ser reativado por um administrador.
                  </p>
                ) : (
                  <p className="font-sans text-sm leading-relaxed text-gray-300">
                    O fotógrafo voltará a ter acesso ao painel e poderá publicar eventos e mídias novamente.
                  </p>
                )}

                <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
                  <button
                    type="button"
                    disabled={isUpdatingPhotographer}
                    onClick={() => setPhotographerActionDialog(null)}
                    className="h-12 flex-1 border border-white/15 text-gray-300 font-mono text-xs uppercase tracking-widest hover:bg-white/5 hover:text-white transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={isUpdatingPhotographer}
                    onClick={handleConfirmPhotographerAction}
                    className={`h-12 flex-1 border font-sans font-black text-xs uppercase tracking-widest transition-colors disabled:bg-gray-700 disabled:border-gray-700 disabled:text-gray-400 ${photographerActionDialog.type === 'delete'
                      ? 'bg-red-500 border-red-500 text-white hover:bg-white hover:text-red-500'
                      : photographerActionDialog.type === 'disable'
                        ? 'bg-yellow-400 border-yellow-400 text-black hover:bg-white hover:text-black'
                        : 'bg-green-500 border-green-500 text-white hover:bg-white hover:text-green-600'
                      }`}
                  >
                    {isUpdatingPhotographer
                      ? 'Processando...'
                      : photographerActionDialog.type === 'delete'
                        ? 'Excluir definitivamente'
                        : photographerActionDialog.type === 'disable'
                          ? 'Desativar'
                          : 'Reativar'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Photographer Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-150 flex items-center justify-center p-4 md:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ scale: 0.96, y: 18 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 18 }}
              className="relative w-full max-w-2xl max-h-[92vh] bg-[#0d131c] border border-white/15 shadow-[0_30px_90px_rgba(0,0,0,0.55)] text-white overflow-y-auto"
            >
              <div className="h-1.5 bg-brutal-accent" />
              <button
                onClick={() => setShowAddModal(false)}
                className="absolute top-5 right-5 p-2 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Fechar modal"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="p-7 md:p-9 border-b border-white/10">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-brutal-accent/10 border border-brutal-accent/30 text-brutal-accent font-mono text-[10px] uppercase tracking-widest mb-5">
                  <Users className="w-3.5 h-3.5" />
                  Credenciamento
                </div>
                <h3 className="font-sans font-black text-3xl md:text-4xl uppercase tracking-normal mb-2">Novo Fotógrafo</h3>
                <p className="font-mono text-xs text-gray-500 uppercase tracking-widest">Cadastro operacional para equipe de mídia</p>
              </div>

              <form onSubmit={handleAddPhotographer} className="p-7 md:p-9 space-y-6">
                <div className="space-y-2">
                  <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Nome Completo</label>
                  <div className="relative">
                    <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      required
                      type="text"
                      value={newPhotographer.name}
                      onChange={e => setNewPhotographer({ ...newPhotographer, name: e.target.value })}
                      placeholder="Nome exibido no marketplace"
                      className="w-full h-14 pl-12 pr-4 bg-[#080d14] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm outline-none focus:border-brutal-accent transition-colors"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Email de Acesso</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      required
                      type="email"
                      value={newPhotographer.email}
                      onChange={e => setNewPhotographer({ ...newPhotographer, email: e.target.value })}
                      placeholder="fotografo@email.com"
                      className="w-full h-14 pl-12 pr-4 bg-[#080d14] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm outline-none focus:border-brutal-accent transition-colors"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Instagram</label>
                  <input
                    type="text"
                    value={newPhotographer.instagram}
                    onChange={e => setNewPhotographer({ ...newPhotographer, instagram: e.target.value })}
                    placeholder="@usuario"
                    className="w-full h-14 px-4 bg-[#080d14] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm outline-none focus:border-brutal-accent transition-colors"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Bio / Especialidade</label>
                  <textarea
                    value={newPhotographer.bio}
                    onChange={e => setNewPhotographer({ ...newPhotographer, bio: e.target.value })}
                    placeholder="Ex.: Corridas de rua, ciclismo, trail, cobertura de chegada..."
                    className="w-full h-28 p-4 bg-[#080d14] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm outline-none focus:border-brutal-accent transition-colors resize-none"
                  />
                </div>

                <div className="bg-[#080d14] border border-white/10 p-4 flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-brutal-accent shrink-0 mt-0.5" />
                  <p className="font-mono text-[10px] uppercase leading-relaxed text-gray-400">
                    O sistema cria o registro e envia um convite por e-mail para o fotógrafo definir a senha de acesso ao painel.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-14 bg-brutal-accent text-white border border-brutal-accent font-sans font-black text-sm uppercase tracking-widest hover:bg-white hover:text-brutal-accent transition-colors cursor-pointer disabled:bg-gray-700 disabled:border-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Enviando convite...' : 'Cadastrar e Enviar Convite'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Photographer Modal */}
      <AnimatePresence>
        {editingPhotographer && (
          <div className="fixed inset-0 z-160 flex items-center justify-center p-4 md:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingPhotographer(null)}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />
            <motion.div
              initial={{ scale: 0.96, y: 18 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 18 }}
              className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto bg-[#0d131c] border border-white/15 shadow-[0_30px_90px_rgba(0,0,0,0.6)] text-white"
            >
              <div className="h-1.5 bg-brutal-accent" />
              <button
                type="button"
                onClick={() => setEditingPhotographer(null)}
                className="absolute top-5 right-5 p-2 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Fechar modal"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="p-7 md:p-9 border-b border-white/10">
                <div className="flex flex-col md:flex-row md:items-center gap-5 pr-10">
                  <div className="w-20 h-20 bg-white/10 border border-white/15 overflow-hidden flex items-center justify-center shrink-0">
                    {editForm.avatar ? (
                      <img src={editForm.avatar} alt={editForm.name || editingPhotographer.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="font-sans font-black text-xl text-white">
                        {(editForm.name || editingPhotographer.name || 'FT').slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-brutal-accent mb-2">Perfil operacional</p>
                    <h3 className="font-sans font-black text-3xl md:text-4xl uppercase tracking-normal">Editar Fotógrafo</h3>
                    <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest truncate mt-2">{editingPhotographer.email}</p>
                    <p className="font-mono text-[9px] text-gray-600 uppercase truncate mt-1">ID {editingPhotographer.id}</p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSavePhotographer} className="p-7 md:p-9 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-2 md:col-span-2">
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Nome exibido</label>
                    <input
                      required
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm((current) => ({ ...current, name: e.target.value }))}
                      className="w-full h-14 px-4 bg-[#080d14] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm outline-none focus:border-brutal-accent transition-colors"
                      placeholder="Nome do fotógrafo"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">CPF</label>
                    <input
                      type="text"
                      value={editForm.cpf}
                      onChange={(e) => setEditForm((current) => ({ ...current, cpf: formatCpf(e.target.value) }))}
                      className="w-full h-14 px-4 bg-[#080d14] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm outline-none focus:border-brutal-accent transition-colors"
                      placeholder="000.000.000-00"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Telefone</label>
                    <input
                      type="text"
                      value={editForm.phone}
                      onChange={(e) => setEditForm((current) => ({ ...current, phone: e.target.value }))}
                      className="w-full h-14 px-4 bg-[#080d14] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm outline-none focus:border-brutal-accent transition-colors"
                      placeholder="(00) 00000-0000"
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Instagram</label>
                    <input
                      type="text"
                      value={editForm.instagram}
                      onChange={(e) => setEditForm((current) => ({ ...current, instagram: e.target.value }))}
                      className="w-full h-14 px-4 bg-[#080d14] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm outline-none focus:border-brutal-accent transition-colors"
                      placeholder="@usuario"
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Avatar URL</label>
                    <input
                      type="url"
                      value={editForm.avatar}
                      onChange={(e) => setEditForm((current) => ({ ...current, avatar: e.target.value }))}
                      className="w-full h-14 px-4 bg-[#080d14] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm outline-none focus:border-brutal-accent transition-colors"
                      placeholder="https://..."
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Bio</label>
                    <textarea
                      value={editForm.bio}
                      onChange={(e) => setEditForm((current) => ({ ...current, bio: e.target.value }))}
                      className="w-full h-28 p-4 bg-[#080d14] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm outline-none focus:border-brutal-accent transition-colors resize-none"
                      placeholder="Resumo do fotógrafo, especialidade ou observações internas."
                    />
                  </div>
                </div>

                <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingPhotographer(null)}
                    className="h-13 sm:h-14 flex-1 border border-white/15 text-gray-300 font-mono text-xs uppercase tracking-widest hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    disabled={isUpdatingPhotographer}
                    type="submit"
                    className="h-13 sm:h-14 flex-1 bg-brutal-accent text-white border border-brutal-accent font-sans font-black text-sm uppercase tracking-widest hover:bg-white hover:text-brutal-accent transition-colors cursor-pointer disabled:bg-gray-700 disabled:border-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    {isUpdatingPhotographer ? 'Salvando...' : 'Salvar alterações'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AdminSidebarLink({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-4 px-4 py-4 font-mono text-xs uppercase tracking-widest transition-all cursor-pointer ${active
        ? 'bg-brutal-accent/80 text-white border border-brutal-accent shadow-[0_0_24px_rgba(255,78,0,0.22)]'
        : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
        }`}
    >
      <span className={active ? 'text-white' : 'text-gray-500'}>
        {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: 'w-5 h-5' })}
      </span>
      {label}
    </button>
  );
}

function ReportCard({ title, emptyLabel, rows }: { title: string; emptyLabel: string; rows: Array<{ id: string; title: string; subtitle: string; value: string }> }) {
  return (
    <div className="bg-[#0d131c] p-6 border border-white/10">
      <h3 className="font-sans font-black text-base uppercase mb-6 text-white">{title}</h3>
      {rows.length > 0 ? (
        <div className="space-y-4">
          {rows.map((row, index) => (
            <div key={row.id} className="flex items-center justify-between gap-4 border-b border-white/10 pb-4 last:border-0 last:pb-0">
              <div className="flex items-center gap-4 min-w-0">
                <span className="w-8 h-8 bg-white/5 text-white border border-white/10 flex items-center justify-center font-display text-sm">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-sans font-bold text-sm uppercase truncate text-white">{row.title}</p>
                  <p className="font-mono text-[10px] text-gray-400 uppercase">{row.subtitle}</p>
                </div>
              </div>
              <p className="font-display text-xl text-brutal-accent shrink-0">{row.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-6 bg-white/5 border border-white/10 text-center">
          <p className="font-mono text-[10px] text-gray-400 uppercase">{emptyLabel}</p>
        </div>
      )}
    </div>
  );
}

function AdminStatCardReal({
  label,
  value,
  icon,
  sub,
  trend,
  previousValue,
  bars,
  accent = false,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  sub: string;
  trend: string;
  previousValue: number;
  bars: number[];
  accent?: boolean;
}) {
  const trendValue = Number(trend.replace('%', '').replace('+', '').replace(',', '.'));
  const trendColor = trendValue > 0 ? 'text-green-400' : trendValue < 0 ? 'text-red-300' : 'text-gray-400';
  const trendIcon = trendValue > 0 ? '↗' : trendValue < 0 ? '↘' : '→';

  return (
    <div className={`p-5 border border-white/10 bg-linear-to-br from-[#121923] to-[#0d131c] transition-all hover:-translate-y-1 hover:border-white/20 ${accent ? 'text-white' : 'text-white'
      }`}>
      <div className="flex items-center justify-between mb-6">
        <div className={`p-3 rounded-md ${accent ? 'bg-brutal-accent' : 'bg-white/10'}`}>
          {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: 'w-6 h-6 text-white' })}
        </div>
        <span
          className={`font-mono text-[10px] font-bold uppercase tracking-widest ${trendColor}`}
          title={`Periodo anterior: ${previousValue}`}
        >
          {trendIcon} {trend}
        </span>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] mb-2 text-gray-400">{label}</p>
      <p className="font-sans font-black text-3xl tracking-normal text-white">{value}</p>
      <p className="font-mono text-[10px] mt-4 uppercase leading-relaxed text-gray-400">{sub}</p>
      <div className="mt-6 flex items-end gap-1 h-9 opacity-80">
        {bars.map((height, index) => (
          <span
            key={index}
            className={`flex-1 ${accent ? 'bg-brutal-accent' : 'bg-blue-500'}`}
            style={{ height }}
          />
        ))}
      </div>
    </div>
  );
}
