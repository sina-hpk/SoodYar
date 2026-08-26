import { useEffect, useState } from "react";
import { Save, DatabaseBackup, Download } from "lucide-react";
import { api, exportUrl } from "../lib/api";
import { Card, PageHeader, RiskNotice, Empty } from "../components/ui";
import { useToast } from "../components/Toast";
import { useSettings } from "../context/SettingsContext";
import { formatMoney, toJalali, toPersianDigits } from "../lib/format";

export default function Settings() {
  const toast = useToast();
  const { refresh, setCurrency } = useSettings();
  const [form, setForm] = useState({
    default_nav_per_unit: "1000000",
    currency: "RIAL",
    withdrawal_wait_days: "3",
    backup_enabled: "true",
  });
  const [backups, setBackups] = useState<{ file: string; size: number; createdAt: string }[]>([]);

  async function load() {
    try {
      const s = await api.settings();
      setForm({
        default_nav_per_unit: s.default_nav_per_unit ?? "1000000",
        currency: s.currency ?? "RIAL",
        withdrawal_wait_days: s.withdrawal_wait_days ?? "3",
        backup_enabled: s.backup_enabled ?? "true",
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
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
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
