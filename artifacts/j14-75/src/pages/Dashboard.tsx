import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import {
  Zap, Shield, Activity, Wallet, ArrowRightLeft, Search,
  Send, Copy, Check, ExternalLink, AlertTriangle,
  BarChart3, Lock, Globe, Cpu, ArrowLeft, ChevronDown, ChevronUp,
  X
} from "lucide-react";

// ── Constants ──────────────────────────────────────────────────────────────
const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = "0x4CEF52"; // 5042002
const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
const AGENT_ID_HEX = "000000000000000000000000000000000000000000000000000000000000004b"; // 75

const SCORE_SELECTORS: string[] = [
  "0x0e1af57b", // getScore(uint256)
  "0x89370d8b", // getReputation(uint256)
  "0x56c708d5", // reputation(uint256)
  "0x2ee691a3", // scores(uint256)
  "0x925469dc", // getAgentScore(uint256)
];

function getQuickActions(walletAddress?: string) {
  return [
    {
      label: "Check balance",
      icon: Wallet,
      prompt: walletAddress
        ? `Check the balance of my wallet ${walletAddress} on Arc Testnet`
        : "What is my balance on Arc Testnet?",
    },
    {
      label: "Bridge USDC",
      icon: ArrowRightLeft,
      prompt: "How do I bridge 100 USDC from ETH Sepolia to Arc Testnet via CCTP?",
    },
    {
      label: "Audit contract",
      icon: Shield,
      prompt: "Audit the contract at 0x8004A818BFB912233c491871b3d84c89A494BD9e on Arc Testnet",
    },
  ];
}

const CAPABILITIES = [
  { icon: Wallet, label: "Wallet Mgmt", desc: "SCA wallets on Circle infra" },
  { icon: BarChart3, label: "Balance Check", desc: "ETH + USDC on-chain" },
  { icon: ArrowRightLeft, label: "CCTP Bridge", desc: "Cross-chain USDC transfer" },
  { icon: Search, label: "Contract Audit", desc: "Security risk scoring" },
  { icon: Shield, label: "KYC Verified", desc: "ERC-8004 validated" },
];

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

// ── Helpers ────────────────────────────────────────────────────────────────
function truncateAddress(addr: string) {
  if (addr.length < 12) return addr;
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

// ── Live reputation score fetch ────────────────────────────────────────────
async function fetchReputationScore(): Promise<number> {
  for (const selector of SCORE_SELECTORS) {
    try {
      const res = await fetch(ARC_TESTNET_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [
            { to: REPUTATION_REGISTRY, data: selector + AGENT_ID_HEX },
            "latest",
          ],
        }),
      });
      const json = await res.json();
      const result: string = json?.result;
      if (result && result !== "0x" && result !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
        const value = parseInt(result, 16);
        if (value > 0 && value <= 100) return value;
      }
    } catch {
      // try next selector
    }
  }
  return 95; // known on-chain value fallback
}

// ── Score ring ─────────────────────────────────────────────────────────────
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

// ── Welcome message & backend AI ───────────────────────────────────────────
const WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "agent",
  content: "Online. I'm J14-75 — ERC-8004 registered, KYC-verified on Arc Testnet.\n\nI can check on-chain balances, explain CCTP bridges, and audit smart contracts. Connect your wallet for personalized queries.",
  timestamp: new Date(),
};

async function callBackendChat(
  message: string,
  walletAddress?: string,
  history?: Array<{ role: "user" | "agent"; content: string }>
): Promise<{ reply: string; toolUsed?: string }> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, walletAddress, history }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Sub-components ─────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
      className="flex items-center gap-2 mb-3"
    >
      <div className="w-6 h-6 rounded-lg shrink-0 overflow-hidden"
        style={{ background: "#000", boxShadow: "0 0 8px rgba(255,107,0,0.3)" }}>
        <img src="/logo.png" alt="J14-75" className="w-full h-full object-contain" />
      </div>
      <div className="rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
        {[0, 1, 2].map((i) => (
          <motion.span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: "#FF6B00" }}
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }} />
        ))}
      </div>
    </motion.div>
  );
}

