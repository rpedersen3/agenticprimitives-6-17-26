// Lightweight, dependency-free toast system for demo-gs (control kit). A context-based toaster that
// stacks fixed bottom-right + auto-dismisses (~3.5s) with a manual close. Styled with the index.html
// palette classes (.toast / .toast-ok / .toast-err / .toast-info) — no external deps.
//
// Usage: mount <ToastProvider> once at the App root (it renders the ToastHost). Call useToast() in any
// descendant → toast(message, tone?). Used OUTSIDE a provider the hook no-ops gracefully (so components
// stay testable / renderable in isolation), per the task's "must no-op gracefully" requirement.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastTone = 'ok' | 'err' | 'info';
export type ToastFn = (message: string, tone?: ToastTone) => void;

interface ToastItem { id: number; message: string; tone: ToastTone; leaving: boolean }

const AUTO_DISMISS_MS = 3500;
const LEAVE_MS = 200; // matches the .toast-out animation duration in index.html

// Default context value is a no-op so useToast() never throws outside a provider.
const ToastContext = createContext<ToastFn>(() => { /* no provider mounted — no-op */ });

export function useToast(): ToastFn {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const remove = useCallback((id: number) => {
    // Trigger the leave animation, then drop the item.
    setItems((cur) => cur.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    timers.current.set(id, setTimeout(() => {
      setItems((cur) => cur.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, LEAVE_MS));
  }, []);

  const toast = useCallback<ToastFn>((message, tone = 'info') => {
    const id = nextId.current++;
    setItems((cur) => [...cur, { id, message, tone, leaving: false }]);
    setTimeout(() => remove(id), AUTO_DISMISS_MS);
  }, [remove]);

  // Stable context value so descendants don't re-render on every toast change.
  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost items={items} onClose={remove} />
    </ToastContext.Provider>
  );
}

function ToastHost({ items, onClose }: { items: ToastItem[]; onClose: (id: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}${t.leaving ? ' leaving' : ''}`}>
          <span className="toast-msg">{t.message}</span>
          <button className="toast-x" aria-label="Dismiss" onClick={() => onClose(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
