import { useState, useRef, useEffect, useCallback } from "react";
import axios from "axios";
import "./App.css";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

const BOT_NAME = "Aria";

const getTime = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const INITIAL_MESSAGE = {
  id: 1,
  sender: "bot",
  text: "Hello! I'm Aria, powered by Groq + Spring Boot. How can I help you today?",
  time: getTime(),
};

const suggestions = [
  "What can you help me with?",
  "Explain quantum computing simply",
  "Write a Python hello world",
  "How does Spring Boot work?",
];

// ─── Message Formatter ───────────────────────────────────────────
const renderInline = (text) =>
  text.split("\n").map((line, lineIdx, arr) => {
    const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    const rendered = parts.map((part, i) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
        return <code key={i} className="inline-code">{part.slice(1, -1)}</code>;
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      return <span key={i}>{part}</span>;
    });
    return (
      <span key={lineIdx}>
        {rendered}
        {lineIdx < arr.length - 1 && <br />}
      </span>
    );
  });

const formatMessage = (text) => {
  const elements = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const segment = text.slice(lastIndex, match.index);
      elements.push(
        <div key={`text-${lastIndex}`} className="text-segment">
          {renderInline(segment)}
        </div>
      );
    }
    const lang = match[1] || "code";
    const code = match[2].trimEnd();
    elements.push(
      <div key={`code-${match.index}`} className="code-block-wrapper">
        <div className="code-block-header">
          <span className="code-lang">{lang}</span>
          <button
            className="copy-btn"
            onClick={() => navigator.clipboard.writeText(code)}
          >
            <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
              <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            Copy
          </button>
        </div>
        <pre className="code-block"><code>{code}</code></pre>
      </div>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    elements.push(
      <div key={`text-${lastIndex}`} className="text-segment">
        {renderInline(text.slice(lastIndex))}
      </div>
    );
  }

  return elements.length > 0 ? elements : <div className="text-segment">{renderInline(text)}</div>;
};

// ─── TypingIndicator ─────────────────────────────────────────────
const TypingIndicator = () => (
  <div className="message-row bot-row">
    <div className="avatar bot-avatar">
      <svg viewBox="0 0 24 24" fill="none" className="avatar-icon">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
    <div className="message bot-message typing-bubble">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </div>
  </div>
);

