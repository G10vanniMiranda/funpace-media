import { Camera, ImagePlus, Loader2, ScanFace, Search, ShieldCheck, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import React from 'react';
import type { FaceSearchMatch } from '../types';

interface FaceSearchModalProps {
  isOpen: boolean;
  eventName: string;
  onClose: () => void;
  onSearch: (file: File) => Promise<FaceSearchMatch[]>;
}

const maxSelfieBytes = 8 * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/jpg', 'image/png']);

function validateSelfie(file: File) {
  if (!allowedTypes.has(file.type.toLowerCase())) {
    return 'Formato invalido. Envie uma selfie JPG ou PNG.';
  }
  if (file.size > maxSelfieBytes) {
    return 'Imagem muito grande. Envie uma selfie de ate 8 MB.';
  }
  return '';
}

export function FaceSearchModal({ isOpen, eventName, onClose, onSearch }: FaceSearchModalProps) {
  const galleryInputRef = React.useRef<HTMLInputElement>(null);
  const cameraInputRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState('');
  const [error, setError] = React.useState('');
  const [isSearching, setIsSearching] = React.useState(false);

  const clearFile = React.useCallback(() => {
    setFile(null);
    setError('');
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });
    if (galleryInputRef.current) galleryInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  }, []);

  React.useEffect(() => {
    if (!isOpen) clearFile();
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [clearFile, isOpen, previewUrl]);

  const selectFile = (nextFile?: File) => {
    if (!nextFile) return;
    const validationError = validateSelfie(nextFile);
    if (validationError) {
      clearFile();
      setError(validationError);
      return;
    }
    setError('');
    setFile(nextFile);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(nextFile);
    });
  };

  const submit = async () => {
    if (!file) {
      setError('Selecione uma selfie antes de iniciar a busca.');
      return;
    }
    setError('');
    setIsSearching(true);
    try {
      await onSearch(file);
      onClose();
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Nao foi possivel buscar suas fotos.');
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
                          onClick={() => cameraInputRef.current?.click()}
                          className="inline-flex min-h-12 items-center justify-center gap-2 bg-brutal-black px-3 font-display text-xs uppercase text-white brutal-border brutal-shadow-hover sm:text-sm"
                        >
                          <Camera className="h-4 w-4" />
                          Tirar outra
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
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brutal-black text-white">
                      <ScanFace className="h-9 w-9" />
                    </div>
                    <span className="font-display text-2xl uppercase">Envie uma selfie</span>
                    <span className="font-mono text-[10px] uppercase leading-relaxed tracking-widest text-gray-500">JPG ou PNG, ate 8 MB</span>
                    <div className="mt-2 grid w-full max-w-sm gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => galleryInputRef.current?.click()}
                        disabled={isSearching}
                        className="inline-flex min-h-13 items-center justify-center gap-2 bg-white px-4 font-display text-sm uppercase brutal-border brutal-shadow-hover disabled:opacity-50"
                      >
                        <ImagePlus className="h-5 w-5" />
                        Galeria
                      </button>
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        disabled={isSearching}
                        className="inline-flex min-h-13 items-center justify-center gap-2 bg-brutal-accent px-4 font-display text-sm uppercase text-white brutal-border brutal-shadow-hover disabled:opacity-50"
                      >
                        <Camera className="h-5 w-5" />
                        Usar camera
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
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  className="sr-only"
                  onChange={(event) => selectFile(event.target.files?.[0])}
                />
              </div>

              <div className="flex flex-col">
                <div className="space-y-4 font-mono text-[11px] uppercase leading-relaxed text-gray-600">
                  <p className="font-bold text-brutal-black">Para melhores resultados:</p>
                  <p>Use uma foto nitida, de frente e bem iluminada.</p>
                  <p>Evite oculos escuros, capacete ou outras pessoas na imagem.</p>
                  <div className="flex items-start gap-2 border-t-2 border-dashed border-gray-200 pt-4 text-gray-500">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brutal-accent" />
                    <span>A selfie e usada somente durante a busca e removida apos o processamento.</span>
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
                  disabled={isSearching}
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
                      Buscar minhas fotos
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
