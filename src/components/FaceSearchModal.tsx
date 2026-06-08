import { Camera, ImagePlus, Loader2, RotateCcw, ScanFace, Search, ShieldCheck, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import React from 'react';
import { productService } from '../lib/services';
import type { FaceSearchMatch } from '../types';

interface FaceSearchModalProps {
  isOpen: boolean;
  eventName: string;
  onClose: () => void;
  onSearch: (file: File, sessionId: string) => Promise<FaceSearchMatch[]>;
}

const maxSelfieBytes = 8 * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const consentStorageKey = 'funpace:face-search-consent';
const consentTtlMs = 30 * 24 * 60 * 60 * 1000;

type StoredConsent = {
  sessionId: string;
  acceptedAt: string;
  expiresAt: string;
};

function validateSelfie(file: File) {
  if (!allowedTypes.has(file.type.toLowerCase())) {
    return 'Formato inválido. Envie uma selfie JPG ou PNG.';
  }
  if (file.size > maxSelfieBytes) {
    return 'Imagem muito grande. Envie uma selfie de até 8 MB.';
  }
  return '';
}

function createFaceSearchSessionId() {
  return `face-${crypto.randomUUID()}`;
}

function readStoredConsent(): StoredConsent | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(consentStorageKey) || 'null') as StoredConsent | null;
    if (!parsed?.sessionId || !parsed.expiresAt) return null;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearStoredConsent() {
  localStorage.removeItem(consentStorageKey);
}

