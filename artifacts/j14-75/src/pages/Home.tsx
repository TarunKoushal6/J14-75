"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useInView } from "framer-motion";
import logoSrc from "/logo.png";

const TERMINAL_LINES = [
  "> SYSTEM INIT :: J14-75 :: ARC-TESTNET",
  "> CONTRACT :: 0x8004A818BFB912233c491871b3d84c89A494BD9e",
  "> TX :: register(string) → tokenId=75 MINTED :: COMPLETE",
  "> OWNER :: 0xa622be0174361B375943C37a92b4018e1E2FB477",
  "> CONTRACT :: 0x8004B663056A597Dffe9eCcC1965A193B7388713",
  "> TX :: giveFeedback(75, 95, 0, successful_trade, ...) :: COMPLETE",
  "> REPUTATION SCORE :: 95/100 :: LOGGED",
  "> CONTRACT :: 0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
  "> TX :: validationRequest(0x4f3a37..., 75, ipfs://...) :: COMPLETE",
  "> TX :: validationResponse(0x..., 100, '', kyc_verified) :: COMPLETE",
  "> VALIDATION STATUS :: SCORE=100 :: NOTES=kyc_verified",
  "> KYC STATUS :: VERIFIED :: TIMESTAMP=2026-03-18T10:01:28.000Z",
  "> WALLET :: CIRCLE DEV-CONTROLLED :: ARC-TESTNET :: SCA",
  "> USDC BALANCE :: AVAILABLE :: PROGRAMMABLE ESCROW :: READY",
  "> AGENT J14-75 :: ALL SYSTEMS OPERATIONAL :: STANDING BY",
];

const FEATURE_CARDS = [
  {
    id: "always-on",
    title: "Always On",
    description:
      "Monitors the digital space around the clock — 24 hours a day, 7 days a week. It never sleeps, never pauses, and is always ready to act the moment it's needed.",
    icon: "◈",
  },
  {
    id: "smart-automation",
    title: "Smart Automation",
    description:
      "Executes tasks and makes decisions automatically, guided by trusted, real-time data. No manual input required — just reliable results, every time.",
    icon: "◎",
  },
  {
    id: "secure-verified",
    title: "Secure & Verified",
    description:
      "Operates with its own secure digital wallet and a verified on-chain identity. Every action is traceable, tamper-proof, and built on complete trust.",
    icon: "◉",
  },
];

function useScrollReveal(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: threshold });
  return { ref, isInView };
}

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, ease: [0.25, 0.1, 0.25, 1] as const },
  },
};

const fadeScale = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.9, ease: [0.25, 0.1, 0.25, 1] as const },
  },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.14 } },
};

function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        position: "fixed",
        top: "1.1rem",
        right: "1.25rem",
        zIndex: 10000,
        width: 52,
        height: 28,
        borderRadius: 999,
        background: dark ? "rgba(255,107,0,0.18)" : "rgba(0,0,0,0.12)",
        border: dark ? "1px solid rgba(255,107,0,0.4)" : "1px solid rgba(0,0,0,0.18)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        cursor: "pointer",
        padding: "4px",
        display: "flex",
        alignItems: "center",
        justifyContent: dark ? "flex-start" : "flex-end",
        transition: "background 0.35s ease, border-color 0.35s ease",
        outline: "none",
      }}
    >
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 520, damping: 38 }}
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: dark
            ? "linear-gradient(135deg, #FF6B00, #FFB300)"
            : "linear-gradient(135deg, #2d3561, #6c7fc4)",
          boxShadow: dark ? "0 0 10px rgba(255,107,0,0.65)" : "0 0 6px rgba(0,0,0,0.25)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          color: "#fff",
          flexShrink: 0,
        }}
      >
        {dark ? "☀" : "☽"}
      </motion.div>
    </button>
  );
}

