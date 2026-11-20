"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { ArrowLeft, ArrowRight, Layers2, LoaderCircle } from "lucide-react";
import { getSupabase } from "@/lib/supabase/browser";
function authMessage(code?: string) {
  switch (code) {
    case "invalid_credentials":
      return "The email or password is incorrect.";
    case "email_not_confirmed":
      return "Confirm your email address before signing in.";
    case "over_email_send_rate_limit":
      return "The email limit has been reached. Please wait before trying again.";
    case "weak_password":
      return "Choose a stronger password with at least 12 characters.";
    case "signup_disabled":
      return "New accounts are currently unavailable.";
    default:
      return "We couldn’t complete that request. Check your connection and try again.";
  }
}
export default function Account() {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    try {
      const supabase = getSupabase();
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        if (active) {
          setUser(session?.user ?? null);
          setLoaded(true);
        }
      });
      void supabase.auth
        .getUser()
        .then(({ data }) => {
          if (active) {
            setUser(data.user);
            setLoaded(true);
          }
        })
        .catch(() => {
          if (active) {
            setLoaded(true);
            setFailed(true);
            setMessage("Account access is unavailable. Please try again.");
          }
        });
      return () => {
        active = false;
        subscription.unsubscribe();
      };
    } catch {
      void Promise.resolve().then(() => {
        if (active) {
          setLoaded(true);
          setFailed(true);
          setMessage("Account access is not configured yet.");
        }
      });
      return () => {
        active = false;
      };
    }
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const email = String(fields.get("email") || "").trim();
    const password = String(fields.get("password") || "");
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const supabase = getSupabase();
      const result =
        mode === "signup"
          ? await supabase.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: `${window.location.origin}/account` },
            })
          : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) {
        setFailed(true);
        setMessage(authMessage(result.error.code));
        return;
      }
      form.reset();
      if (mode === "signup" && !result.data.session)
        setMessage(
          "Check your inbox for a confirmation link. Once confirmed, return here to sign in.",
        );
      else {
        setUser(result.data.user);
        setMessage("You’re signed in.");
      }
    } catch {
      setFailed(true);
      setMessage(authMessage());
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const { error } = await getSupabase().auth.signOut({ scope: "local" });
      if (error) throw error;
      setUser(null);
      setMessage("You’ve signed out on this browser.");
    } catch {
      setFailed(true);
      setMessage("We couldn’t sign you out. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-page">
      <Link className="account-back" href="/">
        <ArrowLeft size={14} />
        Back to the studio
      </Link>
      <section className="account-card">
        <span className="brand-icon">
          <Layers2 size={21} />
        </span>
        <p className="eyebrow">YOUR SHELF STUDIO ACCOUNT</p>
        <h1>
          {user ? (
            <>
              A space for <em>your ideas.</em>
            </>
          ) : mode === "signup" ? (
            <>
              Make room for <em>something good.</em>
            </>
          ) : (
            <>
              Welcome back <em>to the studio.</em>
            </>
          )}
        </h1>
        {message && (
          <p
            className={failed ? "notice notice-error" : "notice"}
            role={failed ? "alert" : "status"}
          >
            {message}
          </p>
        )}
        {!loaded ? (
          <p role="status">Checking your account…</p>
        ) : user ? (
          <>
            <p className="account-email">
              Signed in as <strong>{user.email}</strong>
            </p>
            <p className="account-note">
              Your account projects and photos are saved privately. Existing
              device drafts stay in this browser until you open one and choose
              Save to account.
            </p>
            <Link href="/" className="button primary">
              Open your workspace
              <ArrowRight size={14} />
            </Link>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void signOut()}
            >
              {busy && <LoaderCircle size={14} className="spin" />}Sign out
            </button>
          </>
        ) : (
          <>
            <div className="account-tabs">
              <button
                aria-pressed={mode === "login"}
                disabled={busy}
                onClick={() => {
                  setMode("login");
                  setMessage("");
                }}
              >
                Sign in
              </button>
              <button
                aria-pressed={mode === "signup"}
                disabled={busy}
                onClick={() => {
                  setMode("signup");
                  setMessage("");
                }}
              >
                Create account
              </button>
            </div>
            <form onSubmit={(event) => void submit(event)}>
              <label htmlFor="account-email">Email address</label>
              <input
                id="account-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                maxLength={254}
                disabled={busy}
              />
              <label htmlFor="account-password">Password</label>
              <input
                id="account-password"
                name="password"
                type="password"
                minLength={mode === "signup" ? 12 : undefined}
                required
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                disabled={busy}
              />
              {mode === "signup" && (
                <p className="field-help">
                  Use at least 12 characters. You may need to confirm your
                  email.
                </p>
              )}
              <button className="button primary" disabled={busy} type="submit">
                {busy ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <ArrowRight size={14} />
                )}
                {mode === "signup" ? "Create account" : "Sign in"}
              </button>
            </form>
            <p className="account-note">
              Your local drafts stay on this device. Account access does not
              automatically upload them.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
