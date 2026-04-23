"use client";
import { useEffect, useState } from "react";
import { Mail, Plus, Trash2, Loader2, RefreshCw, AlertCircle } from "lucide-react";

type CfDestination = {
  tag: string;
  email: string;
  verified: string | null;
  created: string;
};

type CfRule = {
  tag: string;
  name: string;
  enabled: boolean;
  matchers: { type: string; field?: string; value?: string }[];
  actions: { type: string; value?: string[] }[];
  created: string;
};

export default function EmailRoutingPage() {
  const [destinations, setDestinations] = useState<CfDestination[]>([]);
  const [rules, setRules] = useState<CfRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // New destination form
  const [newEmail, setNewEmail] = useState("");
  const [addingDest, setAddingDest] = useState(false);
  const [destMsg, setDestMsg] = useState("");

  // New rule form
  const [ruleName, setRuleName] = useState("");
  const [ruleFrom, setRuleFrom] = useState("");
  const [ruleTo, setRuleTo] = useState("");
  const [addingRule, setAddingRule] = useState(false);
  const [ruleMsg, setRuleMsg] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/email-routing");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setDestinations(data.destinations ?? []);
      setRules(data.rules ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleAddDestination(e: React.FormEvent) {
    e.preventDefault();
    setAddingDest(true);
    setDestMsg("");
    try {
      const res = await fetch("/api/email-routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setDestMsg("✓ Verification email sent to " + newEmail);
      setNewEmail("");
      await load();
    } catch (err) {
      setDestMsg("Error: " + (err instanceof Error ? err.message : "Failed"));
    } finally {
      setAddingDest(false);
    }
  }

  async function handleAddRule(e: React.FormEvent) {
    e.preventDefault();
    setAddingRule(true);
    setRuleMsg("");
    try {
      const res = await fetch("/api/email-routing/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: ruleName,
          receiving_address: ruleFrom,
          destination_address: ruleTo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setRuleMsg("✓ Rule created");
      setRuleName("");
      setRuleFrom("");
      setRuleTo("");
      await load();
    } catch (err) {
      setRuleMsg("Error: " + (err instanceof Error ? err.message : "Failed"));
    } finally {
      setAddingRule(false);
    }
  }

  async function deleteRule(tag: string) {
    if (!confirm("Delete this routing rule?")) return;
    await fetch(`/api/email-routing/rules/${tag}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mail className="w-6 h-6 text-blue-500" />
          <h1 className="text-2xl font-bold text-gray-900">Email Routing</h1>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Destination addresses */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            Destination Addresses
          </h2>
          <span className="text-xs text-gray-400">
            Must be verified before routing rules can use them
          </span>
        </div>

        {/* Add destination form */}
        <form onSubmit={handleAddDestination} className="px-4 py-3 border-b flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-gray-500">Add destination email</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="person@example.com"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={addingDest}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {addingDest ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </button>
        </form>
        {destMsg && (
          <p className={`px-4 py-2 text-xs ${destMsg.startsWith("Error") ? "text-red-600" : "text-emerald-600"}`}>
            {destMsg}
          </p>
        )}

        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Email</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Verified</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                  Loading…
                </td>
              </tr>
            ) : destinations.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-gray-400">
                  No destination addresses configured
                </td>
              </tr>
            ) : (
              destinations.map((d) => (
                <tr key={d.tag} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{d.email}</td>
                  <td className="px-4 py-2.5">
                    {d.verified ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                        ✓ Verified
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">
                    {new Date(d.created).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Routing rules */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Routing Rules</h2>
        </div>

        {/* Add rule form */}
        <form onSubmit={handleAddRule} className="px-4 py-3 border-b space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Rule name</label>
              <input
                type="text"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="Support inbox"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Receiving address (your domain)</label>
              <input
                type="email"
                value={ruleFrom}
                onChange={(e) => setRuleFrom(e.target.value)}
                placeholder="support@yourdomain.com"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Forward to (verified destination)</label>
              <input
                type="email"
                value={ruleTo}
                onChange={(e) => setRuleTo(e.target.value)}
                placeholder="you@gmail.com"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={addingRule}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {addingRule ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create Rule
          </button>
          {ruleMsg && (
            <p className={`text-xs ${ruleMsg.startsWith("Error") ? "text-red-600" : "text-emerald-600"}`}>
              {ruleMsg}
            </p>
          )}
        </form>

        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Name</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">From</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Forward to</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Status</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…
                </td>
              </tr>
            ) : rules.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  No routing rules configured
                </td>
              </tr>
            ) : (
              rules.map((r) => {
                const matcher = r.matchers.find((m) => m.field === "to")?.value ?? "—";
                const forward = r.actions.find((a) => a.type === "forward")?.value?.[0] ?? "—";
                return (
                  <tr key={r.tag} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{r.name}</td>
                    <td className="px-4 py-2.5 text-gray-600 font-mono text-xs">{matcher}</td>
                    <td className="px-4 py-2.5 text-gray-600 font-mono text-xs">{forward}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          r.enabled
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {r.enabled ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => deleteRule(r.tag)}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        title="Delete rule"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