export default function Home() {
  const [dark, setDark] = useState(true);
  const [count, setCount] = useState(0);
  const [preloaderVisible, setPreloaderVisible] = useState(true);
  const [preloaderExiting, setPreloaderExiting] = useState(false);
  const [visibleLines, setVisibleLines] = useState<string[]>([]);
  const lineIndexRef = useRef(0);
  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const terminalSectionRef = useRef<HTMLDivElement>(null);
  const terminalIsInView = useInView(terminalSectionRef, { once: true, amount: 0.2 });

  const act2Reveal = useScrollReveal(0.15);
  const act3Left = useScrollReveal(0.15);
  const act3Right = useScrollReveal(0.15);
  const footerReveal = useScrollReveal(0.5);

  /* ── Restore saved theme ── */
  useEffect(() => {
    const stored = localStorage.getItem("j1475-theme");
    if (stored === "light") setDark(false);
  }, []);

  /* ── Push theme to body (covers overscroll areas too) ── */
  useEffect(() => {
    document.body.style.setProperty("background", dark ? "#000000" : "#f4efe8", "important");
    document.body.style.setProperty("color", dark ? "#F8F9FA" : "#1a1612", "important");
    return () => {
      document.body.style.removeProperty("background");
      document.body.style.removeProperty("color");
    };
  }, [dark]);

  const toggleTheme = () => {
    setDark((prev) => {
      const next = !prev;
      localStorage.setItem("j1475-theme", next ? "dark" : "light");
      return next;
    });
  };

  /* ── Preloader counter ── */
  useEffect(() => {
    const interval = setInterval(() => {
      setCount((prev) => {
        if (prev >= 75) {
          clearInterval(interval);
          setTimeout(() => setPreloaderExiting(true), 600);
          setTimeout(() => setPreloaderVisible(false), 1400);
          return 75;
        }
        return prev + 1;
      });
    }, 18);
    return () => clearInterval(interval);
  }, []);

  /* ── Terminal typewriter ── */
  useEffect(() => {
    if (!terminalIsInView) return;
    lineIndexRef.current = 0;
    const interval = setInterval(() => {
      if (lineIndexRef.current < TERMINAL_LINES.length) {
        const line = TERMINAL_LINES[lineIndexRef.current];
        if (line !== undefined) setVisibleLines((prev) => [...prev, line]);
        lineIndexRef.current++;
      } else {
        clearInterval(interval);
      }
    }, 900);
    return () => clearInterval(interval);
  }, [terminalIsInView]);

  useEffect(() => {
    if (terminalBodyRef.current)
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
  }, [visibleLines]);

  /* ── Design tokens — every colour derived here ── */
  const bg          = dark ? "#000000"                      : "#f4efe8";
  const text        = dark ? "#F8F9FA"                      : "#1a1612";
  const textMuted   = dark ? "rgba(209,213,219,0.72)"       : "rgba(55,44,33,0.68)";
  const labelColor  = dark ? "rgba(255,255,255,0.38)"       : "rgba(0,0,0,0.38)";
  const cardBg      = dark ? "rgba(255,255,255,0.03)"       : "rgba(255,255,255,0.65)";
  const cardBorder  = dark ? "rgba(255,255,255,0.08)"       : "rgba(0,0,0,0.1)";
  const divider     = dark ? "rgba(255,107,0,0.14)"         : "rgba(255,107,0,0.22)";
  const videoBorder = dark ? "rgba(255,107,0,0.14)"         : "rgba(255,107,0,0.28)";
  const footerBorder= dark ? "rgba(255,255,255,0.05)"       : "rgba(0,0,0,0.08)";
  const footerText  = dark ? "rgba(255,255,255,0.26)"       : "rgba(0,0,0,0.32)";
  const termBorder  = dark ? "rgba(255,107,0,0.22)"         : "rgba(255,107,0,0.38)";
  const termHeader  = dark ? "rgba(255,107,0,0.03)"         : "rgba(255,107,0,0.05)";
  const sectionTag  = "#FF6B00"; /* brand accent — always orange */

  return (
    <div
      style={{
        fontFamily: "'Inter', sans-serif",
        background: bg,
        color: text,
        overflowX: "hidden",
        transition: "background 0.35s ease, color 0.35s ease",
        minHeight: "100vh",
      }}
    >
      <ThemeToggle dark={dark} onToggle={toggleTheme} />

      {/* ── NAV LOGO ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={!preloaderVisible ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5, delay: 0.15 }}
        style={{
          position: "fixed",
          top: "1rem",
          left: "1.5rem",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          gap: "0.55rem",
          pointerEvents: "none",
        }}
      >
        <img
          src={logoSrc}
          alt="J14-75"
          style={{
            width: 32,
            height: 32,
            objectFit: "contain",
            filter: dark ? "drop-shadow(0 0 6px rgba(255,107,0,0.55))" : "none",
            transition: "filter 0.35s ease",
          }}
        />
        <span
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: "0.75rem",
            fontWeight: 600,
            letterSpacing: "0.14em",
            color: dark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.45)",
            textTransform: "uppercase",
            transition: "color 0.35s ease",
          }}
        >
          J14-75
        </span>
      </motion.div>

      {/* ── PRELOADER ── */}
      <AnimatePresence>
        {preloaderVisible && (
          <motion.div
            initial={{ opacity: 1 }}
            animate={preloaderExiting ? { opacity: 0 } : { opacity: 1 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 99999,
              background: "#000",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "2rem",
            }}
          >
            <div style={{ position: "relative", width: 120, height: 120 }}>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1.6, ease: "linear" }}
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  border: "2px solid transparent",
                  borderTopColor: "#FF6B00",
                  borderRightColor: "#FFB300",
                  boxShadow: "0 0 26px rgba(255,107,0,0.5)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 9,
                  borderRadius: "50%",
                  border: "1px solid rgba(255,107,0,0.13)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "1.1rem",
                    fontWeight: 500,
                    color: "#FF6B00",
                    letterSpacing: "0.05em",
                  }}
                >
                  {count}%
                </span>
              </div>
            </div>
            <span
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: "0.72rem",
                letterSpacing: "0.32em",
                color: "rgba(255,255,255,0.28)",
                textTransform: "uppercase",
              }}
            >
              Initializing J14-75
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════
          HERO — cover video, original behaviour
      ══════════════════════════════════════════ */}
      <section
        style={{
          position: "relative",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          background: bg,
          transition: "background 0.35s ease",
        }}
      >
        <video
          autoPlay
          loop
          muted
          playsInline
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            objectPosition: "center center",
            zIndex: 0,
          }}
          src="/hero-planet.mp4"
        />

        {/* Overlay — adapts to theme */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: dark
              ? "linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.25) 45%, rgba(0,0,0,0.88) 100%)"
              : "linear-gradient(to bottom, rgba(244,239,232,0.45) 0%, rgba(244,239,232,0.22) 45%, rgba(244,239,232,0.88) 100%)",
            zIndex: 1,
            transition: "background 0.35s ease",
          }}
        />

        {/* Text always stays white — it sits over video regardless of mode */}
        <motion.div
          initial="hidden"
          animate={!preloaderVisible ? "visible" : "hidden"}
          variants={stagger}
          style={{
            position: "relative",
            zIndex: 2,
            textAlign: "center",
            padding: "0 1.5rem",
            maxWidth: 740,
          }}
        >
          <motion.div variants={fadeUp} style={{ marginBottom: "0.8rem" }}>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.66rem",
                letterSpacing: "0.34em",
                color: "rgba(255,255,255,0.78)",
                textTransform: "uppercase",
              }}
            >
              ARC-TESTNET · AGENT ID 75 · KYC VERIFIED
            </span>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: "clamp(5rem, 16vw, 10rem)",
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              color: "#FFFFFF",
              margin: "0 0 1.25rem 0",
            }}
          >
            Meet J14-75.
          </motion.h1>

          <motion.p
            variants={fadeUp}
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: "clamp(0.95rem, 1.8vw, 1.1rem)",
              fontWeight: 300,
              lineHeight: 1.8,
              color: "rgba(255,255,255,0.68)",
              marginBottom: "3rem",
              maxWidth: 580,
              margin: "0 auto 3rem auto",
            }}
          >
            A fully autonomous AI assistant built on Circle's secure infrastructure.
            Its name draws from J1407b — the "Super-Saturn" of deep space, celebrated
            for its breathtaking ring system of extraordinary scale and complexity.
            Just like its namesake, J14-75 is built to handle the complex effortlessly —
            structured, intelligent, and always in motion.
          </motion.p>

          <motion.div variants={fadeUp}>
            <button
              disabled
              style={{
                cursor: "not-allowed",
                padding: "1rem 2.5rem",
                border: "1px solid rgba(255,179,0,0.45)",
                borderRadius: "2px",
                background: "rgba(255,107,0,0.06)",
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
                color: "#FFB300",
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: "0.68rem",
                fontWeight: 600,
                letterSpacing: "0.26em",
                textTransform: "uppercase",
                boxShadow: "0 0 24px rgba(255,179,0,0.1), inset 0 0 20px rgba(255,107,0,0.04)",
              }}
            >
              Command Center — Coming Soon
            </button>
          </motion.div>
        </motion.div>

        {/* Scroll line */}
        <div
          style={{
            position: "absolute",
            bottom: "2.5rem",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2,
          }}
        >
          <motion.div
            animate={{ y: [0, 10, 0] }}
            transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut" }}
            style={{
              width: 1,
              height: 50,
              background: "linear-gradient(to bottom, rgba(255,107,0,0.7), transparent)",
            }}
          />
        </div>
      </section>

      {/* ══════════════════════════════════════════
          ACT 2 — Trust & Infrastructure (text only, no video)
      ══════════════════════════════════════════ */}
      <section
        style={{
          padding: "clamp(5rem, 10vw, 9rem) clamp(1.5rem, 5vw, 5rem)",
          maxWidth: 860,
          margin: "0 auto",
        }}
      >
        <motion.div
          ref={act2Reveal.ref}
          initial="hidden"
          animate={act2Reveal.isInView ? "visible" : "hidden"}
          variants={stagger}
        >
          <motion.div variants={fadeUp} style={{ marginBottom: "0.9rem" }}>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.62rem",
                letterSpacing: "0.3em",
                color: sectionTag,
                textTransform: "uppercase",
              }}
            >
              01 — Trust & Infrastructure
            </span>
          </motion.div>

          <motion.h2
            variants={fadeUp}
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: "clamp(2rem, 4vw, 3.2rem)",
              fontWeight: 700,
              lineHeight: 1.12,
              letterSpacing: "-0.02em",
              color: text,
              marginBottom: "1.4rem",
              transition: "color 0.35s ease",
            }}
          >
            Built on Circle.{" "}
            <span
              style={{
                background: "linear-gradient(90deg, #FF6B00, #FFB300)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Verified on Chain.
            </span>
          </motion.h2>

          <motion.p
            variants={fadeUp}
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: "1rem",
              fontWeight: 300,
              lineHeight: 1.85,
              color: textMuted,
              marginBottom: "2.5rem",
              maxWidth: 620,
              transition: "color 0.35s ease",
            }}
          >
            J14-75 leverages Circle's Developer-Controlled Wallets for seamless,
            programmable USDC transactions on the Arc Testnet. Every action is
            cryptographically signed by smart contract accounts — no custodian,
            no intermediary, no compromise.
          </motion.p>

          <motion.div
            variants={stagger}
            style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}
          >
            {[
              { value: "100/100", label: "On-Chain Score", accent: "#FFB300" },
              { value: "KYC",     label: "Verified",       accent: "#FF6B00" },
            ].map((stat) => (
              <motion.div
                key={stat.label}
                variants={fadeUp}
                style={{
                  padding: "1.2rem 1.75rem",
                  border: `1px solid ${stat.accent}40`,
                  borderRadius: "4px",
                  background: cardBg,
                  backdropFilter: "blur(16px)",
                  WebkitBackdropFilter: "blur(16px)",
                  transition: "background 0.35s ease, border-color 0.35s ease",
                }}
              >
                <div
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: "1.6rem",
                    fontWeight: 700,
                    color: stat.accent,
                    marginBottom: "0.2rem",
                  }}
                >
                  {stat.value}
                </div>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "0.57rem",
                    letterSpacing: "0.2em",
                    color: labelColor,
                    textTransform: "uppercase",
                    transition: "color 0.35s ease",
                  }}
                >
                  {stat.label}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* Divider */}
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 clamp(1.5rem, 5vw, 5rem)" }}>
        <div style={{ height: 1, background: `linear-gradient(to right, transparent, ${divider}, transparent)` }} />
      </div>

      {/* ══════════════════════════════════════════
          ACT 3 — Earth video LEFT · Feature cards RIGHT
      ══════════════════════════════════════════ */}
      <section
        style={{
          padding: "clamp(5rem, 10vw, 9rem) clamp(1.5rem, 5vw, 5rem)",
          maxWidth: 1400,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "11fr 9fr",
          gap: "clamp(2.5rem, 5vw, 6rem)",
          alignItems: "start",
        }}
        className="act-grid"
      >
        {/* LEFT: Earth video — plain wide rectangle, no circular frame */}
        <motion.div
          ref={act3Left.ref}
          initial="hidden"
          animate={act3Left.isInView ? "visible" : "hidden"}
          variants={fadeScale}
        >
          <div
            style={{
              position: "relative",
              borderRadius: "6px",
              overflow: "hidden",
              aspectRatio: "16/10",
              border: `1px solid ${videoBorder}`,
              boxShadow: dark
                ? "0 0 60px rgba(255,107,0,0.06)"
                : "0 8px 40px rgba(0,0,0,0.12)",
              transition: "border-color 0.35s ease, box-shadow 0.35s ease",
            }}
          >
            <video
              autoPlay
              loop
              muted
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              src="/earth.mp4"
            />
            {/* subtle bottom fade — always dark so label is readable */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(to bottom, transparent 55%, rgba(0,0,0,0.5) 100%)",
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: "1.25rem",
                left: "1.5rem",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.6rem",
                letterSpacing: "0.22em",
                color: "rgba(255,140,0,0.55)",
                textTransform: "uppercase",
              }}
            >
              Earth · Live Feed
            </div>
          </div>
        </motion.div>

        {/* RIGHT: Feature cards */}
        <motion.div
          ref={act3Right.ref}
          initial="hidden"
          animate={act3Right.isInView ? "visible" : "hidden"}
          variants={stagger}
          style={{ paddingTop: "0.5rem" }}
        >
          <motion.div variants={fadeUp} style={{ marginBottom: "0.9rem" }}>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.62rem",
                letterSpacing: "0.3em",
                color: sectionTag,
                textTransform: "uppercase",
              }}
            >
              02 — Core Capabilities
            </span>
          </motion.div>

          <motion.h2
            variants={fadeUp}
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: "clamp(1.8rem, 3.5vw, 2.8rem)",
              fontWeight: 700,
              lineHeight: 1.12,
              letterSpacing: "-0.02em",
              color: text,
              marginBottom: "2rem",
              transition: "color 0.35s ease",
            }}
          >
            Built to work{" "}
            <span
              style={{
                background: "linear-gradient(90deg, #FF6B00, #FFB300)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              while you rest.
            </span>
          </motion.h2>

          <motion.div
            variants={stagger}
            style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}
          >
            {FEATURE_CARDS.map((card) => (
              <motion.div
                key={card.id}
                variants={fadeUp}
                style={{
                  padding: "1.4rem 1.6rem",
                  border: `1px solid ${cardBorder}`,
                  borderRadius: "4px",
                  background: cardBg,
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  display: "flex",
                  gap: "1.2rem",
                  alignItems: "flex-start",
                  transition: "background 0.35s ease, border-color 0.35s ease",
                }}
              >
                <span style={{ fontSize: "1.25rem", color: sectionTag, flexShrink: 0, lineHeight: 1.4 }}>
                  {card.icon}
                </span>
                <div>
                  <div
                    style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: "0.93rem",
                      fontWeight: 600,
                      color: text,
                      marginBottom: "0.35rem",
                      transition: "color 0.35s ease",
                    }}
                  >
                    {card.title}
                  </div>
                  <div
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: "0.855rem",
                      fontWeight: 300,
                      lineHeight: 1.72,
                      color: textMuted,
                      transition: "color 0.35s ease",
                    }}
                  >
                    {card.description}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* ══════════════════════════════════════════
          ACT 4 — TERMINAL (always dark internally)
      ══════════════════════════════════════════ */}
      <section
        ref={terminalSectionRef}
        style={{
          padding: "clamp(4rem, 8vw, 7rem) clamp(1.5rem, 5vw, 5rem)",
          maxWidth: 1000,
          margin: "0 auto",
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={terminalIsInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
        >
          <div style={{ textAlign: "center", marginBottom: "2.75rem" }}>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.62rem",
                letterSpacing: "0.3em",
                color: sectionTag,
                textTransform: "uppercase",
              }}
            >
              03 — Transparency Log
            </span>
            <h2
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: "clamp(1.7rem, 3.5vw, 2.4rem)",
                fontWeight: 700,
                color: text,
                marginTop: "0.7rem",
                letterSpacing: "-0.02em",
                transition: "color 0.35s ease",
              }}
            >
              On-Chain. Always.
            </h2>
          </div>

          <div
            style={{
              background: "#080400",
              border: `1px solid ${termBorder}`,
              borderRadius: "6px",
              overflow: "hidden",
              boxShadow: "0 0 60px rgba(255,107,0,0.05)",
              transition: "border-color 0.35s ease",
            }}
          >
            {/* Title bar */}
            <div
              style={{
                padding: "0.8rem 1.2rem",
                borderBottom: "1px solid rgba(255,107,0,0.1)",
                display: "flex",
                alignItems: "center",
                gap: "0.45rem",
                background: termHeader,
                transition: "background 0.35s ease",
              }}
            >
              {["rgba(255,107,0,0.5)", "rgba(255,179,0,0.35)", "rgba(255,255,255,0.1)"].map((c, i) => (
                <div key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />
              ))}
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.58rem",
                  color: "rgba(255,140,0,0.38)",
                  letterSpacing: "0.1em",
                  marginLeft: "0.4rem",
                }}
              >
                j14-75 :: arc-testnet :: live
              </span>
            </div>

            {/* Log output */}
            <div
              ref={terminalBodyRef}
              style={{
                padding: "1.2rem 1.5rem",
                maxHeight: 340,
                overflowY: "auto",
                scrollbarWidth: "thin",
                scrollbarColor: "rgba(255,107,0,0.18) transparent",
              }}
            >
              {visibleLines.map((line, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -5 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.22 }}
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "0.75rem",
                    lineHeight: 1.95,
                    color: "#FF8C00",
                    letterSpacing: "0.02em",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {line}
                </motion.div>
              ))}
              {terminalIsInView && (
                <motion.span
                  animate={{ opacity: [1, 0, 1] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                  style={{
                    display: "inline-block",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "0.75rem",
                    color: "#FF8C00",
                    marginLeft: 2,
                  }}
                >
                  _
                </motion.span>
              )}
            </div>
          </div>
        </motion.div>
      </section>

      {/* ── FOOTER ── */}
      <footer
        style={{
          padding: "3rem clamp(1.5rem, 5vw, 5rem)",
          borderTop: `1px solid ${footerBorder}`,
          transition: "border-color 0.35s ease",
        }}
      >
        <motion.div
          ref={footerReveal.ref}
          initial="hidden"
          animate={footerReveal.isInView ? "visible" : "hidden"}
          variants={fadeUp}
          style={{ textAlign: "center" }}
        >
          <div
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: "0.85rem",
              fontWeight: 300,
              color: footerText,
              marginBottom: "0.7rem",
              transition: "color 0.35s ease",
            }}
          >
            Created with ❤️ by Tarun
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.56rem",
              letterSpacing: "0.26em",
              color: "rgba(255,107,0,0.28)",
              textTransform: "uppercase",
            }}
          >
            J14-75 · Agent ID 75 · Arc Testnet · ERC-8004
          </div>
        </motion.div>
      </footer>

      {/* Responsive: stack on mobile */}
      <style>{`
        @media (max-width: 768px) {
          .act-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
