"use client";

import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, limit, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface MemberAdminLogsProps {
  isOpen: boolean;
  onClose: () => void;
}

interface LogEntry {
  id: string;
  adminEmail: string;
  adminName: string;
  action: 'MEMBER_CREATED' | 'MEMBER_UPDATED' | 'MEMBER_DELETED';
  targetType: 'member';
  targetId: string;
  targetName: string;
  targetEmail: string | null;
  targetRegNo: string | null;
  changes: { [field: string]: { from: string; to: string } } | null;
  details: string | null;
  timestamp: Timestamp;
}

type FilterType = 'ALL' | 'CREATED' | 'UPDATED' | 'DELETED';

export const MemberAdminLogs: React.FC<MemberAdminLogsProps> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('ALL');

  useEffect(() => {
    if (!isOpen) return;

    // Prevent scrolling
    document.body.style.overflow = 'hidden';

    // Escape key
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);

    // Fetch logs
    const q = query(
      collection(db, 'member_admin_logs'),
      orderBy('timestamp', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logsData: LogEntry[] = [];
      snapshot.forEach((doc) => {
        logsData.push({ id: doc.id, ...doc.data() } as LogEntry);
      });
      setLogs(logsData);
      setLoading(false);
    }, (error) => {
      console.error('Error fetching logs:', error);
      setLoading(false);
    });

    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleEsc);
      unsubscribe();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredLogs = logs.filter((log) => {
    if (filter === 'ALL') return true;
    if (filter === 'CREATED' && log.action === 'MEMBER_CREATED') return true;
    if (filter === 'UPDATED' && log.action === 'MEMBER_UPDATED') return true;
    if (filter === 'DELETED' && log.action === 'MEMBER_DELETED') return true;
    return false;
  });

  const formatTimestamp = (ts: Timestamp | null) => {
    if (!ts) return '';
    const date = ts.toDate();
    return new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const getActionConfig = (action: string) => {
    switch (action) {
      case 'MEMBER_CREATED':
        return { icon: 'person_add', color: 'text-emerald-400', bg: 'bg-emerald-400/10' };
      case 'MEMBER_UPDATED':
        return { icon: 'edit', color: 'text-amber-400', bg: 'bg-amber-400/10' };
      case 'MEMBER_DELETED':
        return { icon: 'delete_forever', color: 'text-rose-400', bg: 'bg-rose-400/10' };
      default:
        return { icon: 'info', color: 'text-slate-400', bg: 'bg-slate-400/10' };
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-2xl bg-[#0e0518] border border-purple-500/30 rounded-2xl flex flex-col max-h-[90vh] sm:max-h-[85vh] overflow-hidden select-none shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3.5 sm:p-4 border-b border-purple-500/20 shrink-0">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-purple-400 text-xl sm:text-2xl">history</span>
            <h2 className="text-base sm:text-lg font-bold text-white font-display-lg">Member Admin Activity</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Filters */}
        <div className="px-3 py-2.5 sm:p-4 flex gap-2 border-b border-purple-500/20 overflow-x-auto overscroll-x-contain shrink-0">
          {(['ALL', 'CREATED', 'UPDATED', 'DELETED'] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer transition-colors active:scale-95 ${
                filter === f
                  ? f === 'CREATED' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : f === 'UPDATED' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : f === 'DELETED' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  : 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                  : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Log List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5 sm:space-y-3 overscroll-contain">
          {loading ? (
            <div className="flex justify-center items-center py-10">
              <span className="material-symbols-outlined animate-spin text-purple-500 text-3xl">refresh</span>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-10 text-slate-500">
              <span className="material-symbols-outlined text-4xl mb-2 opacity-50">history_toggle_off</span>
              <p>No admin activity recorded yet</p>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const config = getActionConfig(log.action);
              return (
                <div key={log.id} className="flex gap-3 p-3 rounded-xl bg-black/40 border border-white/5 hover:border-purple-500/20 transition-colors">
                  <div className={`mt-1 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${config.bg} ${config.color}`}>
                    <span className="material-symbols-outlined text-[18px]">{config.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1 sm:gap-4 mb-1">
                      <div>
                        <span className="font-bold text-white text-sm">{log.adminName}</span>
                        <span className="text-slate-300 text-sm ml-1">
                          {log.action === 'MEMBER_CREATED' ? 'Created member' : log.action === 'MEMBER_UPDATED' ? 'Updated member' : 'Deleted member'} <span className="font-semibold text-purple-300">{log.targetName}</span>
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 whitespace-nowrap">
                        {formatTimestamp(log.timestamp)}
                      </span>
                    </div>
                    
                    <div className="text-[10px] text-slate-500 font-mono mb-2">
                      {log.adminEmail}
                    </div>

                    {log.changes && Object.keys(log.changes).length > 0 && (
                      <div className="bg-black/40 rounded-lg p-2 space-y-1 border border-white/5">
                        {Object.entries(log.changes).map(([field, { from, to }]) => (
                          <div key={field} className="text-[10px] text-slate-400 flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-slate-300 capitalize">{field}:</span>
                            {from ? <span className="line-through opacity-70">{from}</span> : <span className="italic opacity-50">none</span>}
                            <span className="material-symbols-outlined text-[12px] opacity-70">arrow_right_alt</span>
                            <span className="text-white">{to || <span className="italic opacity-50">none</span>}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {log.details && !log.changes && (
                      <div className="text-xs text-slate-400 bg-black/40 rounded-lg p-2 border border-white/5 mt-1">
                        {log.details}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default MemberAdminLogs;
