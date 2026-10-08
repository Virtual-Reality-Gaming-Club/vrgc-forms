"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  where,
  serverTimestamp,
  arrayUnion,
  increment,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';

// ─── Types ────────────────────────────────────────────────────────────────────

export type IdeaCategory =
  | 'Tech & XR'
  | 'Gaming & Esports'
  | 'Education & Workshop'
  | 'Outreach & PR'
  | 'Misc';

export type IdeaStatus =
  | 'pending'
  | 'community'
  | 'faculty'
  | 'approved'
  | 'rejected'
  | 'archived';

export type IdeaNotifType =
  | 'faculty_review'     // idea sent to faculty review
  | 'promoted'           // idea promoted to community board
  | 'approved'           // idea approved
  | 'rejected'           // idea rejected
  | 'vote_milestone'     // vote threshold reached
  | 'new_comment'        // new comment on your idea
  | 'restored';          // idea restored to pending

export interface IdeaNotification {
  id: string;
  type: IdeaNotifType;
  recipientEmail: string;   // who receives this notification
  actorName: string;        // who triggered the action
  actorEmail: string;
  ideaId: string;
  ideaTitle: string;
  message: string;
  read: boolean;
  createdAt: any;
  coordinatorNote?: string;
}

export interface IdeaComment {
  id: string;
  authorEmail: string;
  authorName: string;
  avatarUrl: string;
  text: string;
  createdAt: string;
  isCoordinator?: boolean;
  isFaculty?: boolean;
}

