"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

type Step = 1 | 2 | 3 | 4 | 5;

interface OnboardingStatus {
  complete: boolean;
  userName: string;
  userEmail: string;
  hasAnthropicKey: boolean;
  hasGoogle: boolean;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding/status");
      const data: OnboardingStatus = await res.json();
      setStatus(data);
      if (data.userName) setName(data.userName);
      if (data.userEmail) setEmail(data.userEmail);
    } catch {
      // ignore — assume fresh install
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // If Google OAuth redirected back to /onboarding, jump ahead to step 4
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("step") === "4") {
      setStep(4);
    }
  }, []);

  async function saveSettings(patch: Record<string, unknown>) {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error("Save failed");
    return res.json();
  }

  async function goToStep2() {
    setStep(2);
  }

  async function saveNameAndAdvance() {
    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await saveSettings({ userName: name.trim(), userEmail: email.trim() });
      setStep(3);
    } catch {
      setError("Could not save — please try again");
    } finally {
      setSaving(false);
    }
  }

  async function saveKeyAndAdvance() {
    const trimmed = anthropicKey.trim();
    if (!trimmed) {
      setError("Please paste your Anthropic API key");
      return;
    }
    if (!trimmed.startsWith("sk-ant-")) {
      setError("That doesn't look like an Anthropic key — it should start with sk-ant-");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await saveSettings({ anthropicKey: trimmed });
      await loadStatus();
      setStep(4);
    } catch {
      setError("Could not save key — please try again");
    } finally {
      setSaving(false);
    }
  }

  function connectGoogle() {
    // Full page redirect to OAuth flow — after callback the user is sent to /settings
    // but we can bounce them back here. Simpler: open in same window; callback returns to /settings
    // and user can navigate back. For inline flow, we open in a new window.
    window.open("/api/auth/google", "_self");
  }

  async function finishOnboarding() {
    setSaving(true);
    try {
      await saveSettings({ setupComplete: true });
      router.push("/");
    } catch {
      setError("Could not finalize — please try again");
    } finally {
      setSaving(false);
    }
  }

  const StepDots = () => (
    <div className="flex gap-2 mb-8 justify-center">
      {[1, 2, 3, 4, 5].map((n) => (
        <div
          key={n}
          className={`h-1.5 rounded-full transition-all ${
            n === step ? "w-8 bg-indigo-500" : n < step ? "w-4 bg-indigo-700" : "w-4 bg-zinc-800"
          }`}
        />
      ))}
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-zinc-950">
      <div className="w-full max-w-lg">
        <StepDots />

        {step === 1 && (
          <div className="text-center">
            <img
              src="/icon-robot-1024.png"
              alt="Taskora"
              className="mx-auto mb-5 w-28 h-28 object-contain drop-shadow-lg"
              draggable={false}
            />
            <h1 className="text-4xl font-bold text-white mb-1 tracking-tight">Taskora</h1>
            <p className="text-indigo-400 text-base mb-2 font-medium">Your AI Productivity Assistant</p>
            <p className="text-zinc-500 text-sm mb-10 max-w-sm mx-auto leading-relaxed">
              Meetings. Email. Tasks. Calendar. One AI that remembers everything and helps you stay ahead.
            </p>
            <button
              onClick={goToStep2}
              className="px-8 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
            >
              Get started
            </button>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">About you</h2>
            <p className="text-zinc-500 text-sm mb-8">Taskora personalizes your briefings and tasks with your name.</p>

            <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex Kim"
              className="w-full bg-zinc-900 border border-zinc-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none mb-4"
            />

            <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Work email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@company.com"
              className="w-full bg-zinc-900 border border-zinc-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none mb-6"
            />

            {error && <p className="text-red-400 text-xs mb-4">{error}</p>}

            <div className="flex gap-3 justify-between">
              <button
                onClick={() => setStep(1)}
                className="text-zinc-500 hover:text-zinc-300 text-sm px-4 py-3"
              >
                Back
              </button>
              <button
                onClick={saveNameAndAdvance}
                disabled={saving}
                className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
              >
                {saving ? "Saving…" : "Continue"}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Anthropic API key</h2>
            <p className="text-zinc-500 text-sm mb-2">
              Taskora uses Claude AI for task extraction and your daily briefing.
            </p>
            <p className="text-zinc-500 text-xs mb-8">
              Get your key at{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-400 hover:text-indigo-300 underline"
              >
                console.anthropic.com
              </a>
            </p>

            <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">API key</label>
            <div className="relative mb-6">
              <input
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                type={showKey ? "text" : "password"}
                placeholder="sk-ant-…"
                className="w-full bg-zinc-900 border border-zinc-800 focus:border-indigo-500 rounded-xl px-4 py-3 pr-16 text-sm text-white placeholder-zinc-600 focus:outline-none font-mono"
              />
              <button
                onClick={() => setShowKey((s) => !s)}
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 hover:text-zinc-300"
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>

            {error && <p className="text-red-400 text-xs mb-4">{error}</p>}

            <div className="flex gap-3 justify-between">
              <button
                onClick={() => setStep(2)}
                className="text-zinc-500 hover:text-zinc-300 text-sm px-4 py-3"
              >
                Back
              </button>
              <button
                onClick={saveKeyAndAdvance}
                disabled={saving}
                className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
              >
                {saving ? "Saving…" : "Continue"}
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Connect Google</h2>
            <p className="text-zinc-500 text-sm mb-8">
              Optional but recommended. Taskora reads your inbox, calendar, and Drive to surface tasks automatically. Nothing is written back.
            </p>

            <div className="mb-6 p-4 rounded-xl border border-zinc-800 bg-zinc-900">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🔵</span>
                  <div>
                    <p className="text-sm font-medium text-white">Google (Gmail, Calendar, Drive)</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {status?.hasGoogle ? "Connected" : "Not connected"}
                    </p>
                  </div>
                </div>
                {status?.hasGoogle ? (
                  <span className="flex items-center gap-1.5 text-xs text-green-400 font-medium">
                    <span className="w-2 h-2 rounded-full bg-green-400" />
                    Connected
                  </span>
                ) : (
                  <button
                    onClick={connectGoogle}
                    className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>

            {error && <p className="text-red-400 text-xs mb-4">{error}</p>}

            <div className="flex gap-3 justify-between">
              <button
                onClick={() => setStep(3)}
                className="text-zinc-500 hover:text-zinc-300 text-sm px-4 py-3"
              >
                Back
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => setStep(5)}
                  className="px-4 py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 text-sm transition-colors"
                >
                  Skip for now
                </button>
                <button
                  onClick={() => setStep(5)}
                  className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="text-center">
            <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-xl shadow-emerald-500/20">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">You&apos;re all set!</h2>
            <p className="text-zinc-500 text-sm mb-6 max-w-sm mx-auto">
              Here&apos;s what&apos;s connected. You can update anything later from Settings.
            </p>

            <div className="text-left space-y-2 mb-8 max-w-sm mx-auto">
              <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
                <span className="text-sm text-zinc-300">Anthropic AI</span>
                <span className={`text-xs font-medium ${status?.hasAnthropicKey ? "text-green-400" : "text-zinc-600"}`}>
                  {status?.hasAnthropicKey ? "✓ Configured" : "Not configured"}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
                <span className="text-sm text-zinc-300">Google</span>
                <span className={`text-xs font-medium ${status?.hasGoogle ? "text-green-400" : "text-zinc-600"}`}>
                  {status?.hasGoogle ? "✓ Connected" : "Skipped"}
                </span>
              </div>
            </div>

            {error && <p className="text-red-400 text-xs mb-4">{error}</p>}

            <button
              onClick={finishOnboarding}
              disabled={saving}
              className="px-8 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium transition-colors"
            >
              {saving ? "Opening…" : "Open Taskora"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
