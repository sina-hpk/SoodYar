import { useEffect, useState } from "react";
import { Save, DatabaseBackup, Download, Check } from "lucide-react";
import { api, exportUrl } from "../lib/api";
import { Card, PageHeader, RiskNotice, Empty } from "../components/ui";
import { useToast } from "../components/Toast";
import { useSettings } from "../context/SettingsContext";
import { formatMoney, toJalali, toPersianDigits } from "../lib/format";
import { cn } from "../lib/cn";
import { THEME_OPTIONS, type ThemeId } from "../lib/theme";

export default function Settings() {
  const toast = useToast();
  const { refresh, setCurrency, theme, setTheme } = useSettings();
  const [form, setForm] = useState({
    default_nav_per_unit: "1000000",
    currency: "RIAL",
    withdrawal_wait_days: "3",
    backup_enabled: "true",
    auto_price_refresh_minutes: "60",
  });
  const [backups, setBackups] = useState<{ file: string; size: number; createdAt: string }[]>([]);
  const [savingTheme, setSavingTheme] = useState(false);

  async function load() {
    try {
      const s = await api.settings();
      setForm({
        default_nav_per_unit: s.default_nav_per_unit ?? "1000000",
        currency: s.currency ?? "RIAL",
        withdrawal_wait_days: s.withdrawal_wait_days ?? "3",
        backup_enabled: s.backup_enabled ?? "true",
        auto_price_refresh_minutes: s.auto_price_refresh_minutes ?? "60",
      });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function loadBackups() {
    try {
      setBackups(await api.listBackups());
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    load();
    loadBackups();
  }, []);

  async function saveSetting(key: string, value: string) {
    try {
      await api.updateSetting(key, value);
      toast("ذخیره شد", "success");
      if (key === "currency") setCurrency(value as "RIAL" | "TOMAN");
      if (key === "theme") setTheme(value as ThemeId);
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  /** Theme is applied instantly on click and persisted right away. */
  async function changeTheme(next: ThemeId) {
    if (next === theme || savingTheme) return;
    setSavingTheme(true);
    try {
      await saveSetting("theme", next);
    } finally {
      setSavingTheme(false);
    }
  }

  async function createBackup() {
    try {
      const r = await api.createBackup();
      toast(`بکاپ ساخته شد: ${r.file}`, "success");
      loadBackups();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="تنظیمات" subtitle="پیکربندی سیستم و مدیریت بکاپ" />
      <RiskNotice />

      <Card>
        <h3 className="mb-4 font-semibold text-slate-700">تنظیمات مالی</h3>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className="label">NAV اولیه هر واحد (ریال)</label>
            <div className="flex gap-2">
              <input
                className="input tabular"
                value={form.default_nav_per_unit}
                onChange={(e) => setForm({ ...form, default_nav_per_unit: e.target.value })}
              />
              <button
                className="btn-secondary"
                onClick={() => saveSetting("default_nav_per_unit", form.default_nav_per_unit)}
              >
                <Save size={16} />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              تنها زمانی استفاده می‌شود که هنوز هیچ واحدی صادر نشده باشد.
            </p>
          </div>

          <div>
            <label className="label">واحد پول نمایش</label>
            <div className="flex gap-2">
              <select
                className="input"
                value={form.currency}
                onChange={(e) => {
                  setForm({ ...form, currency: e.target.value });
                }}
              >
                <option value="RIAL">ریال</option>
                <option value="TOMAN">تومان</option>
              </select>
              <button className="btn-secondary" onClick={() => saveSetting("currency", form.currency)}>
                <Save size={16} />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              ذخیره‌سازی همیشه بر مبنای ریال است؛ این فقط نمایش را تغییر می‌دهد.
            </p>
          </div>

          <div>
            <label className="label">روزهای انتظار تسویه برداشت</label>
            <div className="flex gap-2">
              <input
                className="input tabular"
                value={form.withdrawal_wait_days}
                onChange={(e) => setForm({ ...form, withdrawal_wait_days: e.target.value })}
              />
              <button
                className="btn-secondary"
                onClick={() => saveSetting("withdrawal_wait_days", form.withdrawal_wait_days)}
              >
                <Save size={16} />
              </button>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="mb-1 font-semibold text-slate-700">ظاهر برنامه</h3>
        <p className="mb-4 text-xs text-slate-500">
          تم رنگی برنامه؛ با کلیک روی هر گزینه بلافاصله ذخیره و اعمال می‌شود.
        </p>
        <div
          role="radiogroup"
          aria-label="تم رنگی برنامه"
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          {THEME_OPTIONS.map((opt) => {
            const active = theme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={savingTheme}
                onClick={() => changeTheme(opt.id)}
                className={cn(
                  "rounded-xl border p-3 text-start transition disabled:cursor-wait disabled:opacity-70",
                  active
                    ? "border-brand-500 ring-2 ring-brand-400/30"
                    : "border-slate-200 hover:bg-slate-50"
                )}
              >
                <span className="mb-2 flex items-center gap-1.5" aria-hidden="true">
                  {opt.swatch.map((color) => (
                    <span
                      key={color}
                      className="h-6 w-6 rounded-md border border-slate-200"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-700">{opt.label}</span>
                  {active && <Check size={16} className="text-brand-600" aria-hidden="true" />}
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-400">{opt.hint}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <h3 className="mb-1 font-semibold text-slate-700">قیمت‌گیری خودکار</h3>
        <p className="mb-4 text-xs leading-6 text-slate-500">
          سرور هر چند وقت یک‌بار قیمت دارایی‌ها را از بازار می‌گیرد و به‌عنوان قیمت امروز ثبت می‌کند. قیمتی که
          خودتان در همان روز وارد کرده باشید بازنویسی نمی‌شود. منبع فعلی TGJU است و ارز، طلا، نقره، سکه، رمزارز و
          صندوق‌های کالایی را پوشش می‌دهد؛ سهام و صندوق‌های بورسی تهران (TSETMC) از این دستگاه در دسترس نیستند و
          دستی می‌مانند.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(220px,1fr)_auto] sm:items-end">
          <div>
            <label className="label">فاصلهٔ به‌روزرسانی خودکار</label>
            <select
              className="input"
              value={form.auto_price_refresh_minutes}
              onChange={(event) =>
                setForm({ ...form, auto_price_refresh_minutes: event.target.value })
              }
            >
              <option value="0">غیرفعال</option>
              <option value="15">هر ۱۵ دقیقه</option>
              <option value="30">هر ۳۰ دقیقه</option>
              <option value="60">هر ۱ ساعت</option>
              <option value="180">هر ۳ ساعت</option>
              <option value="720">هر ۱۲ ساعت</option>
            </select>
          </div>
          <button
            className="btn-secondary"
            onClick={() =>
              saveSetting("auto_price_refresh_minutes", form.auto_price_refresh_minutes)
            }
          >
            <Save size={16} /> ذخیره
          </button>
        </div>
        <p className="mt-3 text-xs leading-6 text-slate-400">
          برای اجرای فوری، در صفحهٔ پرتفوی دکمهٔ «قیمت‌های بازار» را بزنید.
        </p>
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">بکاپ و بازیابی</h3>
          <button className="btn-primary" onClick={createBackup}>
            <DatabaseBackup size={18} /> ساخت بکاپ جدید
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          بکاپ یک کپی از فایل SQLite در پوشه backups سرور ذخیره می‌کند. برای بازیابی،
          فایل بکاپ را جایگزین فایل پایگاه‌داده کرده و سرور را مجدداً راه‌اندازی کنید (راهنما در README).
        </p>
        {backups.length === 0 ? (
          <Empty>هنوز بکاپی ساخته نشده است.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">فایل</th>
                  <th className="th">حجم</th>
                  <th className="th">تاریخ</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.file} className="border-b border-slate-50">
                    <td className="td font-mono text-xs">{b.file}</td>
                    <td className="td tabular">{toPersianDigits((b.size / 1024).toFixed(0))} KB</td>
                    <td className="td">{toJalali(b.createdAt, "yyyy/MM/dd HH:mm")}</td>
                    <td className="td">
                      <a
                        className="text-brand-600 hover:underline"
                        href={exportUrl(`/backup/download/${b.file}`)}
                      >
                        <Download size={16} className="inline" /> دانلود
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
