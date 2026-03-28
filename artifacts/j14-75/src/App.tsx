import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap, Shield, Activity, Wallet, ArrowRightLeft, Search,
  Send, Copy, Check, ExternalLink, AlertTriangle,
  BarChart3, Lock, Globe, Cpu, Mail, LogOut, Eye, EyeOff
} from "lucide-react";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
  toolUsed?: string;
}

interface WalletState {
  connected: boolean;
  address: string;
  chain: string;
}

// Auth can be either "wallet" (MetaMask/Rabby) or "email" (Circle Modular)
type AuthMode = "none" | "wallet" | "email";

interface AuthState {
  mode: AuthMode;
  address: string;
  email?: string;
  isEmailUser: boolean; // enables Gas Station sponsorship
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────
const AGENT_METRICS = {
  id: "75",
  name: "J14-75",
  standard: "ERC-8004",
  network: "Arc Testnet",
  reputation: 95,
  validation: 100,
  status: "online" as const,
  kycStatus: "kyc_verified",
  ownerAddress: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  validatorAddress: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
function truncateAddress(addr: string) {
  if (!addr || addr.length < 10) return addr;
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="ml-1 opacity-40 hover:opacity-100 transition-opacity"
    >
      {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
    </button>
  );
}

function ScoreRing({ value, size = 56, color = "#FF6B00" }: { value: number; size?: number; color?: string }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
      <motion.circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={4}
        strokeDasharray={circ}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: circ - dash }}
        transition={{ duration: 1.2, ease: "easeOut", delay: 0.3 }}
        strokeLinecap="round"
      />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Circle Email OTP Auth
// Uses Circle Modular Wallets SDK (@circle-fin/modular-wallets-core)
// The SDK handles: email delivery, OTP verification, wallet creation (ERC-4337 SCA)
// TEST_CLIENT_KEY is passed via import.meta.env.VITE_TEST_CLIENT_KEY
// ──────────────────────────────────────────────────────────────────────────────

type EmailAuthStep = "idle" | "email_input" | "otp_input" | "loading" | "done" | "error";

interface EmailAuthState {
  step: EmailAuthStep;
  email: string;
  otp: string;
  errorMsg: string;
  walletAddress: string;
  sessionToken: string;
}

function useCircleEmailAuth() {
  const [authState, setAuthState] = useState<EmailAuthState>({
    step: "idle",
    email: "",
    otp: "",
    errorMsg: "",
    walletAddress: "",
    sessionToken: "",
  });

  const clientKey = import.meta.env.VITE_TEST_CLIENT_KEY as string | undefined;

  const requestOtp = useCallback(async (email: string) => {
    if (!clientKey) {
      setAuthState(s => ({ ...s, step: "error", errorMsg: "VITE_TEST_CLIENT_KEY is not configured." }));
      return;
    }

    setAuthState(s => ({ ...s, step: "loading", email, errorMsg: "" }));

    try {
      // Circle Modular Wallets — Email OTP initiation
      // The SDK sends a verification code to the user's email via Circle's infrastructure.
      // We use the REST API directly since the web SDK uses passkeys as primary flow.
      // For Email OTP specifically, we POST to Circle's user-controlled wallet initiation endpoint.
      const baseUrl = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const res = await fetch(`${baseUrl}/api/auth/email/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, clientKey }),
      });

      if (res.ok) {
        setAuthState(s => ({ ...s, step: "otp_input" }));
      } else {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Server error ${res.status}`);
      }
    } catch (err: any) {
      setAuthState(s => ({
        ...s,
        step: "error",
        errorMsg: err.message ?? "Failed to send OTP. Check your email and try again.",
      }));
    }
  }, [clientKey]);

