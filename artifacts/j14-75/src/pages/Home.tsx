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
    id: "escrow",
    title: "Programmable Escrow",
    description:
      "Trustless, condition-based USDC locking and release via smart contracts. No intermediaries.",
    icon: "◈",
  },
  {
    id: "yield",
    title: "Yield Optimization",
    description:
      "Autonomous capital allocation across verified on-chain protocols with deterministic risk parameters.",
    icon: "◎",
  },
  {
    id: "execution",
    title: "Deterministic Execution",
    description:
      "Every action is cryptographically signed, on-chain verified, and immutably logged. Zero ambiguity.",
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
    transition: { duration: 0.8, ease: [0.25, 0.1, 0.25, 1] },
  },
};

const fadeScale = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.9, ease: [0.25, 0.1, 0.25, 1] },
  },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.15 } },
};

function ThemeToggle({
  dark,
  onToggle,
}: {
  dark: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.button
      onClick={onToggle}
      whileTap={{ scale: 0.92 }}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        position: "fixed",
        top: "1.25rem",
        right: "1.25rem",
        zIndex: 1000,
        width: 48,
        height: 26,
        borderRadius: 999,
        background: dark
          ? "rgba(255,107,0,0.15)"
          : "rgba(0,0,0,0.08)",
        border: dark
          ? "1px solid rgba(255,107,0,0.35)"
          : "1px solid rgba(0,0,0,0.15)",
        backdropFilter: "blur(12px)",
        cursor: "pointer",
        padding: 3,
        display: "flex",
        alignItems: "center",
        justifyContent: dark ? "flex-start" : "flex-end",
      }}
    >
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 500, damping: 35 }}
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: dark
            ? "linear-gradient(135deg, #FF6B00, #FFB300)"
            : "linear-gradient(135deg, #1a1a2e, #4a4a6a)",
          boxShadow: dark
            ? "0 0 8px rgba(255,107,0,0.6)"
            : "0 0 6px rgba(0,0,0,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 9,
        }}
      >
        {dark ? "☀" : "☽"}
      </motion.div>
    </motion.button>
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
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalIsInView = useInView(terminalRef, { once: true, amount: 0.2 });

  const heroReveal = useScrollReveal(0.3);
  const act2Left = useScrollReveal(0.2);
  const act2Right = useScrollReveal(0.2);
  const act3Left = useScrollReveal(0.2);
  const act3Right = useScrollReveal(0.2);
  const footerReveal = useScrollReveal(0.5);

  useEffect(() => {
    const stored = localStorage.getItem("j1475-theme");
    if (stored === "light") setDark(false);
  }, []);

  const toggleTheme = () => {
    setDark((prev) => {
      const next = !prev;
      localStorage.setItem("j1475-theme", next ? "dark" : "light");
      return next;
    });
  };

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
    if (terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [visibleLines]);

  const bg = dark ? "#000000" : "#f5f0ea";
  const text = dark ? "#F8F9FA" : "#1a1612";
  const textMuted = dark ? "rgba(209,213,219,0.75)" : "rgba(60,50,40,0.7)";
  const cardBg = dark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.65)";
  const cardBorder = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.09)";
  const dividerColor = dark ? "rgba(255,107,0,0.15)" : "rgba(255,107,0,0.25)";
  const termBg = dark ? "#000" : "#0e0b08";
  const termBorder = dark ? "rgba(255,107,0,0.2)" : "rgba(255,107,0,0.35)";

  return (
    <div
      style={{
        fontFamily: "'Inter', sans-serif",
        background: bg,
        color: text,
        overflowX: "hidden",
        transition: "background 0.4s ease, color 0.4s ease",
        minHeight: "100vh",
      }}
    >
      <ThemeToggle dark={dark} onToggle={toggleTheme} />

      {/* NAV LOGO */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={!preloaderVisible ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6, delay: 0.2 }}
        style={{
          position: "fixed",
          top: "1rem",
          left: "1.5rem",
          zIndex: 999,
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
        }}
      >
        <img
          src={logoSrc}
          alt="J14-75 logo"
          style={{
            width: 34,
            height: 34,
            objectFit: "contain",
            filter: dark ? "drop-shadow(0 0 6px rgba(255,107,0,0.5))" : "none",
          }}
        />
        <span
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: "0.8rem",
            fontWeight: 600,
            letterSpacing: "0.12em",
            color: dark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)",
            textTransform: "uppercase",
          }}
        >
          J14-75
        </span>
      </motion.div>

      {/* PRELOADER */}
      <AnimatePresence>
        {preloaderVisible && (
          <motion.div
            initial={{ opacity: 1 }}
            animate={preloaderExiting ? { opacity: 0 } : { opacity: 1 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
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
                  boxShadow: "0 0 24px rgba(255, 107, 0, 0.5)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 8,
                  borderRadius: "50%",
                  border: "1px solid rgba(255, 107, 0, 0.15)",
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
                fontSize: "0.75rem",
                letterSpacing: "0.3em",
                color: "rgba(255,255,255,0.3)",
                textTransform: "uppercase",
              }}
            >
              Initializing J14-75
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HERO */}
      <section
        style={{
          position: "relative",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
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
            objectFit: "cover",
            zIndex: 0,
          }}
          src="/hero-planet.mp4"
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: dark
              ? "linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.85) 100%)"
              : "linear-gradient(to bottom, rgba(245,240,234,0.55) 0%, rgba(245,240,234,0.25) 50%, rgba(245,240,234,0.9) 100%)",
            zIndex: 1,
            transition: "background 0.4s ease",
          }}
        />
        <motion.div
          ref={heroReveal.ref}
          initial="hidden"
          animate={!preloaderVisible ? "visible" : "hidden"}
          variants={stagger}
          style={{
            position: "relative",
            zIndex: 2,
            textAlign: "center",
            padding: "0 1.5rem",
            maxWidth: 720,
          }}
        >
          <motion.div variants={fadeUp} style={{ marginBottom: "0.75rem" }}>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.68rem",
                letterSpacing: "0.32em",
                color: "#FF6B00",
                textTransform: "uppercase",
                opacity: 0.9,
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
              background: dark
                ? "linear-gradient(135deg, #F8F9FA 30%, #D1D5DB 100%)"
                : "linear-gradient(135deg, #1a1612 30%, #4a3828 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              marginBottom: "1.25rem",
            }}
          >
            J14-75
          </motion.h1>

          <motion.p
            variants={fadeUp}
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: "clamp(0.9rem, 2vw, 1.1rem)",
              fontWeight: 300,
              letterSpacing: "0.06em",
              color: dark ? "rgba(248,249,250,0.7)" : "rgba(26,22,18,0.65)",
              textTransform: "uppercase",
              marginBottom: "3rem",
            }}
          >
            Autonomous On-Chain Intelligence. Secured by Circle.
          </motion.p>

          <motion.div variants={fadeUp}>
            <button
              disabled
              style={{
                cursor: "not-allowed",
                padding: "1rem 2.5rem",
                border: "1px solid rgba(255, 179, 0, 0.45)",
                borderRadius: "2px",
                background: "rgba(255, 107, 0, 0.06)",
                backdropFilter: "blur(14px)",
                color: "#FFB300",
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: "0.7rem",
                fontWeight: 600,
                letterSpacing: "0.25em",
                textTransform: "uppercase",
                boxShadow:
                  "0 0 22px rgba(255, 179, 0, 0.12), inset 0 0 20px rgba(255, 107, 0, 0.04)",
              }}
            >
              Command Center — Coming Soon
            </button>
          </motion.div>
        </motion.div>

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
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
            style={{
              width: 1,
              height: 48,
              background: "linear-gradient(to bottom, rgba(255,107,0,0.8), transparent)",
            }}
          />
        </div>
      </section>

      {/* ACT 2: TRUST & INFRASTRUCTURE */}
      <section
        style={{
          padding: "clamp(5rem, 10vw, 10rem) clamp(1.5rem, 6vw, 6rem)",
          maxWidth: 1400,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 460px), 1fr))",
          gap: "clamp(3rem, 6vw, 7rem)",
          alignItems: "center",
        }}
      >
        <motion.div
          ref={act2Left.ref}
          initial="hidden"
          animate={act2Left.isInView ? "visible" : "hidden"}
          variants={stagger}
        >
          <motion.div variants={fadeUp} style={{ marginBottom: "1rem" }}>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.63rem",
                letterSpacing: "0.3em",
                color: "#FF6B00",
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
              fontSize: "clamp(1.9rem, 4vw, 3rem)",
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              color: text,
              marginBottom: "1.5rem",
            }}
          >
            Built on Circle.
            <br />
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
              lineHeight: 1.8,
              color: textMuted,
              marginBottom: "2.5rem",
              maxWidth: 480,
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
            <motion.div
              variants={fadeUp}
              style={{
                padding: "1.25rem 1.75rem",
                border: `1px solid rgba(255, 179, 0, ${dark ? "0.22" : "0.35"})`,
                borderRadius: "4px",
                background: dark
                  ? "rgba(255, 107, 0, 0.04)"
                  : "rgba(255,255,255,0.7)",
                backdropFilter: "blur(16px)",
                boxShadow: "0 0 30px rgba(255, 179, 0, 0.06)",
              }}
            >
              <div
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: "1.6rem",
                  fontWeight: 700,
                  color: "#FFB300",
                  marginBottom: "0.25rem",
                }}
              >
                100/100
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.58rem",
                  letterSpacing: "0.2em",
                  color: dark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)",
                  textTransform: "uppercase",
                }}
              >
                On-Chain Score
              </div>
            </motion.div>

            <motion.div
              variants={fadeUp}
              style={{
                padding: "1.25rem 1.75rem",
                border: `1px solid rgba(255, 107, 0, ${dark ? "0.22" : "0.35"})`,
                borderRadius: "4px",
                background: dark
                  ? "rgba(255, 107, 0, 0.04)"
                  : "rgba(255,255,255,0.7)",
                backdropFilter: "blur(16px)",
                boxShadow: "0 0 30px rgba(255, 107, 0, 0.06)",
              }}
            >
              <div
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: "1.6rem",
                  fontWeight: 700,
                  color: "#FF6B00",
                  marginBottom: "0.25rem",
                }}
              >
                KYC
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.58rem",
                  letterSpacing: "0.2em",
                  color: dark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)",
                  textTransform: "uppercase",
                }}
              >
                Verified
              </div>
            </motion.div>
          </motion.div>
        </motion.div>

        <motion.div
          ref={act2Right.ref}
          initial="hidden"
          animate={act2Right.isInView ? "visible" : "hidden"}
          variants={fadeScale}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "min(380px, 100%)",
              aspectRatio: "1",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: -16,
                borderRadius: "50%",
                border: "1px solid rgba(255,179,0,0.18)",
                boxShadow:
                  "0 0 60px rgba(255,179,0,0.07), inset 0 0 60px rgba(255,107,0,0.03)",
              }}
            />
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 20, ease: "linear" }}
              style={{
                position: "absolute",
                inset: -24,
                borderRadius: "50%",
                border: "1px dashed rgba(255,107,0,0.12)",
              }}
            />
            <div
              style={{
                borderRadius: "50%",
                overflow: "hidden",
                width: "100%",
                height: "100%",
                border: "1px solid rgba(255,179,0,0.2)",
                background: "rgba(255,107,0,0.03)",
                backdropFilter: "blur(8px)",
                boxShadow: "0 0 80px rgba(255,107,0,0.1)",
              }}
            >
              <video
                autoPlay
                loop
                muted
                playsInline
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
                src="/earth.mp4"
              />
            </div>
          </div>
        </motion.div>
      </section>

      {/* DIVIDER */}
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding: "0 clamp(1.5rem, 6vw, 6rem)",
        }}
      >
        <div
          style={{
            height: 1,
            background: `linear-gradient(to right, transparent, ${dividerColor}, transparent)`,
          }}
        />
      </div>

      {/* ACT 3: DETERMINISTIC LOGIC */}
      <section
        style={{
          padding: "clamp(5rem, 10vw, 10rem) clamp(1.5rem, 6vw, 6rem)",
          maxWidth: 1400,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 460px), 1fr))",
          gap: "clamp(3rem, 6vw, 7rem)",
          alignItems: "center",
        }}
      >
        <motion.div
          ref={act3Left.ref}
          initial="hidden"
          animate={act3Left.isInView ? "visible" : "hidden"}
          variants={fadeScale}
        >
          <div
            style={{
              position: "relative",
              borderRadius: "4px",
              overflow: "hidden",
              aspectRatio: "4/3",
              border: `1px solid rgba(255,107,0,${dark ? "0.12" : "0.2"})`,
            }}
          >
            <video
              autoPlay
              loop
              muted
              playsInline
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: "blur(8px) brightness(0.4)",
                transform: "scale(1.08)",
              }}
              src="/galaxy-core.mp4"
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "radial-gradient(ellipse at center, rgba(255,107,0,0.05) 0%, rgba(0,0,0,0.55) 70%)",
              }}
            />
          </div>
        </motion.div>

        <motion.div
          ref={act3Right.ref}
          initial="hidden"
          animate={act3Right.isInView ? "visible" : "hidden"}
          variants={stagger}
        >
          <motion.div variants={fadeUp} style={{ marginBottom: "1rem" }}>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.63rem",
                letterSpacing: "0.3em",
                color: "#FF6B00",
                textTransform: "uppercase",
              }}
            >
              02 — Deterministic Logic
            </span>
          </motion.div>

          <motion.h2
            variants={fadeUp}
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: "clamp(1.9rem, 4vw, 3rem)",
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              color: text,
              marginBottom: "2.5rem",
            }}
          >
            Code is the
            <br />
            <span
              style={{
                background: "linear-gradient(90deg, #FF6B00, #FFB300)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              only authority.
            </span>
          </motion.h2>

          <motion.div
            variants={stagger}
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            {FEATURE_CARDS.map((card) => (
              <motion.div
                key={card.id}
                variants={fadeUp}
                style={{
                  padding: "1.5rem 1.75rem",
                  border: `1px solid ${cardBorder}`,
                  borderRadius: "4px",
                  background: cardBg,
                  backdropFilter: "blur(12px)",
                  display: "flex",
                  gap: "1.25rem",
                  alignItems: "flex-start",
                  transition: "background 0.4s ease, border-color 0.4s ease",
                }}
              >
                <span
                  style={{
                    fontSize: "1.3rem",
                    color: "#FF6B00",
                    flexShrink: 0,
                    lineHeight: 1.35,
                  }}
                >
                  {card.icon}
                </span>
                <div>
                  <div
                    style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: "0.95rem",
                      fontWeight: 600,
                      color: text,
                      marginBottom: "0.4rem",
                    }}
                  >
                    {card.title}
                  </div>
                  <div
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: "0.875rem",
                      fontWeight: 300,
                      lineHeight: 1.7,
                      color: textMuted,
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

      {/* ACT 4: TERMINAL */}
      <section
        ref={terminalRef}
        style={{
          padding: "clamp(4rem, 8vw, 8rem) clamp(1.5rem, 6vw, 6rem)",
          maxWidth: 1000,
          margin: "0 auto",
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={terminalIsInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
        >
          <div style={{ textAlign: "center", marginBottom: "3rem" }}>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.63rem",
                letterSpacing: "0.3em",
                color: "#FF6B00",
                textTransform: "uppercase",
              }}
            >
              03 — Transparency Log
            </span>
            <h2
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: "clamp(1.75rem, 3.5vw, 2.5rem)",
                fontWeight: 700,
                color: text,
                marginTop: "0.75rem",
                letterSpacing: "-0.02em",
              }}
            >
              On-Chain. Always.
            </h2>
          </div>

          <div
            style={{
              background: termBg,
              border: `1px solid ${termBorder}`,
              borderRadius: "6px",
              overflow: "hidden",
              boxShadow: "0 0 60px rgba(255,107,0,0.06)",
            }}
          >
            <div
              style={{
                padding: "0.85rem 1.25rem",
                borderBottom: `1px solid rgba(255,107,0,0.1)`,
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                background: "rgba(255,107,0,0.03)",
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "rgba(255,107,0,0.5)",
                }}
              />
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "rgba(255,179,0,0.35)",
                }}
              />
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.1)",
                }}
              />
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.6rem",
                  color: "rgba(255,140,0,0.4)",
                  letterSpacing: "0.1em",
                  marginLeft: "0.5rem",
                }}
              >
                j14-75 :: arc-testnet :: live
              </span>
            </div>

            <div
              ref={terminalBodyRef}
              style={{
                padding: "1.25rem 1.5rem",
                maxHeight: 340,
                overflowY: "auto",
                scrollbarWidth: "thin",
                scrollbarColor: "rgba(255,107,0,0.2) transparent",
              }}
            >
              {visibleLines.map((line, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25 }}
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "0.76rem",
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
                    fontSize: "0.76rem",
                    color: "#FF8C00",
                    marginLeft: "2px",
                  }}
                >
                  _
                </motion.span>
              )}
            </div>
          </div>
        </motion.div>
      </section>

      {/* FOOTER */}
      <footer
        style={{
          padding: "3rem clamp(1.5rem, 6vw, 6rem)",
          borderTop: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)"}`,
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
              color: dark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.35)",
              marginBottom: "0.75rem",
            }}
          >
            Created with ❤️ by Tarun
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.58rem",
              letterSpacing: "0.25em",
              color: "rgba(255,107,0,0.3)",
              textTransform: "uppercase",
            }}
          >
            J14-75 · Agent ID 75 · Arc Testnet · ERC-8004
          </div>
        </motion.div>
      </footer>
    </div>
  );
}
