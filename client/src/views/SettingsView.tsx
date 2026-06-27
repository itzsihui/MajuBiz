import { Building2, Loader2, MapPin, Save, User } from "lucide-react";
import { useEffect, useState } from "react";
import type { BusinessProfile } from "../lib/api";
import { updateBusinessProfile } from "../lib/api";

type ToastKind = "success" | "error" | "info" | "warning";

interface SettingsViewProps {
  profile: BusinessProfile;
  onRefresh: () => Promise<void>;
  onToast: (message: string, kind?: ToastKind) => void;
}

function formatShipTo(profile: BusinessProfile): string {
  return [
    profile.shippingAddressLine1,
    profile.shippingAddressLine2,
    `${profile.city} ${profile.postalCode}`,
    profile.country,
  ]
    .filter(Boolean)
    .join(", ");
}

export function SettingsView({ profile, onRefresh, onToast }: SettingsViewProps) {
  const [draft, setDraft] = useState<BusinessProfile>(profile);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);

  const setField = <K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.businessName.trim()) {
      onToast("Business name is required", "warning");
      return;
    }
    if (!draft.shippingAddressLine1.trim()) {
      onToast("Shipping address is required", "warning");
      return;
    }

    setSaving(true);
    try {
      await updateBusinessProfile(draft);
      await onRefresh();
      onToast("Business profile saved — agents will use these details", "success");
    } catch {
      onToast("Failed to save settings", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex-1 space-y-6 p-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-brand-50 p-2.5 text-brand-600">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Business profile</h2>
            <p className="mt-1 text-sm text-slate-500">
              Agents use this when evaluating purchases, talking to seller APIs, and building PayNow
              settlement payloads with your ship-to address.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Building2 className="h-4 w-4 text-brand-600" />
            Company
          </div>
          <div className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Business name</span>
              <input
                type="text"
                value={draft.businessName}
                onChange={(e) => setField("businessName", e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
                placeholder="Heartland Supplies Pte Ltd"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">UEN</span>
              <input
                type="text"
                value={draft.uen}
                onChange={(e) => setField("uen", e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
                placeholder="202412345K"
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <User className="h-4 w-4 text-brand-600" />
            Contact
          </div>
          <div className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Contact name</span>
              <input
                type="text"
                value={draft.contactName}
                onChange={(e) => setField("contactName", e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Email</span>
              <input
                type="email"
                value={draft.contactEmail}
                onChange={(e) => setField("contactEmail", e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Phone</span>
              <input
                type="tel"
                value={draft.contactPhone}
                onChange={(e) => setField("contactPhone", e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
                placeholder="+65 9123 4567"
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <MapPin className="h-4 w-4 text-brand-600" />
            Shipping address
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block text-slate-600">Address line 1</span>
              <input
                type="text"
                value={draft.shippingAddressLine1}
                onChange={(e) => setField("shippingAddressLine1", e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
                placeholder="Blk 123 Ang Mo Kio Ave 3"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block text-slate-600">Address line 2 (unit / floor)</span>
              <input
                type="text"
                value={draft.shippingAddressLine2}
                onChange={(e) => setField("shippingAddressLine2", e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
                placeholder="#04-567"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Postal code</span>
              <input
                type="text"
                value={draft.postalCode}
                onChange={(e) => setField("postalCode", e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
                placeholder="560123"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">City</span>
              <input
                type="text"
                value={draft.city}
                onChange={(e) => setField("city", e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block text-slate-600">Country</span>
              <input
                type="text"
                value={draft.country}
                onChange={(e) => setField("country", e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
              />
            </label>
          </div>

          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <span className="font-medium text-slate-700">Preview — ship to: </span>
            {formatShipTo(draft)}
          </div>
        </section>

        <div className="flex items-center justify-end gap-3 lg:col-span-2">
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
          <button
            type="submit"
            disabled={saving || !dirty}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save settings
          </button>
        </div>
      </form>
    </main>
  );
}