// ─── Message Bubble ──────────────────────────────────────────────
const Message = ({ msg, isNew }) => (
  <div
    className={`message-row ${msg.sender === "user" ? "user-row" : "bot-row"} ${
      isNew ? "fade-in" : ""
    }`}
  >
    {msg.sender === "bot" && (
      <div className={`avatar bot-avatar ${msg.isError ? "bot-avatar-error" : ""}`}>
        {msg.isError ? (
          <svg viewBox="0 0 24 24" fill="none" className="avatar-icon">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" className="avatar-icon">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </div>
    )}
    <div
      className={`message ${msg.sender === "user" ? "user-message" : "bot-message"} ${
        msg.isError ? "error-message" : ""
      }`}
    >
      <div className="message-content">
        {msg.sender === "bot" ? formatMessage(msg.text) : msg.text}
      </div>
      <span className="timestamp">{msg.time}</span>
    </div>
    {msg.sender === "user" && (
      <div className="avatar user-avatar">
        <span>U</span>
      </div>
    )}
  </div>
);

// ─── App ─────────────────────────────────────────────────────────
export default function App() {
  const [messages, setMessages]           = useState([INITIAL_MESSAGE]);
  const [input, setInput]                 = useState("");
  const [pendingQuery, setPendingQuery]   = useState(null);
  const [isLoading, setIsLoading]         = useState(false);
  const [newMsgId, setNewMsgId]           = useState(null);
  const [sidebarOpen, setSidebarOpen]     = useState(false); // default CLOSED on mobile
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const messagesEndRef  = useRef(null);
  const messagesAreaRef = useRef(null);
  const inputRef        = useRef(null);
  const sidebarRef      = useRef(null);

  // ── Touch swipe state ────────────────────────────────────────
  const touchStartX   = useRef(null);
  const touchStartY   = useRef(null);
  const isSwiping     = useRef(false);

  // Open sidebar when swiping right from left edge (≤ 40px)
  // Close sidebar when swiping left while open
  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
    isSwiping.current   = false;
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (touchStartX.current === null) return;

    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;

    // Ignore mostly-vertical scrolls
    if (!isSwiping.current && Math.abs(dy) > Math.abs(dx)) return;

    isSwiping.current = true;

    // Swipe RIGHT from left edge → open sidebar
    if (!sidebarOpen && touchStartX.current < 40 && dx > 0) {
      e.preventDefault(); // prevent page scroll while opening
    }

    // Swipe LEFT while sidebar open → give visual feedback (optional)
    if (sidebarOpen && dx < 0) {
      e.preventDefault();
    }
  }, [sidebarOpen]);

  const handleTouchEnd = useCallback((e) => {
    if (touchStartX.current === null) return;

    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartX.current;
    const dy = touch.clientY - touchStartY.current;

    // Only act on horizontal swipes (dx dominant)
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (!sidebarOpen && touchStartX.current < 40 && dx > 0) {
        // Swipe right from edge → open
        setSidebarOpen(true);
      } else if (sidebarOpen && dx < -60) {
        // Swipe left while open → close
        setSidebarOpen(false);
      }
    }

    touchStartX.current = null;
    touchStartY.current = null;
    isSwiping.current   = false;
  }, [sidebarOpen]);

  // Attach touch listeners to the whole document
  useEffect(() => {
    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove",  handleTouchMove,  { passive: false });
    document.addEventListener("touchend",   handleTouchEnd,   { passive: true });
    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove",  handleTouchMove);
      document.removeEventListener("touchend",   handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  // Default sidebar open on desktop, closed on mobile
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 641px)");
    setSidebarOpen(mql.matches);
    const onChange = (e) => setSidebarOpen(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // ── Scroll helpers ───────────────────────────────────────────
  const isNearBottom = () => {
    const el = messagesAreaRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg) return;
    if (lastMsg.sender === "user" || isNearBottom()) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setShowScrollBtn(false);
    } else {
      setShowScrollBtn(true);
    }
  }, [messages, isLoading]);

  useEffect(() => {
    const el = messagesAreaRef.current;
    if (!el) return;
    const handleScroll = () => setShowScrollBtn(!isNearBottom());
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ── API call ─────────────────────────────────────────────────
  useEffect(() => {
    if (!pendingQuery) return;
    setIsLoading(true);

    api
      .get("/chat", { params: { q: pendingQuery } })
      .then((res) => {
        const botMsg = { id: Date.now(), sender: "bot", text: res.data, time: getTime() };
        setMessages((prev) => [...prev, botMsg]);
        setNewMsgId(botMsg.id);
      })
      .catch((err) => {
        const errText =
          err.response?.data ||
          err.message ||
          "Could not reach the server. Is Spring Boot running on port 8080?";
        const errMsg = {
          id: Date.now(), sender: "bot",
          text: "⚠️ " + errText,
          time: getTime(), isError: true,
        };
        setMessages((prev) => [...prev, errMsg]);
        setNewMsgId(errMsg.id);
      })
      .finally(() => {
        setIsLoading(false);
        setPendingQuery(null);
        inputRef.current?.focus();
      });
  }, [pendingQuery]);

  // ── Send message ─────────────────────────────────────────────
  const sendMessage = (text) => {
    const userText = (text || input).trim();
    if (!userText || isLoading) return;
    const userMsg = { id: Date.now(), sender: "user", text: userText, time: getTime() };
    setMessages((prev) => [...prev, userMsg]);
    setNewMsgId(userMsg.id);
    setInput("");
    setPendingQuery(userText);
    // Close sidebar on mobile when sending
    if (window.matchMedia("(max-width: 640px)").matches) {
      setSidebarOpen(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([{ ...INITIAL_MESSAGE, id: Date.now(), time: getTime() }]);
    setPendingQuery(null);
    setIsLoading(false);
    setSidebarOpen(false); // close sidebar on mobile after clearing
    inputRef.current?.focus();
  };

  const isMobile = () => window.matchMedia("(max-width: 640px)").matches;

  return (
    <div className="app-shell">

      <div className="ambient-bg">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      {/* ── Backdrop overlay (mobile only) — tap to close sidebar ── */}
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside
        ref={sidebarRef}
        className={`sidebar ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}
      >
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-icon">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M2 17l10 5 10-5"            stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M2 12l10 5 10-5"            stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </div>
            {sidebarOpen && <span className="brand-name">Aria AI</span>}
          </div>
        </div>

        <button className="new-chat-btn" onClick={clearChat}>
          <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {sidebarOpen && <span>New Chat</span>}
        </button>

        {sidebarOpen && (
          <div className="history-section">
            <p className="history-label">Recent</p>
            {["Python debugging help", "React component design", "SQL query optimization"].map(
              (h, i) => (
                <button key={i} className="history-item">
                  <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
                      stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                  <span>{h}</span>
                </button>
              )
            )}
          </div>
        )}

        <div className="sidebar-footer">
          {sidebarOpen && (
            <div className="user-info">
              <div className="user-avatar-small">U</div>
              <div className="user-details">
                <span className="user-name">User</span>
                <span className="user-plan">Groq · Free</span>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main Chat ───────────────────────────────────────────── */}
      <main className="chat-main">
        <header className="chat-header">
          <button
            className="toggle-sidebar"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label="Toggle sidebar"
          >
            <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
              <path d="M3 12h18M3 6h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <div className="header-center">
            <div className="status-dot" />
            <span className="header-title">{BOT_NAME}</span>
            <span className="header-sub">Groq · Spring Boot</span>
          </div>
          <div className="header-actions">
            <button className="icon-btn" title="Clear chat" onClick={clearChat}>
              <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button className="icon-btn" title="Settings">
              <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        <div className="messages-area" ref={messagesAreaRef}>
          {messages.length === 1 && !isLoading && (
            <div className="welcome-screen">
              <div className="welcome-icon">
                <svg viewBox="0 0 24 24" fill="none" width="40" height="40">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <h2 className="welcome-title">How can I help you?</h2>
              <p className="welcome-sub">Ask me anything — powered by Groq.</p>
              <div className="suggestions-grid">
                {suggestions.map((s, i) => (
                  <button key={i} className="suggestion-card" onClick={() => sendMessage(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <Message key={msg.id} msg={msg} isNew={msg.id === newMsgId} />
          ))}

          {isLoading && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>

        {showScrollBtn && (
          <button
            className="scroll-to-bottom"
            onClick={() => {
              messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
              setShowScrollBtn(false);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
              <path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            New message
          </button>
        )}

        <div className="input-area">
          <div className="input-container">
            <textarea
              ref={inputRef}
              className="chat-input"
              placeholder="Message Aria..."
              value={input}
              rows={1}
              disabled={isLoading}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
            />
            <div className="input-actions">
              <button className="icon-btn attach-btn" title="Attach file">
                <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"
                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                className={`send-btn ${input.trim() && !isLoading ? "send-active" : ""}`}
                onClick={() => sendMessage()}
                disabled={!input.trim() || isLoading}
              >
                {isLoading ? (
                  <svg viewBox="0 0 24 24" fill="none" width="18" height="18" className="spin">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"
                      strokeDasharray="28" strokeDashoffset="10" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          <p className="input-hint">Enter to send · Shift+Enter for new line</p>
        </div>
      </main>
    </div>
  );
}