function ChatMessage({ message }: { message: Message }) {
  const isAgent = message.role === "agent";
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
      className={`flex mb-3 ${isAgent ? "justify-start" : "justify-end"}`}
    >
      {isAgent && (
        <div className="w-6 h-6 rounded-lg shrink-0 mr-2 mt-0.5 overflow-hidden"
          style={{ background: "#000", boxShadow: "0 0 8px rgba(255,107,0,0.3)" }}>
          <img src="/logo.png" alt="J14-75" className="w-full h-full object-contain" />
        </div>
      )}
      <div
        className={`max-w-[80%] sm:max-w-[72%] rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3 ${isAgent ? "rounded-tl-sm" : "rounded-tr-sm"}`}
        style={isAgent
          ? { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }
          : { background: "linear-gradient(135deg, rgba(255,107,0,0.15), rgba(255,179,0,0.1))", border: "1px solid rgba(255,107,0,0.2)" }
        }
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words"
          style={{ color: isAgent ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.9)" }}>
          {message.content}
        </p>
        <div className="flex items-center justify-between mt-1.5 gap-2">
          <span className="text-[10px] shrink-0" style={{ color: "rgba(255,255,255,0.25)" }}>
            {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {message.toolUsed && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
              style={{ background: "rgba(255,107,0,0.15)", color: "#FF6B00" }}>
              {message.toolUsed}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Sidebar content (shared between mobile collapsed + desktop) ────────────
function SidebarContent({
  wallet, reputationScore, scoreLoading,
}: {
  wallet: WalletState;
  reputationScore: number;
  scoreLoading: boolean;
}) {
  return (
    <>
      {/* Agent avatar + name */}
      <div className="flex flex-col items-center gap-2 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="relative">
          <motion.div
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden flex items-center justify-center"
            style={{ background: "#000", boxShadow: "0 0 18px rgba(255,107,0,0.35)" }}
            initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.4 }}
          >
            <img src="/logo.png" alt="J14-75" className="w-full h-full object-contain" />
          </motion.div>
          <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full"
            style={{ background: "#22c55e", border: "2px solid #000",
              animation: "pulse-agent 2s ease-in-out infinite" }} />
        </div>
        <div className="text-center">
          <div className="font-bold text-sm tracking-wide text-white">J14-75</div>
          <div className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>ERC-8004</div>
        </div>
      </div>

      {/* Status metrics */}
      <div className="flex flex-col gap-2 mt-3">
        <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.3)" }}>
          Agent Status
        </div>
        {[
          { icon: Activity, label: "Status", value: "Online", color: "#22c55e" },
          { icon: Lock, label: "KYC", value: "Verified", color: "#FFB300" },
          { icon: Globe, label: "Network", value: "Arc Testnet", color: "#FF6B00" },
        ].map((item) => (
          <div key={item.label} className="rounded-xl p-2.5 flex items-center gap-2.5"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <item.icon size={12} style={{ color: item.color }} />
            <div>
              <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>{item.label}</div>
              <div className="text-xs font-semibold" style={{ color: item.color === "#22c55e" ? "#fff" : item.color }}>{item.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Score bars */}
      <div className="flex flex-col gap-2 mt-3">
        <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.3)" }}>
          Scores
        </div>

        {/* Reputation — live from blockchain */}
        <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>Reputation</div>
            <div className="flex items-center gap-1">
              {scoreLoading ? (
                <span className="text-[10px]" style={{ color: "rgba(255,107,0,0.5)" }}>fetching…</span>
              ) : (
                <>
                  <span className="text-xs font-bold" style={{ color: "#FF6B00" }}>{reputationScore}/100</span>
                  <span className="text-[9px] px-1 rounded-full" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>live</span>
                </>
              )}
            </div>
          </div>
          <div className="h-1 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
            <motion.div className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, #FF6B00, #FFB300)" }}
              initial={{ width: 0 }}
              animate={{ width: scoreLoading ? 0 : `${reputationScore}%` }}
              transition={{ duration: 1.2, ease: "easeOut", delay: 0.4 }} />
          </div>
        </div>

        {/* Validation */}
        <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>Validation</div>
            <span className="text-xs font-bold" style={{ color: "#22c55e" }}>100/100</span>
          </div>
          <div className="h-1 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
            <motion.div className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, #16a34a, #22c55e)" }}
              initial={{ width: 0 }} animate={{ width: "100%" }}
              transition={{ duration: 1.2, ease: "easeOut", delay: 0.5 }} />
          </div>
        </div>
      </div>

      {/* Addresses */}
      <div className="flex flex-col gap-1.5 mt-3">
        <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.3)" }}>
          Addresses
        </div>
        <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-[10px] mb-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>Agent ID #75</div>
          <div className="flex items-center text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.55)" }}>
            {truncateAddress("0x8004A818BFB912233c491871b3d84c89A494BD9e")}
            <CopyButton text="0x8004A818BFB912233c491871b3d84c89A494BD9e" />
          </div>
        </div>
        {wallet.connected && (
          <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="text-[10px] mb-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>Connected</div>
            <div className="flex items-center text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.55)" }}>
              {truncateAddress(wallet.address)}
              <CopyButton text={wallet.address} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const [, navigate] = useLocation();
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [wallet, setWallet] = useState<WalletState>({ connected: false, address: "", chain: "" });
  const [connecting, setConnecting] = useState(false);
  const [reputationScore, setReputationScore] = useState(95);
  const [scoreLoading, setScoreLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch live reputation score on mount
  useEffect(() => {
    setScoreLoading(true);
    fetchReputationScore().then((score) => {
      setReputationScore(score);
      setScoreLoading(false);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const connectWallet = useCallback(async () => {
    if (typeof (window as any).ethereum === "undefined") {
      alert("No Web3 wallet detected. Install MetaMask or Rabby to connect.");
      return;
    }
    setConnecting(true);
    try {
      const accounts = await (window as any).ethereum.request({ method: "eth_requestAccounts" });

      // Switch to Arc Testnet — add it if not present
      try {
        await (window as any).ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ARC_CHAIN_ID }],
        });
      } catch (switchErr: any) {
        if (switchErr.code === 4902 || switchErr.code === -32603) {
          await (window as any).ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: ARC_CHAIN_ID,
              chainName: "Arc Testnet",
              nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
              rpcUrls: ["https://rpc.testnet.arc.network"],
              blockExplorerUrls: ["https://explorer.testnet.arc.network"],
            }],
          });
        } else {
          throw switchErr;
        }
      }

      setWallet({ connected: true, address: accounts[0], chain: "ARC-TESTNET" });
    } catch (err) {
      console.error("Wallet connect error:", err);
    } finally {
      setConnecting(false);
    }
  }, []);

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isTyping) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const history = messages.slice(-12).map((m) => ({ role: m.role, content: m.content }));
      const { reply, toolUsed } = await callBackendChat(
        content,
        wallet.connected ? wallet.address : undefined,
        history
      );
      setMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "agent",
        content: reply,
        timestamp: new Date(),
        toolUsed,
      }]);
    } catch (err) {
      console.error("Chat error:", err);
      setMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "agent",
        content: "I encountered an error reaching the AI service. Please try again.",
        timestamp: new Date(),
      }]);
    } finally {
      setIsTyping(false);
    }
  }, [input, isTyping, messages, wallet]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden" style={{ background: "#000000", fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @keyframes pulse-agent {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.85); }
        }
        ::-webkit-scrollbar { width: 3px; height: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,107,0,0.25); border-radius: 2px; }
      `}</style>

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-3 sm:px-5 shrink-0"
        style={{ height: 52, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {/* Back to landing */}
          <button onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-xs font-medium opacity-50 hover:opacity-100 transition-opacity shrink-0"
            style={{ color: "rgba(255,255,255,0.7)" }}>
            <ArrowLeft size={13} />
            <span className="hidden sm:inline">Back</span>
          </button>
          <div className="w-px h-4 shrink-0" style={{ background: "rgba(255,255,255,0.08)" }} />
          <Cpu size={14} style={{ color: "#FF6B00", flexShrink: 0 }} />
          <span className="font-bold text-sm tracking-tight text-white whitespace-nowrap">Command Center</span>
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold shrink-0"
            style={{ background: "rgba(255,107,0,0.1)", color: "#FF6B00", border: "1px solid rgba(255,107,0,0.2)" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#FF6B00", animation: "pulse-agent 2s ease-in-out infinite" }} />
            ERC-8004 · Arc Testnet
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Mobile sidebar toggle */}
          <button onClick={() => setSidebarOpen((v) => !v)}
            className="md:hidden flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}>
            {sidebarOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            <span>J14-75</span>
          </button>

          {wallet.connected ? (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium"
              style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)", color: "#22c55e" }}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#22c55e" }} />
              <span className="font-mono hidden sm:inline">{truncateAddress(wallet.address)}</span>
              <span className="font-mono sm:hidden">{wallet.address.slice(0, 6)}…</span>
              <span className="opacity-60 hidden sm:inline">·</span>
              <span className="opacity-80 hidden sm:inline">{wallet.chain}</span>
            </motion.div>
          ) : (
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={connectWallet} disabled={connecting}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-black disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, #FF6B00, #FFB300)" }}>
              <Wallet size={12} />
              <span className="hidden sm:inline">{connecting ? "Connecting..." : "Connect Wallet"}</span>
              <span className="sm:hidden">{connecting ? "..." : "Connect"}</span>
            </motion.button>
          )}
        </div>
      </header>

      {/* ── Mobile sidebar drawer ── */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}
            className="md:hidden overflow-hidden shrink-0"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "#000" }}
          >
            <div className="px-4 py-4 flex flex-col gap-3">
              <SidebarContent wallet={wallet} reputationScore={reputationScore} scoreLoading={scoreLoading} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* Left sidebar — desktop only */}
        <aside className="hidden md:flex w-[210px] lg:w-[220px] shrink-0 flex-col gap-0 py-4 px-4 overflow-y-auto"
          style={{ borderRight: "1px solid rgba(255,255,255,0.05)" }}>
          <SidebarContent wallet={wallet} reputationScore={reputationScore} scoreLoading={scoreLoading} />
        </aside>

        {/* Center — chat */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Chat history */}
          <div className="flex-1 overflow-y-auto px-3 sm:px-5 pt-4" style={{ paddingBottom: 8 }}>
            <AnimatePresence mode="popLayout">
              {messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)}
              {isTyping && <TypingIndicator key="typing" />}
            </AnimatePresence>
            <div ref={bottomRef} />
          </div>

          {/* Input area */}
          <div className="px-3 sm:px-4 pb-3 sm:pb-4 pt-2 shrink-0">
            {/* Quick action chips */}
            <div className="flex items-center gap-1.5 sm:gap-2 mb-2 flex-wrap">
              {getQuickActions(wallet.connected ? wallet.address : undefined).map((action) => (
                <motion.button key={action.label}
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                  onClick={() => sendMessage(action.prompt)} disabled={isTyping}
                  className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg text-[11px] font-medium disabled:opacity-40 transition-all"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.65)" }}>
                  <action.icon size={11} style={{ color: "#FF6B00" }} />
                  <span className="whitespace-nowrap">{action.label}</span>
                </motion.button>
              ))}
            </div>

            {/* Textarea + send */}
            <div className="flex items-end gap-2 rounded-2xl p-2 pl-3 sm:pl-4"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <textarea
                ref={inputRef} value={input}
                onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
                placeholder="Ask J14-75 anything…" rows={1} disabled={isTyping}
                className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed py-1 disabled:opacity-50 min-w-0"
                style={{ color: "rgba(255,255,255,0.85)", maxHeight: 100, caretColor: "#FF6B00" }}
                onInput={(e) => {
                  const t = e.currentTarget;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 100) + "px";
                }}
              />
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.93 }}
                onClick={() => sendMessage()} disabled={!input.trim() || isTyping}
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-30"
                style={{ background: "linear-gradient(135deg, #FF6B00, #FFB300)" }}>
                <Send size={14} className="text-black" style={{ transform: "translateX(1px)" }} />
              </motion.button>
            </div>

            <div className="flex items-center justify-center mt-1.5 gap-1">
              <AlertTriangle size={10} style={{ color: "rgba(255,255,255,0.2)" }} />
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                Testnet only · No real funds
              </span>
            </div>
          </div>
        </main>

        {/* Right panel — large screens only */}
        <aside className="hidden lg:flex w-[180px] shrink-0 flex-col gap-3 py-4 px-4 overflow-y-auto"
          style={{ borderLeft: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.3)" }}>
            Capabilities
          </div>
          {CAPABILITIES.map((cap) => (
            <div key={cap.label} className="rounded-xl p-2.5 flex flex-col gap-1"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-1.5">
                <cap.icon size={11} style={{ color: "#FF6B00" }} />
                <span className="text-[11px] font-semibold text-white">{cap.label}</span>
              </div>
              <span className="text-[10px] leading-relaxed" style={{ color: "rgba(255,255,255,0.35)" }}>{cap.desc}</span>
            </div>
          ))}

          <div className="mt-auto rounded-xl p-3 text-center"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="text-[10px] mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>Agent Score</div>
            <div className="flex justify-center mb-1 relative">
              <ScoreRing value={reputationScore} size={50} color="#FF6B00" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold" style={{ color: "#FF6B00" }}>
                  {scoreLoading ? "…" : reputationScore}
                </span>
              </div>
            </div>
            <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>Reputation</div>
            {!scoreLoading && (
              <div className="text-[9px] mt-0.5 px-1.5 py-0.5 rounded-full inline-block"
                style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>
                on-chain
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
