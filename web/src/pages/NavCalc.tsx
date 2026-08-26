import { useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { api, type NavPreview, type AssetValuation } from "../lib/api";
import { Card, PageHeader, StatCard, RiskNotice, Empty } from "../components/ui";
import { ConfirmDialog } from "../components/Modal";
import { JalaliDateInput } from "../components/JalaliDateInput";
import { useToast } from "../components/Toast";
import { useSettings } from "../context/SettingsContext";
import { formatMoney, formatUnits, todayIso, toJalali } from "../lib/format";

export default function NavCalc() {
  const { currency } = useSettings();
  const toast = useToast();
  const [preview, setPreview] = useState<NavPreview | null>(null);
  const [assets, setAssets] = useState<AssetValuation[]>([]);
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [priceDate, setPriceDate] = useState(todayIso());
  const [priceSource, setPriceSource] = useState<"MANUAL" | "API">("MANUAL");
  const [priceRef, setPriceRef] = useState("");
  const [navDate, setNavDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [liabilities, setLiabilities] = useState("0");
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  async function loadPreview() {
    try {
      const p = await api.navPreview();
      setPreview(p);
      setAssets(p.assets);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  useEffect(() => {
    loadPreview();
  }, []);

  async function savePrice(assetId: string) {
    const raw = priceInputs[assetId];
    if (!raw) return;
    try {
      await api.recordPrice({
        assetId,
        priceRial: Number(raw),
        priceDate,
        source: priceSource,
        sourceRef: priceRef || undefined,
      });
      toast("قیمت ثبت شد", "success");
      setPriceInputs((s) => ({ ...s, [assetId]: "" }));
      loadPreview();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function commit(overwrite: boolean) {
    try {
      await api.navCommit({
        navDate,
        liabilitiesRial: Number(liabilities) || 0,
        note,
        overwrite,
      });
      toast("NavSnapshot ثبت شد", "success");
      setConfirmOverwrite(false);
      loadPreview();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("قبلاً") && !overwrite) {
        setConfirmOverwrite(true);
      } else {
        toast(msg, "error");
        setConfirmOverwrite(false);
      }
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="محاسبه NAV"
        subtitle="ثبت قیمت روز دارایی‌ها و محاسبه شفاف خالص ارزش دارایی"
        action={
          <button className="btn-secondary" onClick={loadPreview}>
            <RefreshCw size={18} /> به‌روزرسانی
          </button>
        }
      />
      <RiskNotice />

      {/* Price entry */}
      <Card>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <h3 className="font-semibold text-slate-700">ثبت قیمت روز دارایی‌ها</h3>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">منبع قیمت</label>
              <select
                className="input w-auto"
                value={priceSource}
                onChange={(e) => setPriceSource(e.target.value as "MANUAL" | "API")}
              >
                <option value="MANUAL">دستی</option>
                <option value="API">API</option>
              </select>
            </div>
            <div>
              <label className="label">مرجع/توضیح منبع</label>
              <input
                className="input w-40"
                placeholder="اختیاری"
                value={priceRef}
                onChange={(e) => setPriceRef(e.target.value)}
              />
            </div>
            <div>
              <label className="label">تاریخ قیمت (شمسی)</label>
              <JalaliDateInput value={priceDate} onChange={setPriceDate} className="w-40" />
            </div>
          </div>
        </div>
        {assets.length === 0 ? (
          <Empty>دارایی‌ای برای قیمت‌گذاری نیست.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">نماد</th>
                  <th className="th">مقدار</th>
                  <th className="th">قیمت فعلی</th>
                  <th className="th">قیمت جدید (ریال)</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.assetId} className="border-b border-slate-50">
                    <td className="td">{a.symbol}</td>
                    <td className="td tabular">{formatUnits(a.quantity, 8)}</td>
                    <td className="td tabular">
                      {a.latestPriceRial ? formatMoney(a.latestPriceRial, currency) : "—"}
                      {a.priceDate && (
                        <span className="mr-1 text-xs text-slate-400">
                          ({toJalali(a.priceDate)})
                        </span>
                      )}
                    </td>
                    <td className="td">
                      <input
                        className="input tabular w-40"
                        value={priceInputs[a.assetId] ?? ""}
                        onChange={(e) =>
                          setPriceInputs((s) => ({ ...s, [a.assetId]: e.target.value }))
                        }
                      />
                    </td>
                    <td className="td">
                      <button className="btn-secondary" onClick={() => savePrice(a.assetId)}>
                        ثبت
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* NAV preview */}
      {preview && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="موجودی نقد" value={formatMoney(preview.cashBalanceRial, currency)} />
            <StatCard label="ارزش دارایی‌ها" value={formatMoney(preview.assetsValueRial, currency)} />
            <StatCard label="NAV کل" value={formatMoney(preview.totalNavRial, currency)} accent="text-brand-700" />
            <StatCard label="NAV هر واحد" value={formatMoney(preview.navPerUnit, currency)} />
          </div>

          <Card>
            <h3 className="mb-3 font-semibold text-slate-700">فرمول محاسبه (شفاف)</h3>
            <div className="space-y-1 rounded-lg bg-slate-50 p-4 text-sm text-slate-600 tabular">
              <div>موجودی نقد: {formatMoney(preview.cashBalanceRial, currency)}</div>
              <div>+ ارزش روز دارایی‌ها: {formatMoney(preview.assetsValueRial, currency)}</div>
              <div>− بدهی‌ها: {formatMoney(liabilities || "0", currency)}</div>
              <div className="border-t border-slate-200 pt-1 font-semibold text-slate-800">
                = NAV کل:{" "}
                {formatMoney(
                  String(
                    BigInt(preview.cashBalanceRial) +
                      BigInt(preview.assetsValueRial) -
                      BigInt(Math.round(Number(liabilities) || 0))
                  ),
                  currency
                )}
              </div>
              <div className="pt-1">
                ÷ واحدهای فعال: {formatUnits(preview.totalActiveUnits)} = NAV هر واحد:{" "}
                {formatMoney(preview.navPerUnit, currency)}
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="mb-4 font-semibold text-slate-700">ثبت NavSnapshot</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="label">تاریخ NAV (شمسی)</label>
                <JalaliDateInput value={navDate} onChange={setNavDate} />
              </div>
              <div>
                <label className="label">بدهی‌ها (ریال)</label>
                <input
                  className="input tabular"
                  value={liabilities}
                  onChange={(e) => setLiabilities(e.target.value)}
                />
              </div>
              <div>
                <label className="label">یادداشت</label>
                <input
                  className="input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4">
              <button className="btn-primary" onClick={() => commit(false)}>
                <Save size={18} /> ثبت NavSnapshot
              </button>
            </div>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={confirmOverwrite}
        title="ثبت تکراری برای این تاریخ"
        message="برای این تاریخ قبلاً NAV ثبت شده است. آیا می‌خواهید بازنویسی شود؟"
        confirmLabel="بله، بازنویسی کن"
        danger
        onConfirm={() => commit(true)}
        onCancel={() => setConfirmOverwrite(false)}
      />
    </div>
  );
}
