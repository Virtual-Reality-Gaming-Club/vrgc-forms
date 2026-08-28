"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  fetchFutureEvents,
  fetchAllFaculty,
  createFutureEvent,
  updateFutureEvent,
  deleteFutureEvent,
  submitFacultyDecision,
} from '@/lib/faculty';
import { FutureEventPlan, FacultyMember, FacultyApprovalStatus } from '@/types/faculty';

interface PlannedEventsProps {
  isAdmin?: boolean;
  isFaculty?: boolean;
  userEmail?: string;
  userName?: string;
  onRedirect?: () => void;
}

/**
 * Parses any incoming date string (DD-MM-YYYY, YYYY-MM-DD, or text) into
 * HTML5 date picker value (YYYY-MM-DD) and formatted DD-MM-YYYY string.
 */
function parseDateStrToPicker(str: string): { picker: string; formatted: string } {
  if (!str) return { picker: '', formatted: '' };

  // Match DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = str.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    return {
      picker: `${year}-${month}-${day}`,
      formatted: `${day}-${month}-${year}`,
    };
  }

  // Match YYYY-MM-DD
  const ymdMatch = str.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, '0');
    const day = ymdMatch[3].padStart(2, '0');
    return {
      picker: `${year}-${month}-${day}`,
      formatted: `${day}-${month}-${year}`,
    };
  }

  // Try standard Date parsing
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return {
      picker: `${year}-${month}-${day}`,
      formatted: `${day}-${month}-${year}`,
    };
  }

  return { picker: '', formatted: '' };
}

function getPresetDateObj(daysAhead: number): { picker: string; formatted: string; readable: string } {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const formatted = `${day}-${month}-${year}`;
  const readable = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return {
    picker: `${year}-${month}-${day}`,
    formatted: formatted,
    readable: `${formatted} (${readable})`,
  };
}

