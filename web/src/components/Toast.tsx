import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

type Tone = "success" | "error" | "info";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

const Ctx = createContext<{ push: (m: string, t?: Tone) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Tone = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4000);
  }, []);

  const tones: Record<Tone, string> = {
    success: "bg-green-600",
    error: "bg-red-600",
    info: "bg-slate-800",
  };

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 left-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg px-4 py-2 text-sm text-white shadow-lg ${tones[t.tone]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx.push;
}