function saveStoredConsent(input: { sessionId: string; acceptedAt?: string; expiresAt?: string }) {
  const acceptedAt = input.acceptedAt || new Date().toISOString();
  const expiresAt = input.expiresAt || new Date(Date.now() + consentTtlMs).toISOString();
  const stored = { sessionId: input.sessionId, acceptedAt, expiresAt };
  localStorage.setItem(consentStorageKey, JSON.stringify(stored));
  return stored;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function dataUrlToBlob(dataUrl: string) {
  const [header, payload] = dataUrl.split(',');
  const mime = header.match(/data:(.*?);base64/)?.[1] || 'image/jpeg';
  const binary = window.atob(payload || '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

export function FaceSearchModal({ isOpen, eventName, onClose, onSearch }: FaceSearchModalProps) {
  const galleryInputRef = React.useRef<HTMLInputElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const fileRef = React.useRef<File | null>(null);
  const previewObjectUrlRef = React.useRef('');
  const [file, setFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState('');
  const [error, setError] = React.useState('');
  const [isSearching, setIsSearching] = React.useState(false);
  const [isCameraLoading, setIsCameraLoading] = React.useState(false);
  const [isCameraReady, setIsCameraReady] = React.useState(false);
  const [isCapturing, setIsCapturing] = React.useState(false);
  const [consent, setConsent] = React.useState<StoredConsent | null>(null);
  const [showConsent, setShowConsent] = React.useState(true);

  const stopCamera = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraReady(false);
  }, []);

  const updateSelfieFile = React.useCallback((nextFile: File | null) => {
    fileRef.current = nextFile;
    setFile(nextFile);
    console.log('State selfie atualizado', nextFile ? {
      name: nextFile.name,
      size: nextFile.size,
      type: nextFile.type,
    } : null);
  }, []);

  const updatePreviewUrl = React.useCallback((nextUrl: string) => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = '';
    }
    previewObjectUrlRef.current = nextUrl.startsWith('blob:') ? nextUrl : '';
    setPreviewUrl(nextUrl);
    console.log('Preview atualizado', { hasPreview: Boolean(nextUrl) });
  }, []);

  const clearFile = React.useCallback(() => {
    updateSelfieFile(null);
    setError('');
    updatePreviewUrl('');
    if (galleryInputRef.current) galleryInputRef.current.value = '';
  }, [updatePreviewUrl, updateSelfieFile]);

  const attachCameraStream = React.useCallback(async () => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return false;

    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');

    await video.play().catch(() => undefined);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setIsCameraReady(true);
        return true;
      }
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        setIsCameraReady(true);
        return true;
      }
      await wait(100);
    }

    return false;
  }, []);

  const openCamera = React.useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Seu navegador não oferece suporte à câmera. Use a opção de carregar foto.');
      return;
    }
    setError('');
    setIsCameraLoading(true);
    clearFile();
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      await attachCameraStream();
      console.log('Camera aberta');
    } catch {
      setError('Precisamos de acesso à câmera para realizar a busca facial. Verifique as permissões do navegador e tente novamente.');
    } finally {
      setIsCameraLoading(false);
    }
  }, [attachCameraStream, clearFile, stopCamera]);

  React.useEffect(() => {
    if (!isOpen) {
      clearFile();
      stopCamera();
      setShowConsent(true);
      return;
    }

    const stored = readStoredConsent();
    setConsent(stored);
    setShowConsent(!stored);
    if (stored) {
      window.setTimeout(() => {
        openCamera().catch(() => undefined);
      }, 80);
    }
    return () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = '';
      }
    };
  }, [clearFile, isOpen, openCamera, stopCamera]);

  const selectFile = (nextFile?: File) => {
    if (!nextFile) return;
    const validationError = validateSelfie(nextFile);
    if (validationError) {
      clearFile();
      setError(validationError);
      return;
    }
    setError('');
    updateSelfieFile(nextFile);
    updatePreviewUrl(URL.createObjectURL(nextFile));
    stopCamera();
  };

  const setCapturedSelfie = (blob: Blob) => {
    const capturedFile = new File([blob], `selfie-${Date.now()}.jpg`, { type: 'image/jpeg' });
    const validationError = validateSelfie(capturedFile);
    if (validationError) {
      clearFile();
      setError(validationError);
      return;
    }
    setError('');
    console.log('File criado', capturedFile);
    updateSelfieFile(capturedFile);
    updatePreviewUrl(URL.createObjectURL(capturedFile));
    stopCamera();
  };

  const acceptConsent = async () => {
    setError('');
    setIsCameraLoading(true);
    const sessionId = consent?.sessionId || createFaceSearchSessionId();
    try {
      const recorded = await productService.recordFaceSearchConsent(sessionId);
      const stored = saveStoredConsent({ sessionId, acceptedAt: recorded.acceptedAt, expiresAt: recorded.expiresAt });
      setConsent(stored);
      setShowConsent(false);
      window.setTimeout(() => {
        openCamera().catch(() => undefined);
      }, 80);
    } catch (consentError) {
      setError(consentError instanceof Error ? consentError.message : 'Não foi possível registrar o consentimento.');
    } finally {
      setIsCameraLoading(false);
    }
  };

  const captureSelfie = async () => {
    setError('');
    setIsCapturing(true);
    try {
      const video = videoRef.current;
      if (!video || !streamRef.current) {
        setError('Câmera não está aberta. Toque em tirar novamente e permita o acesso.');
        return;
      }

      if (video.paused) {
        await video.play().catch(() => undefined);
      }

      if (!isCameraReady) {
        await attachCameraStream();
      }

      await wait(120);
      const rect = video.getBoundingClientRect();
      const trackSettings = streamRef.current.getVideoTracks()[0]?.getSettings?.() || {};
      const width = video.videoWidth || trackSettings.width || Math.round(rect.width);
      const height = video.videoHeight || trackSettings.height || Math.round(rect.height);
      if (!width || !height) {
        setError('Câmera ainda não está pronta. Tente novamente em alguns instantes.');
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        setError('Não foi possível capturar a selfie neste navegador.');
        return;
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = dataUrlToBlob(canvas.toDataURL('image/jpeg', 0.9));
      console.log('Blob criado', blob);
      if (!blob || blob.size === 0) {
        setError('Não foi possível gerar a selfie. Tente novamente.');
        return;
      }

      console.log('Foto capturada');
      setCapturedSelfie(blob);
    } catch (captureError) {
      console.error('[face-search] selfie:capture-error', captureError);
      setError('Não foi possível capturar a selfie neste navegador. Tente carregar uma foto da galeria.');
    } finally {
      setIsCapturing(false);
    }
  };

  const submit = async () => {
    const selectedFile = fileRef.current || file;
    console.log('Iniciando busca facial', selectedFile ? {
      name: selectedFile.name,
      size: selectedFile.size,
      type: selectedFile.type,
    } : null);
    if (!selectedFile) {
      setError('Tire uma selfie ou carregue uma foto antes de iniciar a busca.');
      return;
    }
    const activeConsent = consent || readStoredConsent();
    if (!activeConsent) {
      setShowConsent(true);
      setError('Permissão para uso de imagem necessária antes da busca facial.');
      return;
    }
    setError('');
    setIsSearching(true);
    try {
      const matches = await onSearch(selectedFile, activeConsent.sessionId);
      if (matches.length === 0) {
        setError('Nenhuma foto sua foi encontrada neste evento. Tente utilizar outra selfie.');
        return;
      }
      onClose();
    } catch (searchError) {
      const message = searchError instanceof Error ? searchError.message : 'Não foi possível buscar suas fotos.';
      if (/permiss[aã]o|consentimento/i.test(message)) {
        clearStoredConsent();
        setConsent(null);
        setShowConsent(true);
      }
      setError(message);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-140 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <motion.button
            type="button"
            aria-label="Fechar busca facial"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={isSearching ? undefined : onClose}
            className="absolute inset-0 bg-brutal-black/85 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.98 }}
            className="relative max-h-[95vh] w-full max-w-3xl overflow-y-auto bg-white brutal-border brutal-shadow-heavy"
          >
            <div className="border-b-2 border-brutal-black bg-brutal-accent p-5 sm:p-7">
              <button
                type="button"
                onClick={onClose}
                disabled={isSearching}
                className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center brutal-border bg-white transition-colors hover:bg-brutal-black hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="flex items-start gap-4 pr-12">
                <div className="hidden h-14 w-14 shrink-0 items-center justify-center brutal-border bg-brutal-black text-white sm:flex">
                  <ScanFace className="h-7 w-7" />
                </div>
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.28em]">Reconhecimento facial</p>
                  <h2 className="mt-2 font-display text-3xl uppercase leading-none sm:text-5xl">Encontre suas fotos</h2>
                  <p className="mt-3 font-mono text-xs uppercase leading-relaxed text-brutal-black/70">{eventName}</p>
                </div>
              </div>
            </div>

            {showConsent ? (
              <div className="p-5 sm:p-8">
                <div className="mx-auto max-w-2xl text-center">
                  <h3 className="font-display text-3xl uppercase text-brutal-accent sm:text-4xl">Permissão para Uso de Imagem</h3>
                  <p className="mt-5 text-base leading-relaxed text-gray-700">
                    Para encontrar suas fotos em nosso banco de dados, precisamos que você envie uma selfie. Sua privacidade é nossa prioridade, e seus dados serão tratados de acordo com a Lei Geral de Proteção de Dados (LGPD).
                  </p>
                  <div className="mt-6 rounded-2xl bg-gray-50 p-5 text-left text-sm leading-relaxed text-gray-700">
                    <p className="mb-3 text-center font-display text-xl uppercase text-brutal-accent">Como usamos sua imagem:</p>
                    <ul className="space-y-2">
                      <li>Sua foto será utilizada exclusivamente para localizar suas fotos por meio do reconhecimento facial.</li>
                      <li>Não compartilhamos sua imagem com terceiros.</li>
                      <li>Caso a opção de armazenamento não seja marcada, a selfie será removida após o processamento.</li>
                      <li>Você poderá solicitar a exclusão dos dados a qualquer momento.</li>
                    </ul>
                  </div>
                  <p className="mt-5 font-mono text-[10px] uppercase leading-relaxed tracking-widest text-gray-500">
                    Leia nossa <a href="/privacidade" className="font-bold text-brutal-black underline hover:text-brutal-accent">Política de Privacidade</a> e nossos <a href="/termos" className="font-bold text-brutal-black underline hover:text-brutal-accent">Termos de Uso</a>.
                  </p>
                  {error && (
                    <div role="alert" className="mt-5 border-2 border-red-500 bg-red-50 p-3 font-mono text-[10px] uppercase leading-relaxed text-red-700">
                      {error}
                    </div>
                  )}
                  <div className="mt-8 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={onClose}
                      disabled={isCameraLoading}
                      className="inline-flex min-h-14 items-center justify-center rounded-full bg-gray-100 px-6 font-display text-base uppercase text-brutal-black transition-colors hover:bg-white disabled:opacity-60"
                    >
                      Discordo
                    </button>
                    <button
                      type="button"
                      onClick={acceptConsent}
                      disabled={isCameraLoading}
                      className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-brutal-accent px-6 font-display text-base uppercase text-white shadow-[0_12px_28px_rgba(255,77,0,0.28)] transition-colors hover:bg-brutal-black disabled:cursor-wait disabled:opacity-70"
                    >
                      {isCameraLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
                      Estou ciente
                    </button>
                  </div>
                </div>
              </div>
            ) : (
            <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_280px]">
              <div>
                {previewUrl ? (
                  <div className="relative aspect-square max-h-105 overflow-hidden bg-gray-100 brutal-border">
                    <img src={previewUrl} alt="Preview da selfie" className="h-full w-full object-cover" />
                    {!isSearching && (
                      <div className="absolute bottom-4 left-4 right-4 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => galleryInputRef.current?.click()}
                          className="inline-flex min-h-12 items-center justify-center gap-2 bg-white px-3 font-display text-xs uppercase brutal-border brutal-shadow-hover sm:text-sm"
                        >
                          <ImagePlus className="h-4 w-4" />
                          Trocar selfie
                        </button>
                        <button
                          type="button"
                          onClick={openCamera}
                          className="inline-flex min-h-12 items-center justify-center gap-2 bg-brutal-black px-3 font-display text-xs uppercase text-white brutal-border brutal-shadow-hover sm:text-sm"
                        >
                          <RotateCcw className="h-4 w-4" />
                          Tirar novamente
                        </button>
                      </div>
                    )}
                    {isSearching && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-brutal-black/80 p-6 text-center text-white backdrop-blur-sm">
                        <Loader2 className="h-12 w-12 animate-spin text-brutal-accent" />
                        <span className="font-display text-xl uppercase tracking-widest">Procurando suas fotos...</span>
                        <span className="font-mono text-[10px] uppercase tracking-widest text-white/70">Comparando seu rosto com as fotos do evento</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex aspect-square max-h-105 w-full flex-col items-center justify-center gap-4 bg-gray-50 p-6 text-center brutal-border sm:p-8">
                    <div className="relative aspect-square w-full max-w-md overflow-hidden rounded-2xl bg-brutal-black">
                      <video
                        ref={videoRef}
                        className="h-full w-full object-cover"
                        playsInline
                        muted
                        autoPlay
                        onLoadedMetadata={() => setIsCameraReady(true)}
                        onCanPlay={() => setIsCameraReady(true)}
                      />
                      {(isCameraLoading || isCapturing || !isCameraReady) && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-brutal-black/80 text-white">
                          <Loader2 className="h-10 w-10 animate-spin text-brutal-accent" />
                          <span className="font-mono text-[10px] uppercase tracking-widest">{isCapturing ? 'Capturando selfie...' : isCameraLoading ? 'Abrindo câmera...' : 'Preparando câmera...'}</span>
                        </div>
                      )}
                    </div>
                    <span className="font-mono text-[10px] uppercase leading-relaxed tracking-widest text-gray-500">Câmera frontal quando disponível</span>
                    <div className="mt-2 grid w-full max-w-sm gap-3 sm:grid-cols-2">
                      <button type="button" onClick={captureSelfie} disabled={isSearching || isCameraLoading || isCapturing} className="inline-flex min-h-13 items-center justify-center gap-2 bg-brutal-accent px-4 font-display text-sm uppercase text-white brutal-border brutal-shadow-hover disabled:opacity-50">
                        {isCapturing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                        {isCapturing ? 'Capturando...' : 'Tirar selfie'}
                      </button>
                      <button type="button" onClick={() => galleryInputRef.current?.click()} disabled={isSearching} className="inline-flex min-h-13 items-center justify-center gap-2 bg-white px-4 font-display text-sm uppercase brutal-border brutal-shadow-hover disabled:opacity-50">
                        <ImagePlus className="h-5 w-5" />
                        Carregar foto
                      </button>
                    </div>
                  </div>
                )}
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  className="sr-only"
                  onChange={(event) => selectFile(event.target.files?.[0])}
                />
              </div>

              <div className="flex flex-col">
                <div className="space-y-4 font-mono text-[11px] uppercase leading-relaxed text-gray-600">
                  <p className="font-bold text-brutal-black">Para melhores resultados:</p>
                  <p>Use uma foto nítida, de frente e bem iluminada.</p>
                  <p>Evite óculos escuros, capacete ou outras pessoas na imagem.</p>
                  <div className="flex items-start gap-2 border-t-2 border-dashed border-gray-200 pt-4 text-gray-500">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brutal-accent" />
                    <span>A selfie é usada somente durante a busca e removida após o processamento.</span>
                  </div>
                </div>

                {error && (
                  <div role="alert" className="mt-5 border-2 border-red-500 bg-red-50 p-3 font-mono text-[10px] uppercase leading-relaxed text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="button"
                  onClick={submit}
                  disabled={isSearching || isCapturing}
                  className="mt-6 inline-flex min-h-14 w-full items-center justify-center gap-3 bg-brutal-black px-5 font-display text-base uppercase tracking-widest text-white brutal-border brutal-shadow-hover hover:bg-brutal-accent disabled:cursor-wait disabled:opacity-70 md:mt-auto"
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Procurando suas fotos...
                    </>
                  ) : (
                    <>
                      <Search className="h-5 w-5" />
                      Usar esta selfie
                    </>
                  )}
                </button>
              </div>
            </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