  const verifyOtp = useCallback(async (otp: string) => {
    setAuthState(s => ({ ...s, step: "loading", otp, errorMsg: "" }));

    try {
      const baseUrl = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const res = await fetch(`${baseUrl}/api/auth/email/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authState.email, otp }),
      });

      if (res.ok) {
        const data = await res.json();
        setAuthState(s => ({
          ...s,
          step: "done",
          walletAddress: data.walletAddress ?? "",
          sessionToken: data.sessionToken ?? "",
        }));
        return { walletAddress: data.walletAddress ?? "", sessionToken: data.sessionToken ?? "" };
      } else {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Invalid OTP. Please try again.");
      }
    } catch (err: any) {
      setAuthState(s => ({
        ...s,
        step: "otp_input",
        errorMsg: err.message ?? "Verification failed. Please try again.",
      }));
      return null;
    }
  }, [authState.email]);

  const reset = useCallback(() => {
    setAuthState({ step: "idle", email: "", otp: "", errorMsg: "", walletAddress: "", sessionToken: "" });
  }, []);

  return { authState, setAuthState, requestOtp, verifyOtp, reset };
}

// ──────────────────────────────────────────────────────────────────────────────
// Email Sign In Panel
// ──────────────────────────────────────────────────────────────────────────────
function EmailSignInPanel({
  onSuccess,
  onClose,
}: {
  onSuccess: (address: string, email: string) => void;
  onClose: () => void;
}) {
  const { authState, setAuthState, requestOtp, verifyOtp } = useCircleEmailAuth();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const otpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (authState.step === "email_input" || authState.step === "idle") emailRef.current?.focus();
    if (authState.step === "otp_input") otpRef.current?.focus();
  }, [authState.step]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) return;
    setAuthState(s => ({ ...s, step: "email_input" }));
    await requestOtp(email.trim());
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.trim().length < 4) return;
    const result = await verifyOtp(otp.trim());
    if (result?.walletAddress) {
      onSuccess(result.walletAddress, email);
    }
  };

  const isLoading = authState.step === "loading";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -8 }}
      transition={{ duration: 0.2 }}
      className="absolute top-14 right-4 z-50 w-72 rounded-2xl p-4 shadow-2xl"
      style={{
        background: "#0a0a0a",
        border: "1px solid rgba(255,107,0,0.2)",
        boxShadow: "0 0 40px rgba(255,107,0,0.08)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Mail size={14} style={{ color: "#FF6B00" }} />
          <span className="text-sm font-semibold text-white">Email Sign In</span>
        </div>
        <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors text-lg leading-none">×</button>
      </div>

      <div className="text-[11px] mb-3" style={{ color: "rgba(255,255,255,0.4)" }}>
        Powered by Circle · Gasless wallet auto-created
      </div>

      {(authState.step === "idle" || authState.step === "email_input" || authState.step === "loading") && authState.step !== "otp_input" && (
        <form onSubmit={handleEmailSubmit} className="flex flex-col gap-2">
          <input
            ref={emailRef}
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="your@email.com"
            disabled={isLoading}
            className="w-full rounded-xl px-3 py-2 text-sm outline-none disabled:opacity-50"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "rgba(255,255,255,0.9)",
            }}
          />
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={isLoading || !email.includes("@")}
            className="w-full py-2 rounded-xl text-sm font-semibold text-black disabled:opacity-40 transition-opacity"
            style={{ background: "linear-gradient(135deg, #FF6B00, #FFB300)" }}
          >
            {isLoading ? "Sending..." : "Send Code"}
          </motion.button>
        </form>
      )}

      {authState.step === "otp_input" && (
        <form onSubmit={handleOtpSubmit} className="flex flex-col gap-2">
          <div className="text-[11px] text-center" style={{ color: "rgba(255,255,255,0.5)" }}>
            Code sent to <span className="text-orange-400">{email}</span>
          </div>
          <input
            ref={otpRef}
            type="text"
            inputMode="numeric"
            value={otp}
            onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="Enter verification code"
            className="w-full rounded-xl px-3 py-2 text-sm text-center tracking-widest outline-none"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,107,0,0.3)",
              color: "rgba(255,255,255,0.9)",
            }}
          />
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={otp.trim().length < 4}
            className="w-full py-2 rounded-xl text-sm font-semibold text-black disabled:opacity-40"
            style={{ background: "linear-gradient(135deg, #FF6B00, #FFB300)" }}
          >
            Verify & Sign In
          </motion.button>
          <button
            type="button"
            onClick={() => setAuthState(s => ({ ...s, step: "idle", errorMsg: "" }))}
            className="text-[11px] text-center"
            style={{ color: "rgba(255,255,255,0.35)" }}
          >
            Try a different email
          </button>
        </form>
      )}

      {authState.errorMsg && (
        <div className="mt-2 text-[11px] text-red-400 text-center">{authState.errorMsg}</div>
      )}
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Agent Sidebar
// ──────────────────────────────────────────────────────────────────────────────
function AgentSidebar({ auth }: { auth: AuthState }) {
  return (
    <aside
      className="w-[220px] shrink-0 flex flex-col gap-4 py-5 px-4"
      style={{ borderRight: "1px solid rgba(255,255,255,0.05)" }}
    >
      <div className="flex flex-col items-center gap-3 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="relative">
          <motion.div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #FF6B00 0%, #FFB300 100%)" }}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            <span className="text-black font-black text-lg tracking-tight">J14</span>
          </motion.div>
          <span
            className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full pulse-dot"
            style={{ background: "#22c55e", border: "2px solid #000" }}
          />
        </div>
        <div className="text-center">
          <div className="font-bold text-sm tracking-wide text-white">J14-75</div>
          <div className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>{AGENT_METRICS.standard}</div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>
          Agent Status
        </div>

        <div className="glass rounded-xl p-3 flex items-center gap-2.5">
          <Activity size={13} style={{ color: "#22c55e" }} />
          <div>
            <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>Status</div>
            <div className="text-xs font-semibold text-white">Online</div>
          </div>
        </div>

        <div className="glass rounded-xl p-3 flex items-center gap-2.5">
          <Lock size={13} style={{ color: "#FFB300" }} />
          <div>
            <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>KYC</div>
            <div className="text-xs font-semibold" style={{ color: "#FFB300" }}>Verified</div>
          </div>
        </div>

        <div className="glass rounded-xl p-3 flex items-center gap-2.5">
          <Globe size={13} style={{ color: "#FF6B00" }} />
          <div>
            <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>Network</div>
            <div className="text-xs font-semibold text-white">Arc Testnet</div>
          </div>
        </div>

        {auth.isEmailUser && (
          <div className="glass rounded-xl p-3 flex items-center gap-2.5">
            <Zap size={13} style={{ color: "#22c55e" }} />
            <div>
              <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>Gas</div>
              <div className="text-xs font-semibold" style={{ color: "#22c55e" }}>Sponsored</div>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>
          Scores
        </div>

        <div className="glass rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>Reputation</div>
            <div className="text-xs font-bold" style={{ color: "#FF6B00" }}>{AGENT_METRICS.reputation}/100</div>
          </div>
          <div className="h-1 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, #FF6B00, #FFB300)" }}
              initial={{ width: 0 }}
              animate={{ width: `${AGENT_METRICS.reputation}%` }}
              transition={{ duration: 1.2, ease: "easeOut", delay: 0.4 }}
            />
          </div>
        </div>

        <div className="glass rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>Validation</div>
            <div className="text-xs font-bold" style={{ color: "#22c55e" }}>{AGENT_METRICS.validation}/100</div>
          </div>
          <div className="h-1 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, #16a34a, #22c55e)" }}
              initial={{ width: 0 }}
              animate={{ width: `${AGENT_METRICS.validation}%` }}
              transition={{ duration: 1.2, ease: "easeOut", delay: 0.5 }}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1 mt-auto">
        <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>
          Addresses
        </div>
        <div className="glass rounded-xl p-2.5">
          <div className="text-[10px] mb-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>Agent ID #{AGENT_METRICS.id}</div>
          <div className="flex items-center text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>
            {truncateAddress(AGENT_METRICS.ownerAddress)}
            <CopyButton text={AGENT_METRICS.ownerAddress} />
          </div>
        </div>
        {auth.address && (
          <div className="glass rounded-xl p-2.5">
            <div className="text-[10px] mb-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>
              {auth.isEmailUser ? "Circle Wallet" : "Connected"}
            </div>
            <div className="flex items-center text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>
              {truncateAddress(auth.address)}
              <CopyButton text={auth.address} />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Chat Components
// ──────────────────────────────────────────────────────────────────────────────
function ChatMessage({ message }: { message: Message }) {
  const isAgent = message.role === "agent";
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex ${isAgent ? "justify-start" : "justify-end"} mb-3`}
    >
      {isAgent && (
        <div
          className="w-6 h-6 rounded-lg shrink-0 mr-2.5 mt-0.5 flex items-center justify-center text-black font-black text-[9px]"
          style={{ background: "linear-gradient(135deg, #FF6B00, #FFB300)" }}
        >
          J
        </div>
      )}
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-3 ${isAgent ? "glass rounded-tl-sm" : "rounded-tr-sm"}`}
        style={
          isAgent
            ? { background: "rgba(255,255,255,0.04)" }
            : { background: "linear-gradient(135deg, rgba(255,107,0,0.15), rgba(255,179,0,0.1))", border: "1px solid rgba(255,107,0,0.2)" }
        }
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: isAgent ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.9)" }}>
          {message.content}
        </p>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
            {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {message.toolUsed && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,107,0,0.15)", color: "#FF6B00" }}>
              {message.toolUsed}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="flex items-center gap-2.5 mb-3"
    >
      <div
        className="w-6 h-6 rounded-lg shrink-0 flex items-center justify-center text-black font-black text-[9px]"
        style={{ background: "linear-gradient(135deg, #FF6B00, #FFB300)" }}
      >
        J
      </div>
      <div className="glass rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: "#FF6B00" }}
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </div>
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main App
// ──────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [auth, setAuth] = useState<AuthState>({ mode: "none", address: "", isEmailUser: false });
  const [connecting, setConnecting] = useState(false);
  const [showEmailPanel, setShowEmailPanel] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // ── Connect MetaMask / Rabby wallet ──────────────────────────────────────
  const connectWallet = useCallback(async () => {
    if (typeof window.ethereum === "undefined") {
      alert("No Web3 wallet detected. Install MetaMask or Rabby to connect.");
      return;
    }
    setConnecting(true);
    try {
      const accounts = await (window.ethereum as any).request({ method: "eth_requestAccounts" });
      const chainId = await (window.ethereum as any).request({ method: "eth_chainId" });
      const chainName = chainId === "0xaa36a7" ? "ETH-SEPOLIA"
        : chainId === "0x13e31" ? "ARC-TESTNET"
        : `Chain ${chainId}`;
      setAuth({ mode: "wallet", address: accounts[0], chain: chainName, isEmailUser: false } as any);
    } catch (err: any) {
      console.error("Wallet connect error:", err);
    } finally {
      setConnecting(false);
    }
  }, []);

  // ── Email OTP success ─────────────────────────────────────────────────────
  const onEmailSuccess = useCallback((walletAddress: string, email: string) => {
    setAuth({ mode: "email", address: walletAddress, email, isEmailUser: true });
    setShowEmailPanel(false);
  }, []);

  const signOut = useCallback(() => {
    setAuth({ mode: "none", address: "", isEmailUser: false });
    setMessages([]);
  }, []);

  // ── Send message to real backend ─────────────────────────────────────────
  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isTyping) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const baseUrl = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const walletAddress = auth.address || "0x0000000000000000000000000000000000000000";

      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          walletAddress,
          isEmailUser: auth.isEmailUser,
        }),
      });

      let reply = "J14-75 is processing your request.";
      let toolUsed: string | undefined;

      if (res.ok) {
        const data = await res.json();
        reply = data.reply ?? reply;
        if (data.txHash) toolUsed = "on-chain";
        else if (content.toLowerCase().includes("balance")) toolUsed = "check_balance";
        else if (content.toLowerCase().includes("bridge")) toolUsed = "bridge_usdc";
        else if (content.toLowerCase().includes("swap")) toolUsed = "kit.swap";
        else if (content.toLowerCase().includes("audit") || content.toLowerCase().includes("contract")) toolUsed = "audit_contract";
      } else {
        const errData = await res.json().catch(() => ({}));
        reply = errData.reply ?? `⚠️ Agent error (${res.status}). Please try again.`;
      }

      const agentMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "agent",
        content: reply,
        timestamp: new Date(),
        toolUsed,
      };
      setMessages(prev => [...prev, agentMsg]);
    } catch (err: any) {
      const errMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "agent",
        content: `⚠️ Connection error: ${err.message ?? "Could not reach the agent backend."}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setIsTyping(false);
    }
  }, [input, isTyping, auth]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isConnected = auth.mode !== "none" && !!auth.address;

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden" style={{ background: "#000000" }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-5 shrink-0 relative"
        style={{ height: 56, borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Cpu size={16} style={{ color: "#FF6B00" }} />
            <span className="font-bold text-sm tracking-tight text-white">Command Center</span>
          </div>
          <div
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold"
            style={{ background: "rgba(255,107,0,0.1)", color: "#FF6B00", border: "1px solid rgba(255,107,0,0.2)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: "#FF6B00" }} />
            ERC-8004 · Arc Testnet
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium"
                style={{
                  background: auth.isEmailUser ? "rgba(34,197,94,0.1)" : "rgba(34,197,94,0.1)",
                  border: `1px solid ${auth.isEmailUser ? "rgba(255,107,0,0.3)" : "rgba(34,197,94,0.2)"}`,
                  color: auth.isEmailUser ? "#FF6B00" : "#22c55e",
                }}
              >
                {auth.isEmailUser ? <Mail size={11} /> : <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#22c55e" }} />}
                {auth.isEmailUser
                  ? <span className="truncate max-w-[100px]">{(auth as any).email ?? "Email user"}</span>
                  : <span className="font-mono">{truncateAddress(auth.address)}</span>
                }
                {auth.isEmailUser && (
                  <span className="text-[9px] px-1 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.2)", color: "#22c55e" }}>
                    GASLESS
                  </span>
                )}
              </motion.div>
              <button
                onClick={signOut}
                className="p-1.5 rounded-lg opacity-40 hover:opacity-80 transition-opacity"
                title="Sign out"
              >
                <LogOut size={13} />
              </button>
            </>
          ) : (
            <>
              {/* Email Sign In Button */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setShowEmailPanel(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-opacity"
                style={{
                  background: "rgba(255,107,0,0.1)",
                  border: "1px solid rgba(255,107,0,0.25)",
                  color: "#FF6B00",
                }}
              >
                <Mail size={12} />
                Email Sign In
              </motion.button>

              {/* Connect Wallet Button */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={connectWallet}
                disabled={connecting}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold text-black disabled:opacity-60 transition-opacity"
                style={{ background: "linear-gradient(135deg, #FF6B00, #FFB300)" }}
              >
                <Wallet size={12} />
                {connecting ? "Connecting..." : "Connect Wallet"}
              </motion.button>
            </>
          )}

          <a
            href="/command-center"
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg opacity-30 hover:opacity-70 transition-opacity"
          >
            <ExternalLink size={13} />
          </a>
        </div>

        {/* Email OTP Panel (dropdown) */}
        <AnimatePresence>
          {showEmailPanel && !isConnected && (
            <EmailSignInPanel onSuccess={onEmailSuccess} onClose={() => setShowEmailPanel(false)} />
          )}
        </AnimatePresence>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <AgentSidebar auth={auth} />

        {/* ── Main Chat ───────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 pt-5" style={{ paddingBottom: 8 }}>
            {messages.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center h-full gap-3 pb-16"
              >
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, #FF6B00 0%, #FFB300 100%)" }}
                >
                  <span className="text-black font-black text-xl">J</span>
                </div>
                <div className="text-center">
                  <div className="font-bold text-white text-base">J14-75 is ready</div>
                  <div className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>
                    {isConnected
                      ? "Ask me to check balances, transfer tokens, bridge USDC, or swap."
                      : "Connect your wallet or sign in with email to get started."}
                  </div>
                </div>
              </motion.div>
            )}

            <AnimatePresence mode="popLayout">
              {messages.map(msg => (
                <ChatMessage key={msg.id} message={msg} />
              ))}
              {isTyping && <TypingIndicator key="typing" />}
            </AnimatePresence>
            <div ref={bottomRef} />
          </div>

          {/* ── Input area (no quick action chips) ────────────────────────── */}
          <div className="px-4 pb-4 pt-2 shrink-0">
            <div
              className="flex items-end gap-2 rounded-2xl p-2 pl-4"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  isConnected
                    ? "Ask J14-75 — check balance, transfer, bridge USDC, swap tokens..."
                    : "Connect wallet or sign in with email to start..."
                }
                rows={1}
                disabled={isTyping || !isConnected}
                className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed py-1 disabled:opacity-40"
                style={{
                  color: "rgba(255,255,255,0.85)",
                  maxHeight: 120,
                  caretColor: "#FF6B00",
                }}
                onInput={e => {
                  const t = e.currentTarget;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 120) + "px";
                }}
              />
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.93 }}
                onClick={() => sendMessage()}
                disabled={!input.trim() || isTyping || !isConnected}
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-30 transition-all"
                style={{ background: "linear-gradient(135deg, #FF6B00, #FFB300)" }}
              >
                <Send size={14} className="text-black" style={{ transform: "translateX(1px)" }} />
              </motion.button>
            </div>

            <div className="flex items-center justify-center mt-2 gap-1">
              <AlertTriangle size={10} style={{ color: "rgba(255,255,255,0.2)" }} />
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                Testnet only · Real on-chain execution via Arc App Kit · J14-75 is autonomous
              </span>
            </div>
          </div>
        </main>

        {/* ── Right sidebar ─────────────────────────────────────────────────── */}
        <aside
          className="w-[180px] shrink-0 hidden lg:flex flex-col gap-3 py-5 px-4"
          style={{ borderLeft: "1px solid rgba(255,255,255,0.05)" }}
        >
          <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>
            Capabilities
          </div>

          {[
            { icon: Wallet, label: "Wallet Mgmt", desc: "SCA wallets on Circle infra" },
            { icon: BarChart3, label: "Balance Check", desc: "Arc Testnet on-chain" },
            { icon: ArrowRightLeft, label: "CCTP Bridge", desc: "Cross-chain USDC" },
            { icon: Zap, label: "Swap Tokens", desc: "kit.swap() via KIT_KEY" },
            { icon: Shield, label: "KYC Verified", desc: "ERC-8004 validated" },
          ].map(cap => (
            <div key={cap.label} className="glass rounded-xl p-3 flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <cap.icon size={11} style={{ color: "#FF6B00" }} />
                <span className="text-[11px] font-semibold text-white">{cap.label}</span>
              </div>
              <span className="text-[10px] leading-relaxed" style={{ color: "rgba(255,255,255,0.35)" }}>
                {cap.desc}
              </span>
            </div>
          ))}

          <div className="mt-auto glass rounded-xl p-3 text-center">
            <div className="flex justify-center mb-1">
              <ScoreRing value={AGENT_METRICS.reputation} size={44} />
            </div>
            <div className="text-[10px] font-bold" style={{ color: "#FF6B00" }}>{AGENT_METRICS.reputation}/100</div>
            <div className="text-[9px]" style={{ color: "rgba(255,255,255,0.3)" }}>Reputation</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