const PlannedEvents: React.FC<PlannedEventsProps> = ({
  isAdmin = false,
  isFaculty = false,
  userEmail = '',
  userName = 'User',
}) => {
  const [events, setEvents] = useState<FutureEventPlan[]>([]);
  const [facultyList, setFacultyList] = useState<FacultyMember[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Admin Modal States
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState<string>('');
  const [formDatePicker, setFormDatePicker] = useState<string>('');
  const [formDateFormatted, setFormDateFormatted] = useState<string>('');
  const [formDateCustomText, setFormDateCustomText] = useState<string>('');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formDriveLink, setFormDriveLink] = useState<string>('');
  const [savingEvent, setSavingEvent] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Faculty Decision Modal State
  const [decisionModalEvent, setDecisionModalEvent] = useState<FutureEventPlan | null>(null);
  const [decisionType, setDecisionType] = useState<FacultyApprovalStatus>('approved');
  const [decisionRemarks, setDecisionRemarks] = useState<string>('');
  const [submittingDecision, setSubmittingDecision] = useState<boolean>(false);

  // Active Expanded Faculty Breakdown Accordion (for Admin oversight)
  const [expandedBreakdownId, setExpandedBreakdownId] = useState<string | null>(null);

  const sanitizedUserKey = useMemo(() => {
    return userEmail.toLowerCase().replace(/[^a-zA-Z0-9_]/g, '_');
  }, [userEmail]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [fetchedEvents, fetchedFaculty] = await Promise.all([
        fetchFutureEvents(),
        fetchAllFaculty(),
      ]);
      setEvents(fetchedEvents);
      setFacultyList(fetchedFaculty);
    } catch (err) {
      console.error('Error loading planned events & faculty:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const showStatus = (text: string, type: 'success' | 'error') => {
    setStatusMessage({ text, type });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const applyDatePreset = (daysAhead: number) => {
    const preset = getPresetDateObj(daysAhead);
    setFormDatePicker(preset.picker);
    setFormDateFormatted(preset.formatted);
    setFormDateCustomText(preset.readable);
  };

  // Open Create modal (Admin)
  const handleOpenCreateModal = () => {
    setEditingEventId(null);
    setFormTitle('');
    const defaultPreset = getPresetDateObj(14);
    setFormDatePicker(defaultPreset.picker);
    setFormDateFormatted(defaultPreset.formatted);
    setFormDateCustomText(defaultPreset.readable);
    setFormDescription('');
    setFormDriveLink('');
    setIsModalOpen(true);
  };

  // Open Edit modal (Admin)
  const handleOpenEditModal = (event: FutureEventPlan) => {
    setEditingEventId(event.id);
    setFormTitle(event.title);
    const parsed = parseDateStrToPicker(event.tentativeDate);
    setFormDatePicker(parsed.picker);
    setFormDateFormatted(parsed.formatted);
    setFormDateCustomText(event.tentativeDate || parsed.formatted);
    setFormDescription(event.description);
    setFormDriveLink(event.driveLink);
    setIsModalOpen(true);
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalDate = formDateCustomText.trim() || formDateFormatted || formDatePicker;
    if (!formTitle.trim() || !finalDate || !formDescription.trim()) {
      showStatus('Please complete all required fields (Title, Date, Description).', 'error');
      return;
    }

    setSavingEvent(true);
    try {
      if (editingEventId) {
        const ok = await updateFutureEvent(editingEventId, {
          title: formTitle.trim(),
          tentativeDate: finalDate,
          description: formDescription.trim(),
          driveLink: formDriveLink.trim(),
        });
        if (ok) {
          showStatus('Event plan updated successfully.', 'success');
          setIsModalOpen(false);
          loadData();
        } else {
          showStatus('Failed to update event plan.', 'error');
        }
      } else {
        const created = await createFutureEvent(
          {
            title: formTitle.trim(),
            tentativeDate: finalDate,
            description: formDescription.trim(),
            driveLink: formDriveLink.trim(),
          },
          userEmail || 'admin@vrgc.org'
        );
        if (created) {
          showStatus('Event plan published for faculty review.', 'success');
          setIsModalOpen(false);
          loadData();
        } else {
          showStatus('Failed to create event plan.', 'error');
        }
      }
    } catch (err) {
      console.error('Save event error:', err);
      showStatus('An unexpected error occurred.', 'error');
    } finally {
      setSavingEvent(false);
    }
  };

  const handleDeleteEvent = async (eventId: string, title: string) => {
    if (!window.confirm(`Are you sure you want to delete the event plan "${title}"?`)) {
      return;
    }
    const ok = await deleteFutureEvent(eventId);
    if (ok) {
      showStatus('Event plan deleted successfully.', 'success');
      loadData();
    } else {
      showStatus('Failed to delete event plan.', 'error');
    }
  };

  // Faculty Decision Handlers
  const handleOpenDecisionModal = (event: FutureEventPlan, status: FacultyApprovalStatus) => {
    const existingDecision = event.facultyDecisions?.[sanitizedUserKey];
    setDecisionModalEvent(event);
    setDecisionType(status);
    setDecisionRemarks(existingDecision?.remarks || '');
  };

  const handleSubmitDecision = async () => {
    if (!decisionModalEvent) return;
    setSubmittingDecision(true);
    try {
      const ok = await submitFacultyDecision(
        decisionModalEvent.id,
        userEmail,
        userName,
        decisionType,
        decisionRemarks.trim()
      );
      if (ok) {
        showStatus(`Decision recorded: ${decisionType.toUpperCase()}`, 'success');
        setDecisionModalEvent(null);
        loadData();
      } else {
        showStatus('Failed to record decision.', 'error');
      }
    } catch (err) {
      console.error('Decision submission error:', err);
      showStatus('Error recording decision.', 'error');
    } finally {
      setSubmittingDecision(false);
    }
  };

  return (
    <div className="flex-grow min-h-screen bg-mesh p-4 md:p-8 text-left text-white select-none">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Page Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-purple-500/20">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-3 py-1 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[13px]">event_upcoming</span>
                EVENT PROPOSALS &amp; APPROVAL DESK
              </span>
              {isAdmin && (
                <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  ADMIN CONSOLE
                </span>
              )}
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">
              Planned Future Events
            </h1>
            <p className="text-slate-400 text-sm mt-1 max-w-2xl">
              Formal review lifecycle for upcoming VRGC club events. Faculty members review proposals and submit decisions, while administrators manage event proposals and monitor responses.
            </p>
          </div>

          {isAdmin && (
            <button
              onClick={handleOpenCreateModal}
              className="px-5 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-[0_0_20px_rgba(168,85,247,0.3)] transition-all flex items-center gap-2 self-start md:self-auto shrink-0"
            >
              <span className="material-symbols-outlined text-base">add_circle</span>
              Propose Future Event
            </button>
          )}
        </header>

        {/* Status Toast Message */}
        {statusMessage && (
          <div
            className={`p-4 rounded-xl text-xs font-bold flex items-center gap-2.5 border backdrop-blur-md shadow-lg ${
              statusMessage.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.2)]'
                : 'bg-rose-950/60 border-rose-500/40 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.2)]'
            }`}
          >
            <span className="material-symbols-outlined text-sm">
              {statusMessage.type === 'success' ? 'check_circle' : 'error'}
            </span>
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Main Content Area */}
        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-3 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
            <span className="text-xs text-purple-300 font-mono tracking-widest uppercase">
              Loading Event Proposals…
            </span>
          </div>
        ) : events.length === 0 ? (
          <div className="bg-[#12081f]/80 border border-purple-500/20 rounded-3xl p-12 text-center space-y-4">
            <span className="material-symbols-outlined text-6xl text-purple-400/40">event_busy</span>
            <h3 className="text-xl font-bold text-white">No Future Events Planned Yet</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              {isAdmin
                ? 'Click "+ Propose Future Event" above to create an event plan with tentative dates, description, and Drive assets for faculty review.'
                : 'There are currently no pending event proposals published by the club administrators. Please check back soon.'}
            </p>
            {isAdmin && (
              <button
                onClick={handleOpenCreateModal}
                className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all inline-flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                Create First Event Plan
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {events.map((event) => {
              const decisions = event.facultyDecisions || {};
              const userDecision = decisions[sanitizedUserKey]?.status || 'pending';
              const userRemarks = decisions[sanitizedUserKey]?.remarks || '';

              // Calculate metrics across all registered faculty members
              let approvedCount = 0;
              let rejectedCount = 0;
              let pendingCount = 0;

              facultyList.forEach((fac) => {
                const facKey = fac.email.toLowerCase().replace(/[^a-zA-Z0-9_]/g, '_');
                const st = decisions[facKey]?.status || 'pending';
                if (st === 'approved') approvedCount++;
                else if (st === 'rejected') rejectedCount++;
                else pendingCount++;
              });

              const isExpanded = expandedBreakdownId === event.id;

              return (
                <div
                  key={event.id}
                  className="bg-[#130822]/90 border border-purple-500/25 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-[0_0_30px_rgba(168,85,247,0.08)] space-y-6 relative overflow-hidden transition-all duration-200 hover:border-purple-500/40"
                >
                  {/* Event Top Bar */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="px-3 py-1 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-200 border border-purple-500/30 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[13px]">calendar_month</span>
                          Tentative Date: {event.tentativeDate}
                        </span>

                        {/* Overall Status Badge */}
                        <span
                          className={`px-3 py-1 rounded-full text-[10px] font-bold border flex items-center gap-1.5 ${
                            approvedCount > 0 && rejectedCount === 0
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : rejectedCount > 0
                              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                              : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          {approvedCount > 0 && rejectedCount === 0
                            ? `Approved by Faculty (${approvedCount}/${facultyList.length || 1})`
                            : rejectedCount > 0
                            ? `Requires Revision (${rejectedCount} Rejections)`
                            : `Review in Progress (${pendingCount} Pending)`}
                        </span>
                      </div>

                      <h2 className="text-2xl font-black text-white tracking-tight">{event.title}</h2>
                    </div>

                    {/* Admin Action Menu */}
                    {isAdmin && (
                      <div className="flex items-center gap-2 self-end sm:self-start shrink-0">
                        <button
                          onClick={() => handleOpenEditModal(event)}
                          className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold border border-white/10 transition-all flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-sm">edit</span>
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteEvent(event.id, event.title)}
                          className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold border border-rose-500/30 transition-all flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Event Description */}
                  <div className="bg-black/30 border border-white/5 rounded-2xl p-5 text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {event.description}
                  </div>

                  {/* Drive Assets & Metadata */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-2 border-t border-white/5">
                    <div className="flex items-center gap-3">
                      {event.driveLink ? (
                        <a
                          href={event.driveLink.startsWith('http') ? event.driveLink : `https://${event.driveLink}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 hover:text-blue-200 text-xs font-bold transition-all flex items-center gap-2 shadow-sm"
                        >
                          <span className="material-symbols-outlined text-base">folder_shared</span>
                          Open Google Drive Proposal &amp; Assets
                          <span className="material-symbols-outlined text-xs">open_in_new</span>
                        </a>
                      ) : (
                        <span className="text-xs text-slate-500 italic">No Google Drive link attached</span>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-400 font-mono">
                      Published: {new Date(event.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>

                  {/* Faculty Decision Bar (Visible to Faculty) */}
                  {isFaculty && (
                    <div className="bg-[#120822] border border-purple-500/30 rounded-2xl p-5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 shadow-inner">
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-purple-300 uppercase tracking-wider block">
                          YOUR FACULTY VERDICT
                        </span>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-black border uppercase tracking-wider ${
                              userDecision === 'approved'
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                : userDecision === 'rejected'
                                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            }`}
                          >
                            {userDecision === 'approved' ? '✓ APPROVED BY YOU' : userDecision === 'rejected' ? '✕ REJECTED BY YOU' : '⏳ PENDING REVIEW'}
                          </span>
                          {userRemarks && (
                            <span className="text-xs text-slate-400 italic">
                              Remarks: &quot;{userRemarks}&quot;
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Vote Buttons */}
                      <div className="flex items-center gap-2.5">
                        <button
                          onClick={() => handleOpenDecisionModal(event, 'approved')}
                          className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 shadow-md ${
                            userDecision === 'approved'
                              ? 'bg-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                              : 'bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-500/40 text-emerald-300'
                          }`}
                        >
                          <span className="material-symbols-outlined text-sm">thumb_up</span>
                          Approve Proposal
                        </button>

                        <button
                          onClick={() => handleOpenDecisionModal(event, 'rejected')}
                          className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 shadow-md ${
                            userDecision === 'rejected'
                              ? 'bg-rose-600 text-white shadow-[0_0_15px_rgba(244,63,94,0.4)]'
                              : 'bg-rose-950/60 hover:bg-rose-900/80 border border-rose-500/40 text-rose-300'
                          }`}
                        >
                          <span className="material-symbols-outlined text-sm">thumb_down</span>
                          Reject Proposal
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Faculty Oversight Matrix Accordion (Visible to Admin & Faculty) */}
                  <div className="border-t border-purple-500/15 pt-4">
                    <button
                      onClick={() => setExpandedBreakdownId(isExpanded ? null : event.id)}
                      className="w-full flex items-center justify-between text-xs font-bold text-purple-300 hover:text-white transition-colors py-1"
                    >
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm">how_to_reg</span>
                        <span>
                          Faculty Decision Breakdown ({approvedCount} Approved • {rejectedCount} Rejected • {pendingCount} Pending)
                        </span>
                      </div>
                      <span className="material-symbols-outlined text-base">
                        {isExpanded ? 'expand_less' : 'expand_more'}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="mt-4 bg-black/40 border border-purple-500/20 rounded-2xl p-4 divide-y divide-white/5 space-y-3">
                        {facultyList.length === 0 ? (
                          <p className="text-xs text-slate-500 italic py-2">No faculty records found in database.</p>
                        ) : (
                          facultyList.map((fac) => {
                            const facKey = fac.email.toLowerCase().replace(/[^a-zA-Z0-9_]/g, '_');
                            const dec = decisions[facKey];
                            const facStatus = dec?.status || 'pending';

                            return (
                              <div key={fac.email} className="pt-3 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-white">{fac.name}</span>
                                    <span className="text-[10px] text-slate-400 font-mono">({fac.email})</span>
                                  </div>
                                  {dec?.remarks && (
                                    <p className="text-[11px] text-slate-400 italic mt-0.5">
                                      Remarks: &quot;{dec.remarks}&quot;
                                    </p>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                                  <span
                                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                      facStatus === 'approved'
                                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                        : facStatus === 'rejected'
                                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                    }`}
                                  >
                                    {facStatus === 'approved'
                                      ? '✓ Approved'
                                      : facStatus === 'rejected'
                                      ? '✕ Rejected'
                                      : '⏳ Pending'}
                                  </span>
                                  {dec?.respondedAt && (
                                    <span className="text-[10px] text-slate-500 font-mono">
                                      {new Date(dec.respondedAt).toLocaleDateString('en-IN', {
                                        day: 'numeric',
                                        month: 'short',
                                      })}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Admin Event Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="bg-[#120822] border border-purple-500/40 rounded-3xl p-6 sm:p-8 max-w-xl w-full shadow-[0_0_50px_rgba(168,85,247,0.3)] space-y-6 text-left">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <h3 className="text-xl font-black text-white">
                {editingEventId ? 'Edit Event Plan' : 'Propose New Future Event'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-full text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveEvent} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-purple-300 mb-1">
                  EVENT TITLE *
                </label>
                <input
                  required
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g. XR Metaverse Hackathon '26"
                  className="w-full bg-black/40 border border-purple-500/30 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-purple-400"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-purple-300">
                    TENTATIVE EVENT DATE *
                  </label>
                  <span className="text-[10px] text-slate-400 font-semibold">DD-MM-YYYY &amp; Custom Label</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Left: DD-MM-YYYY Date Picker */}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-semibold text-slate-300">
                      Date Picker (DD-MM-YYYY)
                    </label>
                    <input
                      type="date"
                      value={formDatePicker}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormDatePicker(val);
                        if (val) {
                          const [y, m, d] = val.split('-');
                          const formatted = `${d}-${m}-${y}`;
                          setFormDateFormatted(formatted);
                          const dateObj = new Date(`${val}T00:00:00`);
                          const readable = dateObj.toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          });
                          setFormDateCustomText(`${formatted} (${readable})`);
                        }
                      }}
                      className="w-full bg-black/40 border border-purple-500/30 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-purple-400 font-mono"
                    />
                    {formDateFormatted && (
                      <div className="flex items-center gap-1 text-[10px] text-purple-300 font-mono pt-0.5">
                        <span className="text-slate-500 font-sans">Selected:</span>
                        <span className="bg-purple-500/15 border border-purple-500/30 px-1.5 py-0.5 rounded font-bold">
                          {formDateFormatted}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Right: Custom Date Display / Description */}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-semibold text-slate-300">
                      Custom Date / Description
                    </label>
                    <input
                      type="text"
                      required
                      value={formDateCustomText}
                      onChange={(e) => setFormDateCustomText(e.target.value)}
                      placeholder="e.g. 15-10-2026 or 15th October 2026"
                      className="w-full bg-black/40 border border-purple-500/30 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-purple-400"
                    />
                    <p className="text-[10px] text-slate-500">
                      Shown on proposal card &amp; faculty review desk.
                    </p>
                  </div>
                </div>

                {/* Presets */}
                <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto pb-1 custom-scrollbar">
                  <span className="text-[10px] text-slate-400 font-semibold flex-shrink-0">Presets:</span>
                  {[
                    { label: '+7 Days', days: 7 },
                    { label: '+14 Days', days: 14 },
                    { label: '+30 Days', days: 30 },
                    { label: '+60 Days', days: 60 },
                    { label: '+90 Days', days: 90 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyDatePreset(preset.days)}
                      className="px-2 py-1 rounded text-[10px] font-bold bg-purple-500/15 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 transition-all flex-shrink-0"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-purple-300 mb-1">
                  EVENT DESCRIPTION &amp; AGENDA *
                </label>
                <textarea
                  required
                  rows={4}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Describe the objectives, expected footfall, guest speakers, budget requirements, and venue details..."
                  className="w-full bg-black/40 border border-purple-500/30 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-purple-400"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-purple-300 mb-1">
                  GOOGLE DRIVE LINK (PROPOSAL / POSTER / SLIDES)
                </label>
                <input
                  type="url"
                  value={formDriveLink}
                  onChange={(e) => setFormDriveLink(e.target.value)}
                  placeholder="https://drive.google.com/..."
                  className="w-full bg-black/40 border border-purple-500/30 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-purple-400"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  disabled={savingEvent}
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-[0_0_20px_rgba(168,85,247,0.3)] flex items-center gap-2 transition-all"
                >
                  {savingEvent ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-sm">sync</span>
                      Saving…
                    </>
                  ) : (
                    'Save & Publish Plan'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Faculty Decision Modal */}
      {decisionModalEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="bg-[#120822] border border-purple-500/40 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-[0_0_50px_rgba(168,85,247,0.3)] space-y-5 text-left">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h3 className="text-lg font-black text-white">Record Faculty Decision</h3>
                <p className="text-xs text-purple-300 truncate">{decisionModalEvent.title}</p>
              </div>
              <button
                onClick={() => setDecisionModalEvent(null)}
                className="p-1 rounded-full text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-2">
                  VERDICT SELECTION
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDecisionType('approved')}
                    className={`py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border transition-all ${
                      decisionType === 'approved'
                        ? 'bg-emerald-600 text-white border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                        : 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm">check_circle</span>
                    Approve Plan
                  </button>

                  <button
                    type="button"
                    onClick={() => setDecisionType('rejected')}
                    className={`py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border transition-all ${
                      decisionType === 'rejected'
                        ? 'bg-rose-600 text-white border-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.4)]'
                        : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm">cancel</span>
                    Reject Plan
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  OPTIONAL REMARKS / FEEDBACK FOR CLUB LEADS
                </label>
                <textarea
                  rows={3}
                  value={decisionRemarks}
                  onChange={(e) => setDecisionRemarks(e.target.value)}
                  placeholder="e.g. Approved provided lab safety measures are verified, or Tentative date conflicts with exams..."
                  className="w-full bg-black/40 border border-purple-500/30 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-purple-400"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setDecisionModalEvent(null)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  disabled={submittingDecision}
                  onClick={handleSubmitDecision}
                  className={`px-5 py-2 rounded-xl text-white text-xs font-bold shadow-lg flex items-center gap-2 ${
                    decisionType === 'approved'
                      ? 'bg-emerald-600 hover:bg-emerald-500'
                      : 'bg-rose-600 hover:bg-rose-500'
                  }`}
                >
                  {submittingDecision ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-sm">sync</span>
                      Recording…
                    </>
                  ) : (
                    'Confirm Decision'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlannedEvents;
