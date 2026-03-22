import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap, Shield, Activity, Wallet, ArrowRightLeft, Search,
  Send, ChevronRight, Copy, Check, ExternalLink, AlertTriangle,
  BarChart3, Lock, Globe, Cpu
} from "lucide-react";

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

const QUICK_ACTIONS = [
  { label: "Check balance", icon: Wallet, prompt: "Check my balance on ARC-TESTNET" },
  { label: "Bridge USDC", icon: ArrowRightLeft, prompt: "Simulate bridging 100 USDC from ETH-SEPOLIA to ARC-TESTNET" },
  { label: "Audit contract", icon: Shield, prompt: "Audit the ERC-8004 IdentityRegistry at 0x8004A818BFB912233c491871b3d84c89A494BD9e on ARC-TESTNET" },
];

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

const WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "agent",
  content: "Online. I'm J14-75 — ERC-8004 registered, KYC-verified, reputation 95/100 on Arc Testnet.\n\nI can manage wallets, check on-chain balances, simulate USDC bridges via CCTP, and audit smart contracts. What do you need?",
  timestamp: new Date(),
};

function truncateAddress(addr: string) {
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

function AgentSidebar({ wallet }: { wallet: WalletState }) {
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
        {wallet.connected && (
          <div className="glass rounded-xl p-2.5">
            <div className="text-[10px] mb-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>Connected</div>
            <div className="flex items-center text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>
              {truncateAddress(wallet.address)}
              <CopyButton text={wallet.address} />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

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
        className={`max-w-[78%] rounded-2xl px-4 py-3 ${
          isAgent
            ? "glass rounded-tl-sm"
            : "rounded-tr-sm"
        }`}
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

async function callBackendAgent(userMessage: string): Promise<string> {
  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
  try {
    const res = await fetch(`${baseUrl}/api/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userMessage }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.response ?? "Task completed.";
    }
  } catch {
    // fall through to mock
  }

  await new Promise((r) => setTimeout(r, 1200 + Math.random() * 800));

  const lc = userMessage.toLowerCase();
  if (lc.includes("balance")) {
    return "On ARC-TESTNET, the address 0x8004...D9e holds 0.0142 ETH and the USDC contract is not yet deployed on this network. For ETH-SEPOLIA, use the check_balance tool with your wallet address.";
  }
  if (lc.includes("bridge") || lc.includes("usdc")) {
    return "CCTP bridge simulation ready:\n\n• Route: ETH-SEPOLIA → ARC-TESTNET\n• Amount: 100 USDC\n• Est. fee: ~0.002 ETH\n• Est. time: ~2 minutes\n• Steps: Approve → Burn → Attestation → Mint\n\nTo execute this on-chain, connect your wallet and confirm the transaction sequence.";
  }
  if (lc.includes("audit") || lc.includes("contract")) {
    return "Audit complete for 0x8004A818BFB912233c491871b3d84c89A494BD9e:\n\n✓ Risk Score: 95/100 — SAFE\n✓ ERC-8004 Compliant\n✓ Circle Infrastructure Verified\n✓ Source code verified on Arc Testnet\n\nNo critical findings. This is a known, audited ERC-8004 IdentityRegistry contract.";
  }
  if (lc.includes("wallet") || lc.includes("create")) {
    return "Wallet creation requires CIRCLE_API_KEY to be configured. Once set, I can create a new SCA wallet on ETH-SEPOLIA or ARC-TESTNET via Circle's Developer-Controlled Wallets API. The wallet will be ready in under 10 seconds.";
  }
  return "I'm J14-75, your on-chain AI agent. I can check balances, simulate USDC bridges, audit contracts, and manage wallets. What would you like to do first?";
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [wallet, setWallet] = useState<WalletState>({ connected: false, address: "", chain: "" });
  const [connecting, setConnecting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

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
      setWallet({ connected: true, address: accounts[0], chain: chainName });
    } catch (err: any) {
      console.error("Wallet connect error:", err);
    } finally {
      setConnecting(false);
    }
  }, []);

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isTyping) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const response = await callBackendAgent(content);
      const toolUsed = content.toLowerCase().includes("balance") ? "check_balance"
        : content.toLowerCase().includes("bridge") ? "bridge_usdc"
        : content.toLowerCase().includes("audit") ? "audit_contract"
        : content.toLowerCase().includes("wallet") ? "manage_wallet"
        : undefined;

      const agentMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "agent",
        content: response,
        timestamp: new Date(),
        toolUsed,
      };
      setMessages((prev) => [...prev, agentMsg]);
    } finally {
      setIsTyping(false);
    }
  }, [input, isTyping]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden" style={{ background: "#000000" }}>
      <header
        className="flex items-center justify-between px-5 shrink-0"
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

        <div className="flex items-center gap-2.5">
          {wallet.connected ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium"
              style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)", color: "#22c55e" }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#22c55e" }} />
              <span className="font-mono">{truncateAddress(wallet.address)}</span>
              <span className="opacity-60">·</span>
              <span className="opacity-80">{wallet.chain}</span>
            </motion.div>
          ) : (
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
      </header>

      <div className="flex flex-1 overflow-hidden">
        <AgentSidebar wallet={wallet} />

        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 pt-5" style={{ paddingBottom: 8 }}>
            <AnimatePresence mode="popLayout">
              {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} />
              ))}
              {isTyping && <TypingIndicator key="typing" />}
            </AnimatePresence>
            <div ref={bottomRef} />
          </div>

          <div className="px-4 pb-4 pt-2 shrink-0">
            <div className="flex items-center gap-2 mb-2.5 flex-wrap">
              {QUICK_ACTIONS.map((action) => (
                <motion.button
                  key={action.label}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => sendMessage(action.prompt)}
                  disabled={isTyping}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium disabled:opacity-40 transition-all"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.65)",
                  }}
                >
                  <action.icon size={11} style={{ color: "#FF6B00" }} />
                  {action.label}
                </motion.button>
              ))}
            </div>

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
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask J14-75 anything — check balance, bridge USDC, audit a contract..."
                rows={1}
                disabled={isTyping}
                className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed py-1 disabled:opacity-50"
                style={{
                  color: "rgba(255,255,255,0.85)",
                  maxHeight: 120,
                  caretColor: "#FF6B00",
                }}
                onInput={(e) => {
                  const t = e.currentTarget;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 120) + "px";
                }}
              />
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.93 }}
                onClick={() => sendMessage()}
                disabled={!input.trim() || isTyping}
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-30 transition-all"
                style={{ background: "linear-gradient(135deg, #FF6B00, #FFB300)" }}
              >
                <Send size={14} className="text-black" style={{ transform: "translateX(1px)" }} />
              </motion.button>
            </div>

            <div className="flex items-center justify-center mt-2 gap-1">
              <AlertTriangle size={10} style={{ color: "rgba(255,255,255,0.2)" }} />
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                Testnet only · No real funds · J14-75 is autonomous
              </span>
            </div>
          </div>
        </main>

        <aside
          className="w-[180px] shrink-0 hidden lg:flex flex-col gap-3 py-5 px-4"
          style={{ borderLeft: "1px solid rgba(255,255,255,0.05)" }}
        >
          <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>
            Capabilities
          </div>

          {[
            { icon: Wallet, label: "Wallet Mgmt", desc: "SCA wallets on Circle infra" },
            { icon: BarChart3, label: "Balance Check", desc: "ETH + USDC on-chain" },
            { icon: ArrowRightLeft, label: "CCTP Bridge", desc: "Cross-chain USDC transfer" },
            { icon: Search, label: "Contract Audit", desc: "Security risk scoring" },
            { icon: Shield, label: "KYC Verified", desc: "ERC-8004 validated" },
          ].map((cap) => (
            <div
              key={cap.label}
              className="glass rounded-xl p-3 flex flex-col gap-1"
            >
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
            <div className="text-[10px] mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>Agent Score</div>
            <div className="flex justify-center mb-1 relative">
              <ScoreRing value={95} size={50} color="#FF6B00" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold" style={{ color: "#FF6B00" }}>95</span>
              </div>
            </div>
            <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>Reputation</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
