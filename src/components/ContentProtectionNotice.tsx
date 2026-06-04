import { X } from 'lucide-react';

interface ContentProtectionNoticeProps {
  message: string;
  onClose: () => void;
}

export function ContentProtectionNotice({ message, onClose }: ContentProtectionNoticeProps) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 px-4">
      <div role="alertdialog" aria-modal="true" className="w-full max-w-lg bg-[#1f2937] p-6 text-white shadow-2xl brutal-border border-white/10">
        <div className="mb-5 flex items-start justify-between gap-4">
          <p className="whitespace-pre-line font-sans text-base leading-relaxed">{message}</p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-white/10 text-white transition-colors hover:bg-white hover:text-brutal-black"
            aria-label="Fechar aviso"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto block min-h-10 bg-white px-5 font-mono text-xs uppercase tracking-widest text-brutal-black brutal-border hover:bg-brutal-accent hover:text-white"
        >
          OK
        </button>
      </div>
    </div>
  );
}
