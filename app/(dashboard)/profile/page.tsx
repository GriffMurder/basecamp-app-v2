"use client";
import { useEffect, useState } from "react";
import { User, Save, Loader2 } from "lucide-react";

type Profile = {
  id: number;
  email: string;
  display_name: string;
  name: string | null;
  role: string;
  active: boolean;
  availability_status: string;
  away_note: string | null;
  org_id: number | null;
  last_login_at: string | null;
  created_at: string;
};

const AVAILABILITY_OPTIONS = [
  { value: "available", label: "Available", color: "text-emerald-600" },
  { value: "busy", label: "Busy", color: "text-amber-500" },
  { value: "away", label: "Away", color: "text-gray-400" },
  { value: "offline", label: "Offline", color: "text-red-400" },
];

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [availability, setAvailability] = useState("available");
  const [awayNote, setAwayNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/users/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.user) {
          setProfile(data.user);
          setDisplayName(data.user.display_name ?? "");
          setAvailability(data.user.availability_status ?? "available");
          setAwayNote(data.user.away_note ?? "");
        }
      });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName,
          availability_status: availability,
          away_note: awayNote || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Save failed");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto py-16 flex items-center justify-center gap-2 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading profile…
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <User className="w-6 h-6 text-blue-500" />
        <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
      </div>

      {/* Read-only info */}
      <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Account Info</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Email</p>
            <p className="font-medium text-gray-800">{profile.email}</p>
          </div>
          <div>
            <p className="text-gray-500">Role</p>
            <p className="font-medium text-gray-800 capitalize">{profile.role}</p>
          </div>
          <div>
            <p className="text-gray-500">Member since</p>
            <p className="font-medium text-gray-800">
              {new Date(profile.created_at).toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Last login</p>
            <p className="font-medium text-gray-800">
              {profile.last_login_at
                ? new Date(profile.last_login_at).toLocaleString()
                : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Editable form */}
      <form onSubmit={handleSave} className="bg-white rounded-lg border shadow-sm p-5 space-y-5">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Edit Profile
        </h2>

        {/* Display name */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700" htmlFor="display_name">
            Display Name
          </label>
          <input
            id="display_name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={100}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Your display name"
          />
        </div>

        {/* Availability */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">
            Availability Status
          </label>
          <div className="grid grid-cols-2 gap-2">
            {AVAILABILITY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-center gap-2 px-3 py-2 border rounded-md cursor-pointer text-sm transition-colors ${
                  availability === opt.value
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-300 hover:bg-gray-50"
                }`}
              >
                <input
                  type="radio"
                  name="availability"
                  value={opt.value}
                  checked={availability === opt.value}
                  onChange={() => setAvailability(opt.value)}
                  className="sr-only"
                />
                <span className={`w-2 h-2 rounded-full bg-current ${opt.color}`} />
                <span className={opt.color}>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Away note */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700" htmlFor="away_note">
            Away Note{" "}
            <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <textarea
            id="away_note"
            value={awayNote}
            onChange={(e) => setAwayNote(e.target.value)}
            maxLength={500}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder="Let the team know where you are or when you'll be back…"
          />
          <p className="text-xs text-gray-400 text-right">{awayNote.length}/500</p>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Changes
          </button>
          {saved && (
            <span className="text-sm text-emerald-600 font-medium">
              ✓ Saved
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
