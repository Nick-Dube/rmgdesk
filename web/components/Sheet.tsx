'use client';

import { useEffect, type ReactNode } from 'react';

/** A bottom sheet on phones, a centred dialog on larger screens. Escape or the backdrop closes it. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Close" className="absolute inset-0 bg-stone-950/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-w-lg sm:rounded-3xl sm:p-6">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-stone-200 sm:hidden" />
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="-m-2 rounded-lg p-2 text-stone-500 hover:bg-stone-100" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PrimaryButton({ children, disabled, tone = 'navy', type = 'submit', onClick }: {
  children: ReactNode;
  disabled?: boolean;
  tone?: 'navy' | 'green' | 'red';
  type?: 'submit' | 'button';
  onClick?: () => void;
}) {
  const colour = tone === 'green' ? 'bg-emerald-700 hover:bg-emerald-800' : tone === 'red' ? 'bg-rose-700 hover:bg-rose-800' : 'bg-[#0b2545] hover:bg-[#08182e]';
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`w-full rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-50 ${colour}`}>
      {children}
    </button>
  );
}
