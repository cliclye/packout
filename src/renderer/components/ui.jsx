import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { store, useApp } from '../store';

// ------------------------------------------------------------------ icons ---

const I = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  picklist: <path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  chart: <path d="M3 3v18h18M7 15l4-4 3 3 5-6" />,
  film: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4" /></>,
  route: <><circle cx="5" cy="19" r="2" /><circle cx="19" cy="5" r="2" /><path d="M7 19h6a4 4 0 0 0 0-8h-2a4 4 0 0 1 0-8h6" /></>,
  wrench: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
  sync: <path d="M21 12a9 9 0 0 0-15-6.7L3 8M3 3v5h5M3 12a9 9 0 0 0 15 6.7L21 16M16 16h5v5" />,
  sliders: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M18 6L6 18M6 6l12 12" />,
  check: <path d="M20 6L9 17l-5-5" />,
  trash: <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />,
  download: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />,
  upload: <path d="M12 21V9M7 14l5-5 5 5M5 3h14" />,
  play: <path d="M7 4l13 8-13 8z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  alert: <path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  phone: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
  sparkles: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />,
  key: <><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2L21 2M17 6l3 3" /></>,
  external: <path d="M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />,
  camera: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
  trophy: <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />,
  file: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" />,
  crosshair: <><circle cx="12" cy="12" r="9" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /></>,
  layers: <path d="M12 2L2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />,
  cpu: <><rect x="5" y="5" width="14" height="14" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>,
  send: <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />,
  flag: <path d="M4 22V4M4 4h13l-2 4 2 4H4" />,
  eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></>,
  pin: <path d="M12 17v5M9 3h6l-1 7 3 3v2H7v-2l3-3z" />,
  rotate: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />,
};

export function Icon({ name, size = 18, className = '', style }) {
  return (
    <svg
      className={`icon ${className}`}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {I[name] || null}
    </svg>
  );
}

export function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d83ff" />
          <stop offset="1" stopColor="#3a4fe0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#lg)" />
      <path d="M9 22V10h6.2a4 4 0 0 1 0 8H9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22.5" cy="21.5" r="2" fill="#fff" opacity=".85" />
    </svg>
  );
}

// ---------------------------------------------------------------- buttons ---

export function Button({ variant = 'secondary', size, icon, loading, children, className = '', ...rest }) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`}
      disabled={rest.disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 16} /> : null}
      {children !== undefined && children !== null && <span>{children}</span>}
    </button>
  );
}

export function Spinner({ size = 16 }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />;
}

// ----------------------------------------------------------------- layout ---

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, subtitle, actions, children, className = '', flush = false, ...rest }) {
  return (
    <section className={`card ${className}`} {...rest}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      <div className={flush ? 'card-body flush' : 'card-body'}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }) {
  return (
    <div className={`stat ${tone ? 'tone-' + tone : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Badge({ tone = 'neutral', children, title }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Empty({ icon = 'info', title, body, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={22} />
      </div>
      <h4>{title}</h4>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function Field({ label, hint, children, error }) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      {children}
      {error ? <span className="field-hint error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className = '' }) {
  return (
    <div className={`search ${className}`}>
      <Icon name="search" size={16} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} />
      {value && (
        <button type="button" className="search-clear" onClick={() => onChange('')} aria-label="Clear search">
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

export function Segmented({ value, onChange, options, size }) {
  return (
    <div className={`segmented ${size === 'sm' ? 'sm' : ''}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, indeterminate, label, detail }) {
  const pct = Math.round(Math.max(0, Math.min(1, value || 0)) * 100);
  return (
    <div className="progress-wrap">
      {(label || detail) && (
        <div className="progress-meta">
          <span>{label}</span>
          <span>{indeterminate ? detail || '' : `${pct}%${detail ? ' · ' + detail : ''}`}</span>
        </div>
      )}
      <div className={`progress ${indeterminate ? 'indeterminate' : ''}`}>
        <div style={{ width: indeterminate ? '35%' : `${pct}%` }} />
      </div>
    </div>
  );
}

export function LogBox({ lines, height = 160 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length]);
  return (
    <div className="logbox" ref={ref} style={{ maxHeight: height }}>
      {lines.length === 0 ? <div className="muted">Nothing yet.</div> : lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  );
}

// ----------------------------------------------------------------- badges ---

export function RankBadge({ rank }) {
  return <span className={`rank ${rank <= 8 ? 'top' : ''}`}>{rank}</span>;
}

const ROLE_TONE = {
  'Captain Core': 'accent',
  'Defense Anchor': 'danger',
  'Efficient Scorer': 'ok',
  'Endgame Value': 'warn',
  'First Round': 'violet',
  Depth: 'neutral',
};
export function RoleTag({ role }) {
  return <Badge tone={ROLE_TONE[role] || 'neutral'}>{role || 'Depth'}</Badge>;
}

export function RiskTag({ risk }) {
  return <Badge tone={risk === 'High' ? 'danger' : risk === 'Medium' ? 'warn' : 'ok'}>{risk} risk</Badge>;
}

// ----------------------------------------------------------------- modals ---

export function Modal({ title, onClose, children, footer, width = 520 }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          {onClose && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// Promise-based confirm dialog (replaces window.confirm).
let dialogState = null;
const dialogListeners = new Set();
const setDialog = (d) => {
  dialogState = d;
  dialogListeners.forEach((l) => l());
};

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    setDialog({ title, message, confirmLabel, danger, resolve });
  });
}

export function DialogHost() {
  const d = useSyncExternalStore(
    (l) => {
      dialogListeners.add(l);
      return () => dialogListeners.delete(l);
    },
    () => dialogState
  );
  if (!d) return null;
  const done = (v) => {
    setDialog(null);
    d.resolve(v);
  };
  return (
    <Modal
      title={d.title}
      width={440}
      onClose={() => done(false)}
      footer={
        <>
          <Button onClick={() => done(false)}>Cancel</Button>
          <Button variant={d.danger ? 'danger' : 'primary'} onClick={() => done(true)} autoFocus>
            {d.confirmLabel}
          </Button>
        </>
      }
    >
      <p className="modal-text">{d.message}</p>
    </Modal>
  );
}

// ----------------------------------------------------------------- toasts ---

export function Toasts() {
  const { toasts } = useApp();
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <Icon name={t.kind === 'error' || t.kind === 'warn' ? 'alert' : t.kind === 'success' ? 'check' : 'info'} size={16} />
          <span>{t.message}</span>
          <button type="button" className="icon-btn" onClick={() => store.dismissToast(t.id)} aria-label="Dismiss">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- helpers ---

export const fmt = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '–');
export const pct = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : '–');

/** Small hook: run an async fn with loading/error state. */
export function useAsync() {
  const [state, setState] = useState({ loading: false, error: null });
  const run = async (fn) => {
    setState({ loading: true, error: null });
    try {
      const r = await fn();
      setState({ loading: false, error: null });
      return r;
    } catch (e) {
      setState({ loading: false, error: e.message || String(e) });
      return undefined;
    }
  };
  return [state, run];
}
