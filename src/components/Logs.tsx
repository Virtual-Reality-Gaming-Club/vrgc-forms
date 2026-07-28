"use client";

import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, onSnapshot, limit, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AdminLog {
  id: string;
  adminEmail?: string | null;
  action: string;
  targetEmail?: string | null;
  targetName?: string | null;
  details?: string | null;
  timestamp: Timestamp | string | null | undefined;
}

interface AdminLogsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ACTION_META: Record<string, { label: string; color: string; icon: string }> = {
  VERIFY: { label: 'VERIFIED', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', icon: 'verified' },
  SET_PENDING: { label: 'PENDING', color: 'text-amber-400   bg-amber-500/10   border-amber-500/30', icon: 'pending' },
  DELETE: { label: 'DELETED', color: 'text-red-400     bg-red-500/10     border-red-500/30', icon: 'delete_forever' },
  SYNC_SHEETS: { label: 'SYNCED', color: 'text-cyan-400    bg-cyan-500/10    border-cyan-500/30', icon: 'cloud_upload' },
  DOWNLOAD: { label: 'DOWNLOADED', color: 'text-purple-400  bg-purple-500/10  border-purple-500/30', icon: 'download' },
};

const DEFAULT_META = { label: 'ACTION', color: 'text-slate-400 bg-white/5 border-white/10', icon: 'info' };

function formatTimestamp(ts: Timestamp | string | null | undefined): string {
  if (!ts) return '—';
  try {
    if (typeof ts === 'object' && 'toDate' in ts && typeof (ts as Timestamp).toDate === 'function') {
      return (ts as Timestamp).toDate().toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
      });
    }
    const d = new Date(ts as string);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
      });
    }
  } catch { /* fall through */ }
  return '—';
}

function maskEmail(email: string | null | undefined): string {
  if (!email) return '—';
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  return `${local.slice(0, 3)}***@${domain}`;
}

// ─── Side Panel Component ────────────────────────────────────────────────────

const FILTER_OPTIONS = ['ALL', 'VERIFY', 'SET_PENDING', 'DELETE', 'SYNC_SHEETS'];

const AdminLogsPanel: React.FC<AdminLogsPanelProps> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('ALL');

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    const q = query(collection(db, 'admin_logs'), orderBy('timestamp', 'desc'), limit(200));
    const unsub = onSnapshot(q,
      (snap) => {
        setLogs(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<AdminLog, 'id'>) })));
        setLoading(false);
      },
      (err) => { console.error('[AdminLogsPanel]', err); setLoading(false); }
    );
    return () => unsub();
  }, [isOpen]);

  const filteredLogs = React.useMemo(() => {
    return filter === 'ALL' ? logs : logs.filter(l => l.action === filter);
  }, [logs, filter]);

  return (
    /* Slide-in panel — sits alongside the main content, not over it */
    <div
      className={`flex flex-col h-full border-l border-purple-500/20 bg-[#070212]/90 backdrop-blur-xl
        transition-all duration-300 ease-in-out overflow-hidden
        ${isOpen ? 'w-full opacity-100' : 'w-0 opacity-0 pointer-events-none'}`}
      style={{ minWidth: isOpen ? 0 : 0 }}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-purple-500/20 bg-gradient-to-r from-purple-950/60 to-transparent shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-700 flex items-center justify-center shadow">
            <span className="material-symbols-outlined text-white text-sm">history</span>
          </div>
          <div>
            <p className="text-white font-bold text-xs uppercase tracking-widest">Activity Logs</p>
            <p className="text-[9px] text-slate-500 mt-0.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
              Live · <span className="font-mono text-purple-400">admin_logs</span>
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
          aria-label="Close Logs"
        >
          <span className="material-symbols-outlined text-base">close</span>
        </button>
      </div>

      {/* ── Filter chips ── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/5 overflow-x-auto shrink-0 scrollbar-none">
        {FILTER_OPTIONS.map(opt => {
          const isActive = filter === opt;
          const meta = ACTION_META[opt];
          return (
            <button
              key={opt}
              onClick={() => setFilter(opt)}
              className={`px-2 py-0.5 rounded-full text-[9px] font-black tracking-wider border whitespace-nowrap transition-all ${isActive
                  ? 'bg-purple-500/25 text-purple-200 border-purple-400/50'
                  : 'bg-white/5 text-slate-400 border-white/10 hover:border-white/20 hover:text-white'
                }`}
            >
              {opt === 'ALL' ? 'ALL' : (meta?.label ?? opt)}
            </button>
          );
        })}
      </div>

      {/* ── Log entries ── */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5 scrollbar-thin scrollbar-thumb-purple-500/20 scrollbar-track-transparent">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-500">
            <span className="material-symbols-outlined text-3xl animate-spin">sync</span>
            <span className="text-[11px]">Loading logs…</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-500">
            <span className="material-symbols-outlined text-3xl">inbox</span>
            <span className="text-[11px]">No logs found.</span>
          </div>
        ) : (
          filteredLogs.map((log, idx) => {
            const meta = ACTION_META[log.action] ?? DEFAULT_META;
            return (
              <div
                key={log.id}
                className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 hover:bg-white/[0.05] transition-all"
              >
                {/* Action icon */}
                <div className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${meta.color}`}>
                  <span className="material-symbols-outlined text-[13px]">{meta.icon}</span>
                </div>

                {/* Body */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                    <span className={`px-1.5 py-px rounded-full text-[8px] font-black border ${meta.color}`}>
                      {meta.label}
                    </span>
                    {log.targetName && (
                      <span className="text-[10px] font-semibold text-white truncate">{log.targetName}</span>
                    )}
                  </div>
                  {log.details && (
                    <p className="text-[9px] text-slate-400 leading-relaxed mb-0.5 line-clamp-2">{log.details}</p>
                  )}
                  <div className="flex items-center gap-1 text-[8px] text-slate-600 flex-wrap">
                    <span className="material-symbols-outlined text-[10px]">person</span>
                    <span className="font-mono truncate">{maskEmail(log.adminEmail)}</span>
                    <span>·</span>
                    <span>{formatTimestamp(log.timestamp)}</span>
                  </div>
                </div>

                <span className="text-[8px] text-slate-700 shrink-0 tabular-nums">#{filteredLogs.length - idx}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default AdminLogsPanel;