export interface ClubIdea {
  id: string;
  title: string;
  description: string;
  category: IdeaCategory;
  customCategory?: string;
  tags?: string[];
  authorEmail: string;
  authorName: string;
  authorAvatar: string;
  authorRegNo?: string;
  status: IdeaStatus;
  upvotes: number;
  upvoterEmails: string[];
  upvoteThreshold?: number;
  comments: IdeaComment[];
  coordinatorNote?: string;
  facultyNote?: string;
  createdAt: any;
  updatedAt: any;
  promotedAt?: any;
  estimatedDate?: string;
  resourcesNeeded?: string;
  isFeatured?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES: { id: IdeaCategory; icon: string; color: string; bg: string; border: string }[] = [
  { id: 'Tech & XR', icon: 'vrpano', color: 'text-cyan-300', bg: 'bg-cyan-950/40', border: 'border-cyan-700/50' },
  { id: 'Gaming & Esports', icon: 'sports_esports', color: 'text-green-300', bg: 'bg-green-950/40', border: 'border-green-700/50' },
  { id: 'Education & Workshop', icon: 'school', color: 'text-blue-300', bg: 'bg-blue-950/40', border: 'border-blue-700/50' },
  { id: 'Outreach & PR', icon: 'campaign', color: 'text-orange-300', bg: 'bg-orange-950/40', border: 'border-orange-700/50' },
  { id: 'Misc', icon: 'more_horiz', color: 'text-slate-300', bg: 'bg-slate-800/40', border: 'border-slate-700/50' },
];

const STATUS_CONFIG: Record<IdeaStatus, { label: string; icon: string; color: string; bg: string; border: string; stage: number }> = {
  pending: { label: 'Under Review', icon: 'hourglass_top', color: 'text-amber-300', bg: 'bg-amber-950/50', border: 'border-amber-600/50', stage: 1 },
  community: { label: 'Community Board', icon: 'diversity_3', color: 'text-emerald-300', bg: 'bg-emerald-950/50', border: 'border-emerald-600/50', stage: 2 },
  faculty: { label: 'Faculty Review', icon: 'school', color: 'text-blue-300', bg: 'bg-blue-950/50', border: 'border-blue-600/50', stage: 3 },
  approved: { label: 'Approved 🎉', icon: 'check_circle', color: 'text-purple-300', bg: 'bg-purple-950/50', border: 'border-purple-500/60', stage: 4 },
  rejected: { label: 'Rejected', icon: 'cancel', color: 'text-rose-300', bg: 'bg-rose-950/50', border: 'border-rose-600/50', stage: -1 },
  archived: { label: 'Archived 🗄️', icon: 'archive', color: 'text-slate-400', bg: 'bg-slate-900/60', border: 'border-slate-700/50', stage: -1 },
};

const PIPELINE_STAGES = [
  { stage: 1, id: 'pending', label: 'Coordinator Triage', icon: 'hourglass_top', desc: 'Initial review by coordinators' },
  { stage: 2, id: 'community', label: 'Community Voting', icon: 'diversity_3', desc: 'Open for 1-vote member backing' },
  { stage: 3, id: 'faculty', label: 'Faculty Review', icon: 'school', desc: 'Faculty mentor review & notes' },
  { stage: 4, id: 'approved', label: 'Approved & Final', icon: 'check_circle', desc: 'Sanctioned event' },
];

const DEFAULT_UPVOTE_THRESHOLD = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCategoryConfig(cat: string) {
  return CATEGORIES.find((c) => c.id === cat) || CATEGORIES[CATEGORIES.length - 1];
}

function timeAgo(timestamp: any): string {
  if (!timestamp) return '';
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString();
}

function genAvatar(seed: string) {
  return `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(seed)}`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface IdeaHubProps {
  onRedirect?: () => void;
  isAdmin?: boolean;
}

const IdeaHub: React.FC<IdeaHubProps> = ({ onRedirect, isAdmin: propIsAdmin }) => {
  const { user, userEmail, isSuperAdmin, isAdmin, isFaculty, memberData, isAuthorized } = useAuth();
  const canModerate = isSuperAdmin || (propIsAdmin !== undefined ? propIsAdmin : (isAdmin ?? false));
  const isAuthorizedUser = isAuthorized || isFaculty || isSuperAdmin || isAdmin;

  // ── State ──────────────────────────────────────────────────────────────────
  const [ideas, setIdeas] = useState<ClubIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'community' | 'mine' | 'pending' | 'faculty' | 'approved' | 'archived'>('community');
  const [activeCategory, setActiveCategory] = useState<IdeaCategory | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'upvotes' | 'comments'>('newest');

  // Anti-spam voting lock
  const [votingInProgress, setVotingInProgress] = useState<{ [ideaId: string]: boolean }>({});

  // Single-Vote Confirmation Modal
  const [voteConfirmIdea, setVoteConfirmIdea] = useState<ClubIdea | null>(null);
  const [submittingVote, setSubmittingVote] = useState(false);

  // Detail Modal
  const [selectedIdea, setSelectedIdea] = useState<ClubIdea | null>(null);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  // Submit Modal
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState<IdeaCategory>('Tech & XR');
  const [formCustomCategory, setFormCustomCategory] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formResources, setFormResources] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Moderation / Action Modal
  const [moderateIdea, setModerateIdea] = useState<ClubIdea | null>(null);
  const [moderateAction, setModerateAction] = useState<'promote' | 'reject' | 'faculty' | 'approve' | 'archive' | 'restore' | 'delete' | null>(null);
  const [moderateNote, setModerateNote] = useState('');
  const [voteThresholdInput, setVoteThresholdInput] = useState<number>(DEFAULT_UPVOTE_THRESHOLD);
  const [submittingMod, setSubmittingMod] = useState(false);

  // ── Firestore Listener ────────────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, 'club_ideas'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const list: ClubIdea[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          title: data.title || '',
          description: data.description || '',
          category: data.category || 'Misc',
          customCategory: data.customCategory || '',
          tags: data.tags || [],
          authorEmail: data.authorEmail || '',
          authorName: data.authorName || '',
          authorAvatar: data.authorAvatar || genAvatar(data.authorEmail || ''),
          authorRegNo: data.authorRegNo || '',
          status: (data.status as IdeaStatus) || 'pending',
          upvotes: typeof data.upvotes === 'number' ? data.upvotes : (data.upvoterEmails?.length || 0),
          upvoterEmails: data.upvoterEmails || [],
          upvoteThreshold: data.upvoteThreshold || DEFAULT_UPVOTE_THRESHOLD,
          comments: data.comments || [],
          coordinatorNote: data.coordinatorNote || '',
          facultyNote: data.facultyNote || '',
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          promotedAt: data.promotedAt,
          estimatedDate: data.estimatedDate || '',
          resourcesNeeded: data.resourcesNeeded || '',
          isFeatured: data.isFeatured || false,
        };
      });
      setIdeas(list);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Add a notification helper ─────────────────────────────────────────────
  const addNotification = useCallback(async (
    recipientEmail: string,
    type: string,
    ideaId: string,
    ideaTitle: string,
    message: string,
    note?: string
  ) => {
    if (!userEmail || !recipientEmail) return;
    // Don't notify yourself, unless it's a broadcast
    if (recipientEmail.toLowerCase() === userEmail.toLowerCase() && !recipientEmail.startsWith('ROLE:')) return;
    try {
      await addDoc(collection(db, 'idea_notifications'), {
        type,
        recipientEmail,
        actorName: memberData?.name || user?.displayName || userEmail.split('@')[0] || 'Coordinator',
        actorEmail: userEmail,
        ideaId,
        ideaTitle,
        message,
        read: false,
        coordinatorNote: note || '',
        channelName: 'Idea Curator Hub',
        channelPath: 'ideahub',
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Failed to create notification:', err);
    }
  }, [userEmail, memberData, user]);

  // Sync selectedIdea with live state if open
  useEffect(() => {
    if (selectedIdea) {
      const updated = ideas.find((i) => i.id === selectedIdea.id);
      if (updated) {
        setSelectedIdea(updated);
      }
    }
  }, [ideas]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total: ideas.length,
    community: ideas.filter((i) => i.status === 'community').length,
    pending: ideas.filter((i) => i.status === 'pending').length,
    faculty: ideas.filter((i) => i.status === 'faculty').length,
    approved: ideas.filter((i) => i.status === 'approved').length,
    archived: ideas.filter((i) => i.status === 'archived' || i.status === 'rejected').length,
    mine: ideas.filter((i) => i.authorEmail?.toLowerCase() === userEmail?.toLowerCase()).length,
    totalUpvotes: ideas.reduce((acc, i) => acc + (i.upvotes || 0), 0),
  }), [ideas, userEmail]);

  const filteredIdeas = useMemo(() => {
    let list = [...ideas];
    if (activeTab === 'community') list = list.filter((i) => i.status === 'community');
    else if (activeTab === 'mine') list = list.filter((i) => i.authorEmail?.toLowerCase() === userEmail?.toLowerCase());
    else if (activeTab === 'pending') list = list.filter((i) => i.status === 'pending');
    else if (activeTab === 'faculty') list = list.filter((i) => i.status === 'faculty');
    else if (activeTab === 'approved') list = list.filter((i) => i.status === 'approved');
    else if (activeTab === 'archived') list = list.filter((i) => i.status === 'archived' || i.status === 'rejected');

    if (activeCategory !== 'All') {
      list = list.filter((i) => i.category === activeCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          (i.customCategory && i.customCategory.toLowerCase().includes(q)) ||
          i.authorName.toLowerCase().includes(q)
      );
    }

    if (sortBy === 'upvotes') list.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
    else if (sortBy === 'comments') list.sort((a, b) => (b.comments?.length || 0) - (a.comments?.length || 0));

    return list;
  }, [ideas, activeTab, activeCategory, searchQuery, sortBy, userEmail]);

  // ── Body scroll lock ──────────────────────────────────────────────────────
  useEffect(() => {
    if (submitModalOpen || selectedIdea || moderateIdea || voteConfirmIdea) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [submitModalOpen, selectedIdea, moderateIdea, voteConfirmIdea]);

  // ── Actions ───────────────────────────────────────────────────────────────

  // Initiate Vote Modal (1 Vote Per User Policy)
  const handleInitiateVote = (idea: ClubIdea) => {
    if (!userEmail) {
      alert('Please sign in to vote for event ideas.');
      return;
    }
    const hasVoted = idea.upvoterEmails?.includes(userEmail);
    if (hasVoted) {
      return; // Already voted, cannot vote again
    }
    setVoteConfirmIdea(idea);
  };

  // Confirm and record single vote permanently
  const handleConfirmVote = async () => {
    if (!voteConfirmIdea || !userEmail) return;
    const ideaId = voteConfirmIdea.id;
    if (votingInProgress[ideaId]) return;

    setSubmittingVote(true);
    setVotingInProgress((prev) => ({ ...prev, [ideaId]: true }));

    const docRef = doc(db, 'club_ideas', ideaId);
    try {
      // Use atomic increment to prevent race conditions with concurrent votes
      await updateDoc(docRef, {
        upvotes: increment(1),
        upvoterEmails: arrayUnion(userEmail),
        updatedAt: serverTimestamp(),
      });
      // Check if vote milestone reached (author notification)
      const idea = voteConfirmIdea;
      const newVoteCount = (idea.upvotes || 0) + 1;
      const threshold = idea.upvoteThreshold || DEFAULT_UPVOTE_THRESHOLD;
      if (newVoteCount >= threshold && idea.upvotes < threshold && idea.authorEmail) {
        await addNotification(
          idea.authorEmail,
          'vote_milestone',
          idea.id,
          idea.title,
          `🗳️ Your idea "${idea.title}" has reached ${threshold} community votes! Coordinators can now escalate it to Faculty Review.`
        );
        await addNotification(
          'ROLE:member',
          'vote_milestone_broadcast',
          idea.id,
          idea.title,
          `🎯 Milestone Reached: "${idea.title}" hit ${threshold} votes and is ready for Coordinator Review.`
        );
        await addNotification(
          'ROLE:admin',
          'vote_milestone_admin',
          idea.id,
          idea.title,
          `Action Required: "${idea.title}" hit ${threshold} votes and is ready for Faculty Escalation.`
        );
      }
      setVoteConfirmIdea(null);
    } catch (err) {
      console.error('Vote recording error:', err);
      alert('Failed to record vote. Please try again.');
    } finally {
      setSubmittingVote(false);
      setTimeout(() => {
        setVotingInProgress((prev) => ({ ...prev, [ideaId]: false }));
      }, 400);
    }
  };

  const handleSubmitIdea = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    if (!formTitle.trim() || !formDescription.trim()) {
      setSubmitError('Title and description are required.');
      return;
    }
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'club_ideas'), {
        title: formTitle.trim(),
        description: formDescription.trim(),
        category: formCategory,
        customCategory: formCategory === 'Misc' ? formCustomCategory.trim() : '',
        tags: [],
        authorEmail: userEmail || '',
        authorName: memberData?.name || user?.displayName || userEmail?.split('@')[0] || 'Member',
        authorAvatar: user?.photoURL || genAvatar(userEmail || ''),
        authorRegNo: memberData?.registrationNumber || '',
        status: 'pending',
        upvotes: 0,
        upvoterEmails: [],
        upvoteThreshold: DEFAULT_UPVOTE_THRESHOLD,
        comments: [],
        estimatedDate: formDate,
        resourcesNeeded: formResources.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        isFeatured: false,
      });

      // ── Notify Admins about new idea push ──
      const ideaTitleForNotif = formTitle.trim();
      await addNotification(
        'ROLE:admin',
        'new_idea',
        'new_idea',
        ideaTitleForNotif,
        `New Idea Pushed: "${ideaTitleForNotif}" by ${memberData?.name || userEmail?.split('@')[0]}. Needs review!`,
        ''
      );

      setSubmitModalOpen(false);
      setFormTitle('');
      setFormDescription('');
      setFormCategory('Tech & XR');
      setFormCustomCategory('');
      setFormDate('');
      setFormResources('');
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to submit idea.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!selectedIdea || !commentText.trim() || !userEmail) return;
    setSubmittingComment(true);
    try {
      const newComment: IdeaComment = {
        id: `c_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        authorEmail: userEmail,
        authorName: memberData?.name || user?.displayName || userEmail.split('@')[0] || 'Member',
        avatarUrl: user?.photoURL || genAvatar(userEmail),
        text: commentText.trim(),
        createdAt: new Date().toISOString(),
        isCoordinator: canModerate,
        isFaculty: !!isFaculty,
      };
      await updateDoc(doc(db, 'club_ideas', selectedIdea.id), {
        comments: arrayUnion(newComment),
        updatedAt: serverTimestamp(),
      });
      setCommentText('');
      // Notify idea author about new comment (if commenter is not the author)
      if (selectedIdea.authorEmail && selectedIdea.authorEmail.toLowerCase() !== userEmail.toLowerCase()) {
        const commenterName = memberData?.name || user?.displayName || userEmail.split('@')[0] || 'Someone';
        await addNotification(
          selectedIdea.authorEmail,
          'new_comment',
          selectedIdea.id,
          selectedIdea.title,
          `${commenterName} commented on your idea "${selectedIdea.title}": "${commentText.trim().slice(0, 60)}${commentText.trim().length > 60 ? '…' : ''}"`
        );
      }
    } catch (err) {
      console.error('Comment error:', err);
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleModerate = async () => {
    if (!moderateIdea || !moderateAction) return;
    if (!canModerate && !(isFaculty && (moderateAction === 'approve' || moderateAction === 'reject'))) {
      alert('Permission denied. Members cannot modify or delete events.');
      return;
    }
    setSubmittingMod(true);
    try {
      const docRef = doc(db, 'club_ideas', moderateIdea.id);
      const note = moderateNote.trim();
      const authorEmail = moderateIdea.authorEmail;
      const ideaId = moderateIdea.id;
      const ideaTitle = moderateIdea.title;

      if (moderateAction === 'promote') {
        const threshold = Math.max(1, Number(voteThresholdInput) || DEFAULT_UPVOTE_THRESHOLD);
        await updateDoc(docRef, {
          status: 'community',
          upvoteThreshold: threshold,
          coordinatorNote: note || moderateIdea.coordinatorNote || '',
          promotedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        // Notify idea author
        await addNotification(
          authorEmail,
          'promoted',
          ideaId,
          ideaTitle,
          `Your idea "${ideaTitle}" has been approved and published to the Community Board for member voting!`,
          note
        );
        // Notify all members that an idea was promoted to community
        await addNotification(
          'ROLE:member',
          'promoted_broadcast',
          ideaId,
          ideaTitle,
          `New Idea on Community Board: "${ideaTitle}". Check it out and cast your vote!`,
          ''
        );
      } else if (moderateAction === 'faculty') {
        await updateDoc(docRef, {
          status: 'faculty',
          coordinatorNote: note || moderateIdea.coordinatorNote || '',
          updatedAt: serverTimestamp(),
        });
        // Notify idea author that their idea is in faculty review
        await addNotification(
          authorEmail,
          'faculty_review',
          ideaId,
          ideaTitle,
          `Your idea "${ideaTitle}" has been escalated to Faculty Review. The faculty coordinator will be in touch regarding next steps.`,
          note
        );
      } else if (moderateAction === 'approve') {
        await updateDoc(docRef, {
          status: 'approved',
          facultyNote: note || moderateIdea.facultyNote || '',
          updatedAt: serverTimestamp(),
        });
        // Notify idea author of approval
        await addNotification(
          authorEmail,
          'approved',
          ideaId,
          ideaTitle,
          `🎉 Great news! Your idea "${ideaTitle}" has been officially approved by the faculty. Time to make it happen!`,
          note
        );
      } else if (moderateAction === 'reject') {
        await updateDoc(docRef, {
          status: 'rejected',
          coordinatorNote: note || moderateIdea.coordinatorNote || '',
          updatedAt: serverTimestamp(),
        });
        // Notify idea author of rejection with feedback
        await addNotification(
          authorEmail,
          'rejected',
          ideaId,
          ideaTitle,
          `Your idea "${ideaTitle}" was not accepted at this time.${note ? ` Feedback: "${note}"` : ' Check the idea for coordinator feedback.'}`,
          note
        );
      } else if (moderateAction === 'archive') {
        await updateDoc(docRef, {
          status: 'archived',
          coordinatorNote: note || moderateIdea.coordinatorNote || '',
          updatedAt: serverTimestamp(),
        });
      } else if (moderateAction === 'restore') {
        await updateDoc(docRef, {
          status: 'pending',
          coordinatorNote: note || moderateIdea.coordinatorNote || '',
          updatedAt: serverTimestamp(),
        });
        // Notify author that their idea was restored
        await addNotification(
          authorEmail,
          'restored',
          ideaId,
          ideaTitle,
          `Your idea "${ideaTitle}" has been restored to active review by a coordinator.`,
          note
        );
      } else if (moderateAction === 'delete') {
        await deleteDoc(docRef);
        if (selectedIdea?.id === moderateIdea.id) {
          setSelectedIdea(null);
        }
      }

      setModerateIdea(null);
      setModerateAction(null);
      setModerateNote('');
    } catch (err) {
      console.error('Moderation error:', err);
      alert('Failed to complete action: ' + (err as any)?.message);
    } finally {
      setSubmittingMod(false);
    }
  };

  const openModerationModal = (
    idea: ClubIdea,
    action: 'promote' | 'reject' | 'faculty' | 'approve' | 'archive' | 'restore' | 'delete'
  ) => {
    setModerateIdea(idea);
    setModerateAction(action);
    setModerateNote('');
    setVoteThresholdInput(idea.upvoteThreshold || DEFAULT_UPVOTE_THRESHOLD);
  };

  const isAuthor = (idea: ClubIdea) => {
    return !!(userEmail && idea.authorEmail?.toLowerCase() === userEmail.toLowerCase());
  };

  const canManageIdea = (idea: ClubIdea) => {
    return canModerate;
  };

  const isPrivileged = canModerate || isFaculty || isSuperAdmin;

  // Ensure members cannot remain on privileged tabs
  useEffect(() => {
    if (!isPrivileged && activeTab !== 'community' && activeTab !== 'mine') {
      setActiveTab('community');
    }
  }, [isPrivileged, activeTab]);

  const tabs = [
    { id: 'community', label: 'Community Board', icon: 'diversity_3', count: stats.community },
    ...(isAuthorizedUser ? [{ id: 'mine', label: 'My Ideas', icon: 'person', count: stats.mine }] : []),
    ...(canModerate ? [{ id: 'pending', label: 'Pending Review', icon: 'hourglass_top', count: stats.pending }] : []),
    ...((isFaculty || isSuperAdmin) ? [{ id: 'faculty', label: 'Faculty Inbox', icon: 'school', count: stats.faculty }] : []),
    ...(isPrivileged ? [{ id: 'approved', label: 'Approved 🎉', icon: 'check_circle', count: stats.approved }] : []),
    ...(isPrivileged ? [{ id: 'archived', label: 'Archived / Past', icon: 'archive', count: stats.archived }] : []),
  ];

  return (
    <div className="flex-grow w-full max-w-full overflow-x-clip bg-transparent p-3 sm:p-6 md:p-8 pb-12 sm:pb-16 text-left text-white select-none">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* ─── Page Header ─────────────────────────────────────────────────── */}
        <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-[#262626]">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="px-3 py-1 rounded-md text-[10px] font-black bg-purple-900/60 text-purple-300 border border-purple-600 flex items-center gap-1.5 shadow-[0_0_12px_rgba(147,51,234,0.2)]">
                <span className="material-symbols-outlined text-[13px]">lightbulb</span>
                IDEA CURATOR HUB
              </span>
              <span className="text-[10px] sm:text-[11px] text-slate-400 font-mono">EVENT INNOVATION & STATUS PIPELINE</span>
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white tracking-tight">
              Event Ideas & Community Curator
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1 max-w-2xl">
              Propose club events, cast your 1 permanent vote on community ideas, and track each proposal's progress across coordinator triage, community voting, and faculty review.
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            {isAuthorizedUser && (
              <button
                onClick={() => setSubmitModalOpen(true)}
                className="flex items-center gap-2.5 px-5 py-2.5 bg-gradient-to-r from-purple-700 to-fuchsia-700 hover:from-purple-600 hover:to-fuchsia-600 text-white rounded-xl font-bold text-sm transition-all shadow-[0_0_25px_rgba(147,51,234,0.4)] hover:shadow-[0_0_35px_rgba(147,51,234,0.6)] active:scale-95 cursor-pointer shrink-0"
              >
                <span className="material-symbols-outlined text-lg">add_circle</span>
                Submit an Event Idea
              </button>
            )}
          </div>
        </header>

        {/* ─── Stats ───────────────────────────────────────────────────────── */}
        <div className={`grid gap-2.5 ${isPrivileged ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7' : 'grid-cols-1 sm:grid-cols-3'}`}>
          {(isPrivileged ? [
            { label: 'Total Ideas', value: stats.total, icon: 'lightbulb', color: 'text-white' },
            { label: 'Community', value: stats.community, icon: 'diversity_3', color: 'text-emerald-300' },
            { label: 'Pending', value: stats.pending, icon: 'hourglass_top', color: 'text-amber-300' },
            { label: 'Faculty', value: stats.faculty, icon: 'school', color: 'text-blue-300' },
            { label: 'Approved', value: stats.approved, icon: 'check_circle', color: 'text-purple-300' },
            { label: 'Archived', value: stats.archived, icon: 'archive', color: 'text-slate-400' },
            { label: 'Live Votes', value: stats.totalUpvotes, icon: 'thumb_up', color: 'text-pink-300' },
          ] : [
            { label: 'Community Ideas', value: stats.community, icon: 'diversity_3', color: 'text-emerald-300' },
            { label: 'My Proposed Ideas', value: stats.mine, icon: 'person', color: 'text-purple-300' },
            { label: 'Live Community Votes', value: stats.totalUpvotes, icon: 'thumb_up', color: 'text-pink-300' },
          ]).map((s) => (
            <div key={s.label} className="bg-[#141414] border border-[#262626] rounded-xl p-2.5 sm:p-3 text-center">
              <span className={`material-symbols-outlined text-sm sm:text-base block mb-1 ${s.color}`}>{s.icon}</span>
              <div className={`text-base sm:text-lg font-black ${s.color}`}>{s.value}</div>
              <div className="text-[8px] sm:text-[9px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ─── Tabs ────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-purple-900/60 text-purple-200 border-purple-600 shadow-[0_0_15px_rgba(147,51,234,0.2)]'
                  : 'bg-[#1a1a1a] text-slate-400 border-[#333333] hover:border-purple-700/50 hover:text-slate-200'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">{tab.icon}</span>
              {tab.label}
              {(tab.count ?? 0) > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black ${activeTab === tab.id ? 'bg-purple-600 text-white' : 'bg-[#333] text-slate-400'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ─── Filters & Search ────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 flex-1 min-w-0">
            {(['All', ...CATEGORIES.map((c) => c.id)] as (IdeaCategory | 'All')[]).map((cat) => {
              const config = cat === 'All'
                ? { icon: 'grid_view', color: 'text-purple-300', bg: 'bg-purple-950/40', border: 'border-purple-700/50' }
                : getCategoryConfig(cat as IdeaCategory);
              const isActive = activeCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer whitespace-nowrap ${
                    isActive
                      ? `${config.bg} ${config.color} ${config.border} scale-105`
                      : 'bg-[#1a1a1a] text-slate-400 border-[#333333] hover:border-[#555] hover:text-slate-200'
                  }`}
                >
                  <span className="material-symbols-outlined text-[13px]">{config.icon}</span>
                  {cat}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-base">search</span>
              <input
                type="text"
                placeholder="Search ideas..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 w-36 sm:w-44"
              />
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-xl text-xs text-white focus:outline-none focus:border-purple-500 cursor-pointer"
            >
              <option value="newest">Newest</option>
              <option value="upvotes">Most Upvoted</option>
              <option value="comments">Most Discussed</option>
            </select>
          </div>
        </div>

        {/* ─── Informational Tabs Banner ───────────────────────────────────── */}
        {activeTab === 'community' && (
          <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-800/40 flex items-start gap-3 text-xs text-emerald-200">
            <span className="material-symbols-outlined text-emerald-400 text-lg shrink-0 mt-0.5">diversity_3</span>
            <p>
              <strong>Community Board</strong> — Verified ideas open for member voting. Each member gets <strong>1 permanent vote</strong> per idea. Coordinators review live voting results to decide on faculty escalation.
            </p>
          </div>
        )}
        {activeTab === 'pending' && canModerate && (
          <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/40 flex items-start gap-3 text-xs text-amber-200">
            <span className="material-symbols-outlined text-amber-400 text-lg shrink-0 mt-0.5">hourglass_top</span>
            <p>
              <strong>Coordinator Triage Queue</strong> — Review submitted proposals in Stage 1. Promote to Community Board, fast-track to Faculty Review, or reject with feedback.
            </p>
          </div>
        )}
        {activeTab === 'faculty' && (
          <div className="p-3.5 rounded-xl bg-blue-950/30 border border-blue-800/40 flex items-start gap-3 text-xs text-blue-200">
            <span className="material-symbols-outlined text-blue-400 text-lg shrink-0 mt-0.5">school</span>
            <p>
              <strong>Faculty Review Desk</strong> — Stage 3 proposals awaiting faculty mentors' official sanction and guidance notes.
            </p>
          </div>
        )}
        {activeTab === 'archived' && (
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-700/60 flex items-start gap-3 text-xs text-slate-300">
            <span className="material-symbols-outlined text-slate-400 text-lg shrink-0 mt-0.5">archive</span>
            <p>
              <strong>Archived & Past Ideas Repository</strong> — Storing all rejected, completed, and archived event proposals for club history and records.
            </p>
          </div>
        )}

        {/* ─── Ideas Grid ──────────────────────────────────────────────────── */}
        {loading ? (
          <div className="py-20 flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
            <span className="text-xs text-purple-300 font-mono tracking-widest uppercase">Loading Ideas…</span>
          </div>
        ) : filteredIdeas.length === 0 ? (
          <div className="bg-[#141414] border border-[#262626] rounded-2xl p-14 text-center space-y-4">
            <span className="material-symbols-outlined text-5xl text-slate-600">lightbulb</span>
            <h3 className="text-lg font-bold text-white">
              {activeTab === 'community' ? 'No ideas on the Community Board yet' :
               activeTab === 'mine' ? "You haven't submitted any ideas yet" :
               activeTab === 'pending' ? 'No ideas pending review' :
               activeTab === 'faculty' ? 'Nothing in faculty review queue' :
               activeTab === 'archived' ? 'No archived proposals found' :
               'No approved ideas yet'}
            </h3>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              {isAuthorizedUser ? 'Have an exciting concept? Click below to submit an event proposal!' : 'Sign in to contribute ideas.'}
            </p>
            {isAuthorizedUser && (
              <button
                onClick={() => setSubmitModalOpen(true)}
                className="mt-2 px-5 py-2 bg-purple-700 hover:bg-purple-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Submit Your First Idea
              </button>
            )}
          </div>
        ) : (
          <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {filteredIdeas.map((idea) => {
                const catConfig = getCategoryConfig(idea.category);
                const sc = STATUS_CONFIG[idea.status] || STATUS_CONFIG.pending;
                const hasUpvoted = idea.upvoterEmails?.includes(userEmail || '');
                const isVoting = votingInProgress[idea.id];
                const threshold = idea.upvoteThreshold || DEFAULT_UPVOTE_THRESHOLD;
                const displayCategoryName = idea.category === 'Misc' && idea.customCategory
                  ? idea.customCategory
                  : idea.category;

                const currentStageNum = sc.stage;

                return (
                  <motion.div
                    key={idea.id}
                    layout
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={`group relative bg-[#141414] border rounded-2xl p-5 flex flex-col gap-3.5 cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_0_25px_rgba(147,51,234,0.12)] ${
                      idea.isFeatured ? 'border-purple-500/60' : 'border-[#262626] hover:border-purple-600/40'
                    }`}
                    onClick={() => setSelectedIdea(idea)}
                  >
                    {idea.isFeatured && (
                      <div className="absolute top-3 right-3">
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-purple-600 text-white uppercase tracking-wider flex items-center gap-1">
                          <span className="material-symbols-outlined text-[10px]">star</span>Featured
                        </span>
                      </div>
                    )}

                    {/* Author & Category Badge */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img
                          src={idea.authorAvatar || genAvatar(idea.authorEmail)}
                          alt={idea.authorName}
                          className="w-8 h-8 rounded-lg object-cover border border-purple-500/30 bg-purple-950 shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">{idea.authorName}</p>
                          <p className="text-[10px] text-slate-500 font-mono truncate">{idea.authorRegNo || idea.authorEmail?.split('@')[0]}</p>
                        </div>
                      </div>
                      <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border shrink-0 ${catConfig.bg} ${catConfig.color} ${catConfig.border}`}>
                        <span className="material-symbols-outlined text-[11px]">{catConfig.icon}</span>
                        {displayCategoryName}
                      </span>
                    </div>

                    {/* Title & Description */}
                    <div>
                      <h3 className="text-sm font-black text-white leading-snug mb-1 line-clamp-2">{idea.title}</h3>
                      <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">{idea.description}</p>
                    </div>

                    {/* Preferred Date info if set */}
                    {idea.estimatedDate && (
                      <div className="flex items-center gap-1.5 text-[10px] text-purple-300/80 bg-purple-950/20 px-2.5 py-1 rounded-lg border border-purple-900/30 w-fit">
                        <span className="material-symbols-outlined text-[12px]">event</span>
                        <span>Preferred: {idea.estimatedDate}</span>
                      </div>
                    )}

                    {/* Pipeline Stage Tracker Indicator for Admin/Coordinator/SuperAdmin & Author */}
                    {(canModerate || isAuthor(idea)) && (
                      <div className="bg-[#181818] border border-[#2b2b2b] rounded-xl p-2 text-[10px] space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400 font-bold uppercase tracking-wider text-[9px] flex items-center gap-1">
                            <span className="material-symbols-outlined text-[11px] text-purple-400">timeline</span>
                            Status Pipeline
                          </span>
                          <span className={`font-bold ${sc.color}`}>
                            {currentStageNum > 0 ? `Stage ${currentStageNum}/4: ${sc.label}` : sc.label}
                          </span>
                        </div>
                        {currentStageNum > 0 && (
                          <div className="grid grid-cols-4 gap-1 pt-0.5">
                            {PIPELINE_STAGES.map((stg) => {
                              const isCompleted = currentStageNum > stg.stage;
                              const isCurrent = currentStageNum === stg.stage;
                              return (
                                <div
                                  key={stg.id}
                                  title={`${stg.label} (${stg.desc})`}
                                  className={`h-1.5 rounded-full transition-all ${
                                    isCurrent
                                      ? 'bg-gradient-to-r from-purple-500 to-fuchsia-500 shadow-[0_0_8px_rgba(168,85,247,0.6)]'
                                      : isCompleted
                                      ? 'bg-emerald-500'
                                      : 'bg-[#2a2a2a]'
                                  }`}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Progress Bar for Community Tab */}
                    {idea.status === 'community' && (
                      <div className="space-y-1 pt-1" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span>{idea.upvotes >= threshold ? 'Target Reached 🎉' : 'Community Vote Goal'}</span>
                          <span className="font-mono text-purple-300 font-bold">{idea.upvotes}/{threshold}</span>
                        </div>
                        <div className="w-full bg-[#202020] rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-purple-600 to-fuchsia-500 h-1.5 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, ((idea.upvotes || 0) / threshold) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Footer / Actions */}
                    <div className="flex items-center justify-between pt-2.5 border-t border-[#222222] mt-auto">
                      <span className={`flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border ${sc.color} ${sc.bg} ${sc.border}`}>
                        <span className="material-symbols-outlined text-[11px]">{sc.icon}</span>
                        {sc.label}
                      </span>

                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <span className="flex items-center gap-0.5 text-[11px] text-slate-500 mr-1">
                          <span className="material-symbols-outlined text-[13px]">chat_bubble</span>
                          {idea.comments?.length || 0}
                        </span>

                        {/* 1-Vote Button with Confirm Modal on Community Board */}
                        {(idea.status === 'community' || idea.status === 'faculty') && (
                          hasUpvoted ? (
                            <div
                              title="You have cast your 1 official vote for this proposal."
                              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-950/70 text-emerald-300 border border-emerald-600/60 shadow-[0_0_8px_rgba(16,185,129,0.2)]"
                            >
                              <span className="material-symbols-outlined text-[13px]">check_circle</span>
                              <span>Voted ({idea.upvotes || 0})</span>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleInitiateVote(idea)}
                              disabled={isVoting}
                              title="Click to cast your vote for this event"
                              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all cursor-pointer bg-[#1e1e1e] text-slate-300 border-[#333] hover:border-purple-600/60 hover:text-purple-300 active:scale-95 ${
                                isVoting ? 'opacity-60 cursor-wait' : ''
                              }`}
                            >
                              <span className="material-symbols-outlined text-[13px]">thumb_up</span>
                              <span>Vote ({idea.upvotes || 0})</span>
                            </button>
                          )
                        )}

                        {/* Coordinator Actions in Pending */}
                        {canModerate && idea.status === 'pending' && (
                          <>
                            <button
                              onClick={() => openModerationModal(idea, 'promote')}
                              title="Promote to Community Board"
                              className="p-1.5 rounded-lg bg-emerald-950/70 border border-emerald-700/50 text-emerald-300 hover:bg-emerald-900 cursor-pointer transition-colors"
                            >
                              <span className="material-symbols-outlined text-[14px]">rocket_launch</span>
                            </button>
                            <button
                              onClick={() => openModerationModal(idea, 'faculty')}
                              title="Fast-Track to Faculty Review"
                              className="p-1.5 rounded-lg bg-blue-950/70 border border-blue-700/50 text-blue-300 hover:bg-blue-900 cursor-pointer transition-colors"
                            >
                              <span className="material-symbols-outlined text-[14px]">school</span>
                            </button>
                            <button
                              onClick={() => openModerationModal(idea, 'reject')}
                              title="Reject"
                              className="p-1.5 rounded-lg bg-rose-950/70 border border-rose-700/50 text-rose-300 hover:bg-rose-900 cursor-pointer transition-colors"
                            >
                              <span className="material-symbols-outlined text-[14px]">close</span>
                            </button>
                          </>
                        )}

                        {/* Coordinator Action in Community (Send to Faculty Review) */}
                        {canModerate && idea.status === 'community' && (
                          <button
                            onClick={() => openModerationModal(idea, 'faculty')}
                            title="Send to Faculty Review"
                            className="p-1.5 rounded-lg bg-blue-950/70 border border-blue-700/50 text-blue-300 hover:bg-blue-900 cursor-pointer transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">send</span>
                          </button>
                        )}

                        {/* Faculty Action in Faculty Review Queue */}
                        {(isFaculty || isSuperAdmin) && idea.status === 'faculty' && (
                          <>
                            <button
                              onClick={() => openModerationModal(idea, 'approve')}
                              title="Approve Idea"
                              className="p-1.5 rounded-lg bg-purple-950/70 border border-purple-600/50 text-purple-300 hover:bg-purple-900 cursor-pointer transition-colors"
                            >
                              <span className="material-symbols-outlined text-[14px]">verified</span>
                            </button>
                            <button
                              onClick={() => openModerationModal(idea, 'reject')}
                              title="Reject with Note"
                              className="p-1.5 rounded-lg bg-rose-950/70 border border-rose-700/50 text-rose-300 hover:bg-rose-900 cursor-pointer transition-colors"
                            >
                              <span className="material-symbols-outlined text-[14px]">close</span>
                            </button>
                          </>
                        )}

                        {/* Archive / Restore actions */}
                        {(idea.status === 'archived' || idea.status === 'rejected') && canModerate && (
                          <button
                            onClick={() => openModerationModal(idea, 'restore')}
                            title="Restore to Review"
                            className="p-1.5 rounded-lg bg-emerald-950/70 border border-emerald-700/50 text-emerald-300 hover:bg-emerald-900 cursor-pointer transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">restore_from_trash</span>
                          </button>
                        )}

                        {/* Delete / Archive button for coordinators & admins ONLY */}
                        {canModerate && idea.status !== 'archived' && (
                          <button
                            onClick={() => openModerationModal(idea, 'archive')}
                            title="Archive / Delete"
                            className="p-1.5 rounded-lg bg-[#222222] border border-[#333333] text-slate-400 hover:text-rose-300 hover:border-rose-700/50 hover:bg-rose-950/30 cursor-pointer transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* ═══ 1-VOTE CONFIRMATION POPUP MODAL ══════════════════════════════════ */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {voteConfirmIdea && (
            <motion.div
              key="vote-confirm-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
              onClick={(e) => { if (e.target === e.currentTarget && !submittingVote) setVoteConfirmIdea(null); }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.94, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94, y: 20 }}
                transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
                className="w-full max-w-md bg-[#131313] border border-purple-500/70 rounded-2xl p-6 shadow-[0_0_50px_rgba(147,51,234,0.4)]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="w-12 h-12 rounded-2xl bg-purple-900/40 border border-purple-500/50 flex items-center justify-center text-purple-300 mb-4 shadow-[0_0_15px_rgba(147,51,234,0.3)]">
                  <span className="material-symbols-outlined text-2xl">thumb_up</span>
                </div>

                <h3 className="text-lg font-black text-white mb-1">Confirm Your Vote</h3>
                <p className="text-xs text-purple-300 font-bold mb-2">"{voteConfirmIdea.title}"</p>

                <div className="p-3.5 bg-[#1a1a1a] rounded-xl border border-[#2d2d2d] text-xs text-slate-300 space-y-2 mb-5">
                  <p className="flex items-start gap-2">
                    <span className="material-symbols-outlined text-amber-400 text-sm shrink-0 mt-0.5">verified_user</span>
                    <span><strong>1 Vote Policy:</strong> Each verified club member can vote only once for this event proposal.</span>
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Your vote will be recorded permanently in the community tally and cannot be undone.
                  </p>
                </div>

                <div className="flex gap-2.5 justify-end">
                  <button
                    type="button"
                    disabled={submittingVote}
                    onClick={() => setVoteConfirmIdea(null)}
                    className="px-4 py-2 rounded-xl bg-[#222222] border border-[#333333] text-slate-300 text-xs font-bold hover:border-[#555] cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={submittingVote}
                    onClick={handleConfirmVote}
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-700 to-fuchsia-700 hover:from-purple-600 hover:to-fuchsia-600 disabled:opacity-60 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5 transition-all shadow-[0_0_20px_rgba(147,51,234,0.4)]"
                  >
                    {submittingVote ? (
                      <div className="w-3.5 h-3.5 border border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <span className="material-symbols-outlined text-base">how_to_vote</span>
                    )}
                    {submittingVote ? 'Recording Vote…' : 'Confirm Vote'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ═══ SUBMIT IDEA MODAL ═══════════════════════════════════════════════ */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {submitModalOpen && (
            <motion.div
              key="submit-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[120] flex items-center justify-center p-2 sm:p-4 bg-black/90 backdrop-blur-md"
              onClick={(e) => { if (e.target === e.currentTarget) setSubmitModalOpen(false); }}
            >
              <motion.div
                initial={{ opacity: 0, y: 30, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.96 }}
                transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
                className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-[#121212] border border-purple-600 rounded-2xl shadow-[0_0_50px_rgba(147,51,234,0.35)] overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-4 sm:p-5 bg-[#181818] border-b border-[#262626] flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-900/40 border border-purple-500/40 flex items-center justify-center text-purple-300">
                      <span className="material-symbols-outlined text-2xl">lightbulb</span>
                    </div>
                    <div>
                      <h3 className="text-base font-black text-white">Submit an Event Idea</h3>
                      <p className="text-xs text-slate-400 mt-0.5">Share your proposal directly with coordinators & faculty</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSubmitModalOpen(false)}
                    className="text-slate-400 hover:text-white transition-colors cursor-pointer p-1 rounded-lg hover:bg-[#252525]"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-[#0e0e0e]">
                  {submitError && (
                    <div className="p-3 bg-rose-950/70 border border-rose-600/70 rounded-xl text-rose-200 text-xs font-medium flex items-center gap-2">
                      <span className="material-symbols-outlined text-rose-400 text-base">error</span>
                      {submitError}
                    </div>
                  )}

                  <form id="idea-form" onSubmit={handleSubmitIdea} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-purple-300 mb-1.5 uppercase tracking-wider">
                        Event Title <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={120}
                        value={formTitle}
                        onChange={(e) => setFormTitle(e.target.value)}
                        placeholder="e.g. VR Game Jam 2026 / XR Hands-on Bootcamp..."
                        className="w-full px-4 py-2.5 bg-[#1c1c1c] border border-[#333333] rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-purple-300 mb-1.5 uppercase tracking-wider">
                        Event Category
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {CATEGORIES.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setFormCategory(c.id)}
                            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold border cursor-pointer transition-all ${
                              formCategory === c.id
                                ? `${c.bg} ${c.color} ${c.border} scale-105 shadow-[0_0_10px_rgba(147,51,234,0.2)]`
                                : 'bg-[#1a1a1a] text-slate-400 border-[#333333] hover:border-[#555]'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[13px]">{c.icon}</span>
                            {c.id}
                          </button>
                        ))}
                      </div>

                      {/* Manual custom category input when Misc is selected */}
                      {formCategory === 'Misc' && (
                        <motion.div
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mt-2.5"
                        >
                          <label className="block text-[11px] font-bold text-slate-400 mb-1">
                            Specify Custom Category Name (Optional)
                          </label>
                          <input
                            type="text"
                            maxLength={40}
                            value={formCustomCategory}
                            onChange={(e) => setFormCustomCategory(e.target.value)}
                            placeholder="e.g. AR Art Showcase, Robotics XR, AI Gaming..."
                            className="w-full px-3 py-2 bg-[#1c1c1c] border border-purple-500/50 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-400"
                          />
                        </motion.div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-purple-300 mb-1.5 uppercase tracking-wider">
                        Event Description & Pitch <span className="text-rose-400">*</span>
                      </label>
                      <textarea
                        required
                        rows={5}
                        maxLength={2000}
                        value={formDescription}
                        onChange={(e) => setFormDescription(e.target.value)}
                        placeholder="Explain the concept: format, schedule, hardware/software involved, what members will learn, and why VRGC should host it..."
                        className="w-full px-4 py-2.5 bg-[#1c1c1c] border border-[#333333] rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none"
                      />
                      <p className="text-[10px] text-slate-600 text-right mt-0.5">{formDescription.length}/2000</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wider">
                          Preferred / Estimated Date
                        </label>
                        <input
                          type="date"
                          value={formDate}
                          onChange={(e) => setFormDate(e.target.value)}
                          className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-xl text-xs text-white focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wider">
                          Resources Needed (Optional)
                        </label>
                        <input
                          type="text"
                          value={formResources}
                          onChange={(e) => setFormResources(e.target.value)}
                          placeholder="e.g. Meta Quest 3, Lab 402, Projector..."
                          className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>
                  </form>
                </div>

                <div className="p-4 sm:p-5 bg-[#141414] border-t border-[#262626] flex items-center justify-between gap-3 shrink-0">
                  <p className="text-[11px] text-slate-500">Coordinators will review your pitch before publishing to the Community Board.</p>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSubmitModalOpen(false)}
                      className="px-4 py-2 rounded-xl bg-[#222222] border border-[#333333] text-slate-300 text-xs font-bold hover:border-[#555] cursor-pointer transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmitIdea}
                      disabled={submitting}
                      className="px-5 py-2 rounded-xl bg-purple-700 hover:bg-purple-600 disabled:opacity-60 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5 transition-all shadow-[0_0_15px_rgba(147,51,234,0.4)]"
                    >
                      {submitting ? (
                        <div className="w-3.5 h-3.5 border border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <span className="material-symbols-outlined text-base">send</span>
                      )}
                      {submitting ? 'Submitting…' : 'Submit Idea'}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ═══ IDEA DETAIL MODAL ═══════════════════════════════════════════════ */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {selectedIdea && (
            <motion.div
              key="detail-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[120] flex items-center justify-center p-2 sm:p-4 bg-black/90 backdrop-blur-md"
              onClick={(e) => { if (e.target === e.currentTarget) setSelectedIdea(null); }}
            >
              <motion.div
                initial={{ opacity: 0, y: 30, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.96 }}
                transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
                className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-[#121212] border border-purple-600 rounded-2xl shadow-[0_0_50px_rgba(147,51,234,0.35)] overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="p-4 sm:p-5 bg-[#181818] border-b border-[#262626] flex items-center justify-between gap-4 shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={selectedIdea.authorAvatar || genAvatar(selectedIdea.authorEmail)}
                      alt={selectedIdea.authorName}
                      className="w-9 h-9 rounded-lg object-cover border border-purple-500/30 bg-purple-950 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">{selectedIdea.authorName}</p>
                      <p className="text-[10px] text-slate-500">{timeAgo(selectedIdea.createdAt)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const sc = STATUS_CONFIG[selectedIdea.status] || STATUS_CONFIG.pending;
                      return (
                        <span className={`flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border ${sc.color} ${sc.bg} ${sc.border}`}>
                          <span className="material-symbols-outlined text-[12px]">{sc.icon}</span>
                          {sc.label}
                        </span>
                      );
                    })()}
                    <button
                      onClick={() => setSelectedIdea(null)}
                      className="text-slate-400 hover:text-white cursor-pointer p-1 rounded-lg hover:bg-[#252525] transition-colors"
                    >
                      <span className="material-symbols-outlined">close</span>
                    </button>
                  </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
                  
                  {/* Pipeline Lifecycle Stepper (Admin, Coordinator & Faculty view) */}
                  {(() => {
                    const currentStageNum = STATUS_CONFIG[selectedIdea.status]?.stage ?? 1;
                    return (
                      <div className="bg-[#171717] border border-[#2b2b2b] rounded-2xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-sm text-purple-400">timeline</span>
                            Event Lifecycle Pipeline
                          </span>
                          <span className="text-[11px] font-bold font-mono text-purple-300 bg-purple-950/60 px-2.5 py-0.5 rounded-full border border-purple-700/50">
                            {currentStageNum > 0 ? `Stage ${currentStageNum} of 4` : STATUS_CONFIG[selectedIdea.status]?.label}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                          {PIPELINE_STAGES.map((stg) => {
                            const isCompleted = currentStageNum > stg.stage;
                            const isCurrent = currentStageNum === stg.stage;
                            return (
                              <div
                                key={stg.id}
                                className={`p-2.5 rounded-xl border transition-all flex flex-col gap-1 ${
                                  isCurrent
                                    ? 'bg-purple-950/50 border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.25)] ring-1 ring-purple-500/50'
                                    : isCompleted
                                    ? 'bg-emerald-950/30 border-emerald-700/40 text-emerald-300'
                                    : 'bg-[#1e1e1e] border-[#2c2c2c] text-slate-500 opacity-70'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="material-symbols-outlined text-sm">
                                    {isCompleted ? 'check_circle' : stg.icon}
                                  </span>
                                  <span className="text-[9px] font-bold font-mono uppercase">
                                    {isCompleted ? 'Done' : isCurrent ? 'Active' : 'Pending'}
                                  </span>
                                </div>
                                <span className="text-xs font-bold text-white truncate">{stg.label}</span>
                                <span className="text-[9px] text-slate-400 line-clamp-1">{stg.desc}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {(() => {
                    const cc = getCategoryConfig(selectedIdea.category);
                    const catTitle = selectedIdea.category === 'Misc' && selectedIdea.customCategory
                      ? selectedIdea.customCategory
                      : selectedIdea.category;
                    return (
                      <div>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border mb-2 ${cc.bg} ${cc.color} ${cc.border}`}>
                          <span className="material-symbols-outlined text-[12px]">{cc.icon}</span>
                          {catTitle}
                        </span>
                        <h2 className="text-xl font-black text-white">{selectedIdea.title}</h2>
                      </div>
                    );
                  })()}

                  <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{selectedIdea.description}</p>

                  {(selectedIdea.estimatedDate || selectedIdea.resourcesNeeded) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-[#181818] rounded-xl border border-[#262626] text-xs">
                      {selectedIdea.estimatedDate && (
                        <div>
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-0.5">Preferred Date</span>
                          <span className="text-slate-200">{selectedIdea.estimatedDate}</span>
                        </div>
                      )}
                      {selectedIdea.resourcesNeeded && (
                        <div>
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-0.5">Resources Needed</span>
                          <span className="text-slate-200">{selectedIdea.resourcesNeeded}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {selectedIdea.coordinatorNote && (
                    <div className="p-3 bg-amber-950/30 border border-amber-700/40 rounded-xl">
                      <p className="text-[10px] font-black text-amber-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[13px]">gavel</span>Coordinator Feedback / Note
                      </p>
                      <p className="text-xs text-amber-200">{selectedIdea.coordinatorNote}</p>
                    </div>
                  )}

                  {selectedIdea.facultyNote && (
                    <div className="p-3 bg-blue-950/30 border border-blue-700/40 rounded-xl">
                      <p className="text-[10px] font-black text-blue-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[13px]">school</span>Faculty Review Note
                      </p>
                      <p className="text-xs text-blue-200">{selectedIdea.facultyNote}</p>
                    </div>
                  )}

                  {/* Live Voting Section */}
                  {(selectedIdea.status === 'community' || selectedIdea.status === 'faculty') && (
                    <div className="flex items-center gap-4 p-3.5 bg-[#181818] rounded-xl border border-[#262626]">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-purple-400 text-xl">thumb_up</span>
                        <span className="text-2xl font-black text-white">{selectedIdea.upvotes}</span>
                        <span className="text-xs text-slate-400">Total Votes</span>
                      </div>

                      {selectedIdea.status === 'community' && (
                        <div className="flex-1">
                          <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                            <span>{selectedIdea.upvotes >= (selectedIdea.upvoteThreshold || DEFAULT_UPVOTE_THRESHOLD) ? 'Target Reached 🎉' : 'Community Vote Goal'}</span>
                            <span className="font-mono text-purple-300 font-bold">
                              {selectedIdea.upvotes}/{selectedIdea.upvoteThreshold || DEFAULT_UPVOTE_THRESHOLD}
                            </span>
                          </div>
                          <div className="w-full bg-[#2a2a2a] rounded-full h-1.5">
                            <div
                              className="bg-gradient-to-r from-purple-600 to-fuchsia-600 h-1.5 rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.min(100, ((selectedIdea.upvotes || 0) / (selectedIdea.upvoteThreshold || DEFAULT_UPVOTE_THRESHOLD)) * 100)}%`
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {selectedIdea.upvoterEmails?.includes(userEmail || '') ? (
                        <div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold bg-emerald-950/70 text-emerald-300 border border-emerald-600/60 shadow-[0_0_8px_rgba(16,185,129,0.2)]">
                          <span className="material-symbols-outlined text-[14px]">check_circle</span>
                          <span>Voted</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleInitiateVote(selectedIdea)}
                          disabled={votingInProgress[selectedIdea.id]}
                          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer bg-[#1e1e1e] text-slate-300 border-[#333333] hover:border-purple-600/60 hover:text-purple-300 active:scale-95 ${
                            votingInProgress[selectedIdea.id] ? 'opacity-60 cursor-wait' : ''
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">thumb_up</span>
                          Vote
                        </button>
                      )}
                    </div>
                  )}

                  {/* Comments */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm">chat_bubble</span>
                      Discussion Thread ({selectedIdea.comments?.length || 0})
                    </h4>
                    <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
                      {(selectedIdea.comments || []).map((c) => (
                        <div key={c.id} className="flex items-start gap-2">
                          <img
                            src={c.avatarUrl || genAvatar(c.authorEmail)}
                            alt={c.authorName}
                            className="w-7 h-7 rounded-lg object-cover border border-purple-500/20 bg-purple-950 shrink-0 mt-0.5"
                          />
                          <div className="flex-1 bg-[#1a1a1a] rounded-xl p-2.5 border border-[#2a2a2a]">
                            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                              <span className="text-[11px] font-bold text-white">{c.authorName}</span>
                              {c.isCoordinator && (
                                <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-emerald-900/50 text-emerald-300 border border-emerald-700/40">
                                  COORDINATOR
                                </span>
                              )}
                              {c.isFaculty && (
                                <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-blue-900/50 text-blue-300 border border-blue-700/40">
                                  FACULTY
                                </span>
                              )}
                              <span className="text-[10px] text-slate-600 ml-auto">{timeAgo(c.createdAt)}</span>
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed">{c.text}</p>
                          </div>
                        </div>
                      ))}
                      {!selectedIdea.comments?.length && (
                        <p className="text-xs text-slate-600 text-center py-3">No comments yet. Start the conversation!</p>
                      )}
                    </div>
                    {isAuthorizedUser && (
                      <div className="flex items-start gap-2">
                        <img
                          src={user?.photoURL || genAvatar(userEmail || '')}
                          alt="You"
                          className="w-7 h-7 rounded-lg object-cover border border-purple-500/20 bg-purple-950 shrink-0 mt-1"
                        />
                        <div className="flex-1 flex gap-2">
                          <textarea
                            rows={2}
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            placeholder="Add your thoughts, suggestions, or logistics help..."
                            className="flex-1 px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none"
                          />
                          <button
                            onClick={handleSubmitComment}
                            disabled={!commentText.trim() || submittingComment}
                            className="px-3.5 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white rounded-xl cursor-pointer transition-colors self-start"
                          >
                            {submittingComment ? (
                              <div className="w-4 h-4 border border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                              <span className="material-symbols-outlined text-base">send</span>
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Controls & Management */}
                <div className="p-4 bg-[#141414] border-t border-[#262626] flex items-center justify-between gap-2 flex-wrap shrink-0">
                  <div className="flex items-center gap-2">
                    {canManageIdea(selectedIdea) && (
                      <button
                        onClick={() => openModerationModal(selectedIdea, 'archive')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#222222] border border-[#333333] text-slate-400 hover:text-rose-300 hover:border-rose-700/50 hover:bg-rose-950/30 rounded-lg text-xs font-bold cursor-pointer transition-colors"
                      >
                        <span className="material-symbols-outlined text-[13px]">archive</span>
                        Archive Idea
                      </button>
                    )}
                    {canModerate && (
                      <button
                        onClick={() => openModerationModal(selectedIdea, 'delete')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/30 border border-rose-700/40 text-rose-300 hover:bg-rose-900 rounded-lg text-xs font-bold cursor-pointer transition-colors"
                      >
                        <span className="material-symbols-outlined text-[13px]">delete_forever</span>
                        Delete Permanently
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {canModerate && selectedIdea.status === 'pending' && (
                      <>
                        <button
                          onClick={() => openModerationModal(selectedIdea, 'promote')}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-950/70 border border-emerald-700/50 text-emerald-300 rounded-lg text-xs font-bold hover:bg-emerald-900 cursor-pointer transition-colors"
                        >
                          <span className="material-symbols-outlined text-[13px]">rocket_launch</span>Promote to Community
                        </button>
                        <button
                          onClick={() => openModerationModal(selectedIdea, 'faculty')}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-950/70 border border-blue-700/50 text-blue-300 rounded-lg text-xs font-bold hover:bg-blue-900 cursor-pointer transition-colors"
                        >
                          <span className="material-symbols-outlined text-[13px]">school</span>Send to Faculty
                        </button>
                        <button
                          onClick={() => openModerationModal(selectedIdea, 'reject')}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/70 border border-rose-700/50 text-rose-300 rounded-lg text-xs font-bold hover:bg-rose-900 cursor-pointer transition-colors"
                        >
                          <span className="material-symbols-outlined text-[13px]">close</span>Reject
                        </button>
                      </>
                    )}

                    {canModerate && selectedIdea.status === 'community' && (
                      <button
                        onClick={() => openModerationModal(selectedIdea, 'faculty')}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-950/70 border border-blue-700/50 text-blue-300 rounded-lg text-xs font-bold hover:bg-blue-900 cursor-pointer transition-colors"
                      >
                        <span className="material-symbols-outlined text-[13px]">school</span>Escalate to Faculty Review
                      </button>
                    )}

                    {(isFaculty || isSuperAdmin) && selectedIdea.status === 'faculty' && (
                      <>
                        <button
                          onClick={() => openModerationModal(selectedIdea, 'approve')}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 bg-purple-950/70 border border-purple-600/50 text-purple-300 rounded-lg text-xs font-bold hover:bg-purple-900 cursor-pointer transition-colors"
                        >
                          <span className="material-symbols-outlined text-[13px]">verified</span>Approve Proposal 🎉
                        </button>
                        <button
                          onClick={() => openModerationModal(selectedIdea, 'reject')}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-950/70 border border-rose-700/50 text-rose-300 rounded-lg text-xs font-bold hover:bg-rose-900 cursor-pointer transition-colors"
                        >
                          <span className="material-symbols-outlined text-[13px]">close</span>Reject with Note
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ═══ MODERATION / ACTION CONFIRM MODAL ════════════════════════════════ */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {moderateIdea && moderateAction && (
            <motion.div
              key="moderate-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
              onClick={(e) => { if (e.target === e.currentTarget) { setModerateIdea(null); setModerateAction(null); } }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
                className="w-full max-w-md bg-[#141414] border border-purple-600/60 rounded-2xl p-6 shadow-[0_0_40px_rgba(147,51,234,0.3)]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 border ${
                  moderateAction === 'promote' ? 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300' :
                  moderateAction === 'reject' || moderateAction === 'delete' ? 'bg-rose-900/40 border-rose-700/50 text-rose-300' :
                  moderateAction === 'faculty' ? 'bg-blue-900/40 border-blue-700/50 text-blue-300' :
                  moderateAction === 'archive' ? 'bg-slate-900/50 border-slate-700 text-slate-300' :
                  'bg-purple-900/40 border-purple-600/50 text-purple-300'
                }`}>
                  <span className="material-symbols-outlined text-2xl">
                    {moderateAction === 'promote' ? 'rocket_launch' :
                     moderateAction === 'reject' ? 'close' :
                     moderateAction === 'faculty' ? 'school' :
                     moderateAction === 'archive' ? 'archive' :
                     moderateAction === 'delete' ? 'delete_forever' :
                     moderateAction === 'restore' ? 'restore_from_trash' :
                     'verified'}
                  </span>
                </div>

                <h3 className="text-base font-black text-white mb-1">
                  {moderateAction === 'promote' ? 'Promote to Community Board' :
                   moderateAction === 'reject' ? 'Reject Proposal' :
                   moderateAction === 'faculty' ? 'Send to Faculty Review' :
                   moderateAction === 'approve' ? 'Approve Proposal for Planning' :
                   moderateAction === 'archive' ? 'Archive Event Proposal' :
                   moderateAction === 'restore' ? 'Restore Proposal' :
                   'Delete Proposal Permanently'}
                </h3>
                <p className="text-xs text-purple-300 font-bold mb-1">"{moderateIdea.title}"</p>
                <p className="text-xs text-slate-400 mb-4">
                  {moderateAction === 'promote' ? 'Publish this idea to the Community Board for member voting and discussions.' :
                   moderateAction === 'reject' ? 'This idea will be marked as rejected and moved to the archive with your feedback.' :
                   moderateAction === 'faculty' ? 'Escalate this proposal to Faculty inbox for sanctioning.' :
                   moderateAction === 'approve' ? 'Officially sanction this event idea in the Curator Hub.' :
                   moderateAction === 'archive' ? 'This event will be moved to the Archived repository for record-keeping.' :
                   moderateAction === 'restore' ? 'This idea will be moved back to active review.' :
                   'This will permanently delete the event proposal from the database.'}
                </p>

                {/* Upvote Threshold Setting for Coordinators promoting to community */}
                {moderateAction === 'promote' && (
                  <div className="mb-4 p-3 bg-[#1c1c1c] rounded-xl border border-[#333333]">
                    <label className="block text-xs font-bold text-emerald-300 mb-1 uppercase tracking-wider">
                      Community Vote Target Goal
                    </label>
                    <p className="text-[11px] text-slate-400 mb-2">
                      Set a target vote count to measure member interest on the Community Board.
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={voteThresholdInput}
                        onChange={(e) => setVoteThresholdInput(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-24 px-3 py-1.5 bg-[#121212] border border-emerald-600/50 rounded-lg text-sm text-white font-mono font-bold focus:outline-none focus:border-emerald-400"
                      />
                      <span className="text-xs text-slate-400">target upvotes</span>
                    </div>
                  </div>
                )}

                {/* Note textarea for non-delete actions */}
                {moderateAction !== 'delete' && (
                  <div className="mb-4">
                    <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wider">
                      {moderateAction === 'approve' ? 'Faculty Note' :
                       moderateAction === 'reject' ? 'Reason / Feedback for Submitter' :
                       'Note / Remarks (Optional)'}
                    </label>
                    <textarea
                      rows={3}
                      value={moderateNote}
                      onChange={(e) => setModerateNote(e.target.value)}
                      placeholder={
                        moderateAction === 'promote' ? 'e.g. Great pitch! Looking forward to community feedback...' :
                        moderateAction === 'reject' ? 'e.g. Needs more technical specifics or venue approval...' :
                        moderateAction === 'faculty' ? 'e.g. Strong engagement, recommended for club sanctioning...' :
                        moderateAction === 'approve' ? 'e.g. Approved! Mentor assigned and resources allocated...' :
                        'Add remarks...'
                      }
                      className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333333] rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none"
                    />
                  </div>
                )}

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => { setModerateIdea(null); setModerateAction(null); setModerateNote(''); }}
                    className="px-4 py-2 rounded-xl bg-[#222222] border border-[#333333] text-slate-300 text-xs font-bold hover:border-[#555] cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleModerate}
                    disabled={submittingMod}
                    className={`px-5 py-2 rounded-xl text-white text-xs font-bold cursor-pointer disabled:opacity-60 flex items-center gap-1.5 transition-colors ${
                      moderateAction === 'promote' ? 'bg-emerald-700 hover:bg-emerald-600' :
                      moderateAction === 'reject' || moderateAction === 'delete' ? 'bg-rose-700 hover:bg-rose-600' :
                      moderateAction === 'faculty' ? 'bg-blue-700 hover:bg-blue-600' :
                      moderateAction === 'archive' ? 'bg-slate-700 hover:bg-slate-600' :
                      'bg-purple-700 hover:bg-purple-600'
                    }`}
                  >
                    {submittingMod ? (
                      <div className="w-3.5 h-3.5 border border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <span className="material-symbols-outlined text-base">
                        {moderateAction === 'promote' ? 'rocket_launch' :
                         moderateAction === 'reject' ? 'close' :
                         moderateAction === 'faculty' ? 'school' :
                         moderateAction === 'archive' ? 'archive' :
                         moderateAction === 'delete' ? 'delete_forever' :
                         moderateAction === 'restore' ? 'restore_from_trash' :
                         'verified'}
                      </span>
                    )}
                    {moderateAction === 'promote' ? 'Promote' :
                     moderateAction === 'reject' ? 'Reject' :
                     moderateAction === 'faculty' ? 'Send to Faculty' :
                     moderateAction === 'approve' ? 'Approve' :
                     moderateAction === 'archive' ? 'Archive' :
                     moderateAction === 'restore' ? 'Restore' :
                     'Delete'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};

export default IdeaHub;
