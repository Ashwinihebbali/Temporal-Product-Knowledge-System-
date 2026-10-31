import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';

const SUGGESTIONS = [
  'What changed in authentication and security?',
  'Summarize issue AXIS2-791.',
  'What major architectural decisions occurred in 2007?',
  'How does the Axis2 kernel handle message dispatching?',
  'Explain the history and evolution of Rampart security.',
  'What changes happened in the HTTP transport client?',
];

export function AssistantView({
  aiStatus,
  initialQuestion = '',
  onOpenEvidence,
  onOpenIssue,
  onToast,
}) {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      text: `Hello! I am ChronoDev AI, powered by your local Ollama engine (${aiStatus?.model || 'llama3.2:3b'}). I trace temporal product history for Apache Axis2. Every answer I provide is strictly grounded in dated Jira issues, Git commits, and historical records with verifiable citations.`,
      evidence: [],
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState(initialQuestion);
  const [busy, setBusy] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (initialQuestion) {
      setInput(initialQuestion);
    }
  }, [initialQuestion]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  async function handleSend(questionText) {
    const q = (questionText || input).trim();
    if (!q || busy) return;

    const userMsgId = `user-${Date.now()}`;
    const newMessages = [
      ...messages,
      { id: userMsgId, role: 'user', text: q, timestamp: new Date() },
    ];
    setMessages(newMessages);
    setInput('');
    setBusy(true);

    try {
      const res = await api.ask(q, 5);
      setMessages([
        ...newMessages,
        {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          text: res.answer,
          evidence: res.evidence || [],
          mode: res.mode,
          model: res.model || aiStatus?.model,
          timestamp: new Date(),
        },
      ]);
    } catch (err) {
      setMessages([
        ...newMessages,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          isError: true,
          text: `Error contacting assistant: ${err.message}`,
          evidence: [],
          timestamp: new Date(),
        },
      ]);
      onToast?.(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function handleCopyAnswer(text) {
    navigator.clipboard?.writeText(text);
    onToast?.('Answer copied to clipboard!', 'info');
  }

  // Parse text citations [issue:AXIS2-123], [commit:abc1234], [event:xyz] into clickable spans
  function renderFormattedAnswer(text) {
    if (!text) return null;

    // Split paragraphs
    const paragraphs = text.split('\n\n');

    return paragraphs.map((para, pIdx) => {
      // Split into lines
      const lines = para.split('\n');
      return (
        <div key={pIdx} className="answer-paragraph">
          {lines.map((line, lIdx) => {
            const isHeading = /^(Answer|Timeline|Evidence|Discussion):/i.test(line);
            // Match citations
            const parts = line.split(/(\[(?:issue|commit|event|source):[A-Za-z0-9_.-]+\])/g);

            return (
              <p key={lIdx} className={`answer-line ${isHeading ? 'answer-heading-line' : ''}`}>
                {parts.map((part, partIdx) => {
                  const match = part.match(/^\[(issue|commit|event|source):([A-Za-z0-9_.-]+)\]$/);
                  if (match) {
                    const [, type, id] = match;
                    return (
                      <button
                        key={partIdx}
                        type="button"
                        className={`citation-pill citation-${type}`}
                        onClick={() => {
                          if (type === 'issue') {
                            onOpenIssue?.(id);
                          } else {
                            onOpenEvidence?.({
                              kind: type === 'commit' ? 'commit' : 'history_event',
                              event_id: id,
                              summary: `Referenced citation ${id}`,
                            });
                          }
                        }}
                        title={`Click to inspect ${type} details`}
                      >
                        <Icon name={type === 'issue' ? 'issues' : type === 'commit' ? 'commit' : 'file-text'} size={11} />
                        {id}
                      </button>
                    );
                  }
                  return part;
                })}
              </p>
            );
          })}
        </div>
      );
    });
  }

  return (
    <div className="assistant-container">
      {/* Header bar with Model & Status telemetry */}
      <div className="assistant-header-card">
        <div className="assistant-brand-info">
          <div className="assistant-avatar">
            <Icon name="brain" size={24} color="#fff" />
          </div>
          <div>
            <div className="assistant-title-row">
              <h2>ChronoDev AI Assistant</h2>
              <span className={`badge ${aiStatus?.ready ? 'badge-success' : 'badge-warning'}`}>
                <span className="live-pulsar" />
                {aiStatus?.ready ? 'OLLAMA READY' : aiStatus?.enabled ? 'CONNECTING' : 'DISABLED'}
              </span>
            </div>
            <p className="assistant-subtitle">
              Grounding queries with local Ollama LLM (<b>{aiStatus?.model || 'llama3.2:3b'}</b>) against 32,500+ dated Apache Axis2 records.
            </p>
          </div>
        </div>

        <div className="assistant-telemetry-badge">
          <span>MODEL: <b>{aiStatus?.model || 'llama3.2:3b'}</b></span>
          <span>EVIDENCE CAP: <b>5 sources</b></span>
          <span>GROUNDING: <b>Verbatim Citations</b></span>
        </div>
      </div>

      {/* Chat Messages Log */}
      <div className="assistant-chat-window">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message-row role-${msg.role}`}>
            <div className="chat-avatar">
              <Icon name={msg.role === 'user' ? 'user' : 'brain'} size={16} />
            </div>

            <div className="chat-bubble-card">
              <div className="bubble-header">
                <strong>{msg.role === 'user' ? 'You' : 'ChronoDev AI'}</strong>
                <div className="bubble-meta">
                  {msg.model && <span className="bubble-model-tag">{msg.model}</span>}
                  <time>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                  {msg.role === 'assistant' && !msg.isError && (
                    <button
                      type="button"
                      className="icon-button copy-icon-btn"
                      onClick={() => handleCopyAnswer(msg.text)}
                      title="Copy Answer"
                    >
                      <Icon name="copy" size={13} />
                    </button>
                  )}
                </div>
              </div>

              <div className="bubble-content">
                {renderFormattedAnswer(msg.text)}
              </div>

              {/* Attached Evidence Chips */}
              {msg.evidence && msg.evidence.length > 0 && (
                <div className="bubble-evidence-tray">
                  <span className="evidence-tray-label">
                    <Icon name="sparkles" size={12} color="var(--accent-cyan)" /> Grounded Evidence Citations:
                  </span>
                  <div className="evidence-chips-list">
                    {msg.evidence.map((ev, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="evidence-action-chip"
                        onClick={() => onOpenEvidence?.(ev)}
                      >
                        <span className="chip-kind">{ev.kind || 'evidence'}</span>
                        <span className="chip-id">
                          {ev.event_id?.slice(0, 8) || ev.issue_id || ev.commit_hash?.slice(0, 8) || 'source'}
                        </span>
                        {ev.confidence != null && (
                          <span className="chip-conf">{Math.round(ev.confidence * 100)}%</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="chat-message-row role-assistant">
            <div className="chat-avatar">
              <Icon name="brain" size={16} />
            </div>
            <div className="chat-bubble-card thinking-bubble">
              <div className="loading-spinner-sm" />
              <span>Querying historical evidence and generating grounded Ollama response…</span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Preset Suggestions Chips */}
      <div className="assistant-suggestions-bar">
        <span className="suggestions-label">Try asking:</span>
        <div className="suggestions-scroll">
          {SUGGESTIONS.map((s, idx) => (
            <button
              key={idx}
              type="button"
              className="suggestion-chip"
              onClick={() => handleSend(s)}
              disabled={busy}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Input Box Form */}
      <form
        className="assistant-input-box"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <textarea
          className="assistant-textarea"
          rows={2}
          placeholder="Ask what changed, why an architectural choice was made, or summarize a Jira ticket..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          type="submit"
          className="btn btn-primary send-btn"
          disabled={busy || !input.trim()}
        >
          {busy ? (
            <>
              <div className="loading-spinner-sm" /> Thinking…
            </>
          ) : (
            <>
              <Icon name="zap" size={15} /> Ask ChronoDev
            </>
          )}
        </button>
      </form>
    </div>
  );
}
