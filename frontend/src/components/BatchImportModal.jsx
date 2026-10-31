import React, { useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';

const SAMPLE_BATCHES = {
  security: `[
  {
    "source_type": "meeting",
    "source_id": "ARCH-SEC-2024-01",
    "summary": "Architecture board approves WS-Policy Rampart security profile",
    "description": "On 2024-03-05 the architecture review team approved the new WS-Policy Rampart security configuration workflow for enterprise tokens.",
    "occurred_at": "2024-03-05T10:00:00Z"
  },
  {
    "source_type": "pull_request",
    "source_id": "PR-SEC-9402",
    "summary": "Implement Rampart token refresh handlers",
    "description": "Implemented cryptographic token validation and automatic refresh in Axis2 client dispatchers. Merged on 2024-03-12.",
    "occurred_at": "2024-03-12T14:30:00Z"
  }
]`,
  http: `[
  {
    "source_type": "issue",
    "source_id": "AXIS2-BATCH-HTTP1",
    "summary": "Async HTTP transport client connection pooling enhancement",
    "description": "Upgraded HttpAsyncClient to support keep-alive connection reuse under high concurrency on 2023-11-14.",
    "occurred_at": "2023-11-14T09:00:00Z"
  },
  {
    "source_type": "commit",
    "source_id": "c7f9024a89bd1234567890abcdef1234567890ab",
    "summary": "Add pooling connection manager for Axis2 commons HTTP client",
    "description": "Implemented PoolingHttpClientConnectionManager with configurable max connections per route.",
    "occurred_at": "2023-11-16T18:45:00Z"
  }
]`,
};

export function BatchImportModal({ isOpen, onClose, onAdded, onToast }) {
  const [jsonText, setJsonText] = useState(SAMPLE_BATCHES.security);
  const [busy, setBusy] = useState(false);
  const [validationError, setValidationError] = useState(null);

  if (!isOpen) return null;

  function handleJsonChange(value) {
    setJsonText(value);
    try {
      JSON.parse(value);
      setValidationError(null);
    } catch (e) {
      setValidationError(e.message);
    }
  }

  function handleFormat() {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setValidationError(null);
      onToast?.('JSON formatted cleanly', 'info');
    } catch (e) {
      setValidationError(e.message);
    }
  }

  async function handleImport() {
    let records = [];
    try {
      const parsed = JSON.parse(jsonText);
      records = Array.isArray(parsed) ? parsed : parsed.records;
      if (!Array.isArray(records) || records.length === 0) {
        throw new Error('Please provide an array containing 1 to 25 records.');
      }
      if (records.length > 25) {
        throw new Error('Maximum batch size is 25 records per request.');
      }
    } catch (e) {
      setValidationError(e.message);
      return;
    }

    setBusy(true);
    try {
      const res = await api.addRecordBatch(records);
      const msg = `Batch processed: ${res.created} created, ${res.duplicates} duplicates, ${res.failed} failed.`;
      if (res.created > 0) {
        onToast?.(msg, 'success');
        onAdded?.();
      } else {
        onToast?.(msg, 'warning');
      }
      onClose();
    } catch (err) {
      onToast?.(`Batch import failed: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-batch" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="badge badge-accent">
              <Icon name="database" size={13} /> INCREMENTAL DATA INGESTION
            </span>
            <h2 className="modal-title-text" style={{ marginTop: 6 }}>Import Batch of Historical Records</h2>
          </div>
          <button type="button" className="icon-button close-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        <p className="modal-description">
          Paste 1 to 25 JSON records. ChronoDev AI deduplicates repeats, generates canonical feature linkages, and passes content through the local Ollama event extraction engine.
        </p>

        <div className="batch-sample-bar">
          <span className="sample-label">Load Preset Sample:</span>
          <button
            type="button"
            className="btn btn-chip"
            onClick={() => handleJsonChange(SAMPLE_BATCHES.security)}
          >
            WS-Security Rampart (2 items)
          </button>
          <button
            type="button"
            className="btn btn-chip"
            onClick={() => handleJsonChange(SAMPLE_BATCHES.http)}
          >
            HTTP Transport Client (2 items)
          </button>
          <button type="button" className="btn btn-chip" style={{ marginLeft: 'auto' }} onClick={handleFormat}>
            Format JSON
          </button>
        </div>

        <div className="editor-container">
          <textarea
            className={`batch-json-textarea ${validationError ? 'has-error' : ''}`}
            rows={12}
            value={jsonText}
            onChange={(e) => handleJsonChange(e.target.value)}
            spellCheck="false"
          />
          {validationError && (
            <div className="json-error-banner">
              <Icon name="alert" size={14} color="#f87171" />
              <span>JSON Syntax Error: {validationError}</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleImport}
            disabled={busy || !!validationError}
          >
            {busy ? (
              <>
                <div className="loading-spinner-sm" /> Ingesting Batch…
              </>
            ) : (
              <>
                <Icon name="zap" size={15} /> Import & Process Batch
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
