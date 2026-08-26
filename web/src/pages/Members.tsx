import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { UserPlus, Pencil, Trash2 } from "lucide-react";
import { api, type Member } from "../lib/api";
import { Card, PageHeader, Badge, Empty } from "../components/ui";
import { Modal, ConfirmDialog } from "../components/Modal";
import { JalaliDateInput } from "../components/JalaliDateInput";
import { useToast } from "../components/Toast";
import { useSettings } from "../context/SettingsContext";
import {
  formatMoney,
  formatUnits,
  formatPercent,
  toJalali,
  todayIso,
} from "../lib/format";

type MemberForm = {
  fullName: string;
  phone: string;
  email: string;
  nationalId: string;
  joinDate: string;
  status: "ACTIVE" | "INACTIVE";
  notes: string;
};

const emptyForm = (): MemberForm => ({
  fullName: "",
  phone: "",
  email: "",
  nationalId: "",
  joinDate: todayIso(),
  status: "ACTIVE",
  notes: "",
});

export default function Members() {
  const { currency } = useSettings();
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MemberForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Member | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try {
      setMembers(await api.members());
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setOpen(true);
  }

  function openEdit(m: Member) {
    setEditingId(m.id);
    setForm({
      fullName: m.fullName,
      phone: m.phone ?? "",
      email: m.email ?? "",
      nationalId: m.nationalId ?? "",
      joinDate: m.joinDate,
      status: m.status,
      notes: m.notes ?? "",
    });
    setOpen(true);
  }

  async function submit() {
    if (form.fullName.trim().length < 2) {
      toast("نام باید حداقل ۲ نویسه باشد", "error");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.updateMember(editingId, form);
        toast("اطلاعات عضو به‌روزرسانی شد", "success");
      } else {
        await api.createMember(form);
        toast("عضو جدید ثبت شد", "success");
      }
      setOpen(false);
      setEditingId(null);
      setForm(emptyForm());
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.deleteMember(toDelete.id);
      toast("عضو حذف شد", "success");
      setToDelete(null);
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="اعضا"
        subtitle="مدیریت سرمایه‌گذاران و مشاهده وضعیت هر عضو"
        action={
          <button className="btn-primary" onClick={openCreate}>
            <UserPlus size={18} /> عضو جدید
          </button>
        }
      />

      <Card>
        {members.length === 0 ? (
          <Empty>هنوز عضوی ثبت نشده است.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">نام</th>
                  <th className="th">وضعیت</th>
                  <th className="th">واحد فعال</th>
                  <th className="th">درصد مالکیت</th>
                  <th className="th">سرمایه خالص واردشده</th>
                  <th className="th">ارزش روز</th>
                  <th className="th">سود/زیان خالص ساده</th>
                  <th className="th">تاریخ عضویت</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const pnl = Number(m.summary?.simpleNetPnlRial ?? m.summary?.pnlRial ?? 0);
                  return (
                    <tr key={m.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="td font-medium">{m.fullName}</td>
                      <td className="td">
                        <Badge tone={m.status === "ACTIVE" ? "green" : "slate"}>
                          {m.status === "ACTIVE" ? "فعال" : "غیرفعال"}
                        </Badge>
                      </td>
                      <td className="td tabular">{formatUnits(m.summary?.activeUnits ?? "0")}</td>
                      <td className="td tabular">{formatPercent(m.summary?.ownershipPercent ?? "0")}</td>
                      <td className="td tabular">
                        {formatMoney(m.summary?.netContributedCapitalRial ?? "0", currency)}
                      </td>
                      <td className="td tabular">{formatMoney(m.summary?.currentValueRial ?? "0", currency)}</td>
                      <td className={`td tabular ${pnl >= 0 ? "text-green-600" : "text-red-600"}`}>
                        <div>{formatMoney(m.summary?.simpleNetPnlRial ?? "0", currency)}</div>
                        {m.summary?.simpleReturnPercent != null && (
                          <div className="text-xs opacity-80">{formatPercent(m.summary.simpleReturnPercent)}</div>
                        )}
                      </td>
                      <td className="td">{toJalali(m.joinDate)}</td>
                      <td className="td">
                        <div className="flex items-center gap-1">
                          <Link
                            to={`/members/${m.id}`}
                            className="text-brand-600 hover:underline"
                          >
                            جزئیات
                          </Link>
                          <button
                            className="rounded-md p-1.5 text-slate-500 hover:bg-brand-50 hover:text-brand-600"
                            title="ویرایش"
                            onClick={() => openEdit(m)}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                            title="حذف"
                            onClick={() => setToDelete(m)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? "ویرایش عضو" : "عضو جدید"}
        footer={
          <>
            <button className="btn-primary" onClick={submit} disabled={saving}>
              {saving ? "در حال ذخیره…" : "ذخیره"}
            </button>
            <button className="btn-secondary" onClick={() => setOpen(false)}>
              انصراف
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">نام و نام خانوادگی *</label>
            <input
              className="input"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </div>
          <div>
            <label className="label">شماره تماس</label>
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="label">کد ملی</label>
            <input
              className="input"
              value={form.nationalId}
              onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
            />
          </div>
          <div>
            <label className="label">ایمیل</label>
            <input
              className="input"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="label">تاریخ عضویت (شمسی)</label>
            <JalaliDateInput
              value={form.joinDate}
              onChange={(iso) => setForm({ ...form, joinDate: iso })}
            />
          </div>
          <div>
            <label className="label">وضعیت</label>
            <select
              className="input"
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as "ACTIVE" | "INACTIVE" })
              }
            >
              <option value="ACTIVE">فعال</option>
              <option value="INACTIVE">غیرفعال</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">یادداشت</label>
            <textarea
              className="input"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={toDelete != null}
        title="حذف عضو"
        danger
        confirmLabel={deleting ? "در حال حذف…" : "حذف"}
        onCancel={() => setToDelete(null)}
        onConfirm={confirmDelete}
        message={
          <div className="space-y-2">
            <p>
              آیا از حذف «{toDelete?.fullName}» مطمئن هستید؟ این کار قابل بازگشت
              نیست.
            </p>
            <p className="text-xs text-slate-500">
              توجه: اگر این عضو تراکنش ثبت‌شده (واریز/برداشت) داشته باشد، برای حفظ
              صحت محاسبات NAV حذف نمی‌شود؛ در آن حالت به‌جای حذف، وضعیت او را
              «غیرفعال» کنید.
            </p>
          </div>
        }
      />
    </div>
  );
}
