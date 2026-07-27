"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { PaymentItem, PaymentStatus } from '@/types/payment';
import {
  fetchPaymentsFromFirestore,
  createPaymentInFirestore,
  deletePaymentFromFirestore,
  saveInvoiceToFirestore,
  saveTransactionToFirestore,
  fetchInvoicesFromFirestore,
  seedDemoPayments,
  TransactionLog,
  PAYMENTS_COLLECTION,
  INVOICES_COLLECTION,
} from '@/lib/payments';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { User } from 'firebase/auth';
import {
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Clock,
  RotateCcw,
  Search,
  Filter,
  ShieldCheck,
  Zap,
  Sparkles,
  Download,
  PlusCircle,
  ExternalLink,
  ChevronRight,
  Receipt,
  X,
  FileText,
  UserCheck,
  ShieldAlert,
  Trash2,
  Users,
  Megaphone,
  HelpCircle,
  Copy,
  Check,
  FileSpreadsheet,
  Eye,
  Layers,
  ArrowUpRight
} from 'lucide-react';

interface PaymentsProps {
  onRedirect?: () => void;
  // External auth props — provided by the global AuthContext via page.tsx
  externalUser?: User | null;
  externalUserEmail?: string;
  externalIsAdmin?: boolean;
  // Legacy prop kept for backwards compat
  isAdmin?: boolean;
}

interface MemberOption {
  name: string;
  regNo: string;
  email: string;
  team: string;
}

interface CampaignGroup {
  key: string;
  title: string;
  category: string;
  amount: number;
  currency: string;
  due_date?: string;
  totalAssigned: number;
  paidCount: number;
  pendingCount: number;
  failedCount: number;
  totalCollected: number;
  totalTarget: number;
  percentage: number;
  items: PaymentItem[];
}

// Function to load Razorpay SDK dynamically
const loadRazorpayScript = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && (window as any).Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

const Payments: React.FC<PaymentsProps> = ({
  onRedirect,
  externalUser,
  externalUserEmail = '',
  externalIsAdmin = false,
  isAdmin: propIsAdmin,
}) => {
  const currentUser = externalUser ?? null;
  const userEmail = externalUserEmail;
  // Restrict Payment Admin control panel strictly to vrgc@vitbhopal.ac.in
  const isAdminState = (userEmail || currentUser?.email || '').toLowerCase() === 'vrgc@vitbhopal.ac.in';
  const [adminViewAll, setAdminViewAll] = useState<boolean>(true);

  // Members list parsed from public/members.csv
  const [membersList, setMembersList] = useState<MemberOption[]>([]);
  const [membersMap, setMembersMap] = useState<Map<string, MemberOption>>(new Map());

  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');

  // Modals & Active Campaign Roster
  const [activeRosterCampaign, setActiveRosterCampaign] = useState<CampaignGroup | null>(null);
  const [rosterSearch, setRosterSearch] = useState<string>('');
  const [rosterStatusFilter, setRosterStatusFilter] = useState<string>('All');

  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [receiptModalPayment, setReceiptModalPayment] = useState<PaymentItem | null>(null);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [showAssignAllModal, setShowAssignAllModal] = useState<boolean>(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Transaction Logs (admin only)
  const [transactionLogs, setTransactionLogs] = useState<TransactionLog[]>([]);
  const [logsLoading, setLogsLoading] = useState<boolean>(false);
  const [showLogsPanel, setShowLogsPanel] = useState<boolean>(false);

  // Single Member Due Form state
  const [selectedMemberEmail, setSelectedMemberEmail] = useState<string>('');
  const [targetEmail, setTargetEmail] = useState<string>('');
  const [newTitle, setNewTitle] = useState<string>('');
  const [newAmount, setNewAmount] = useState<string>('');
  const [newCategory, setNewCategory] = useState<string>('Club Fee');
  const [newDescription, setNewDescription] = useState<string>('');
  const [newDueDate, setNewDueDate] = useState<string>('');
  const [creating, setCreating] = useState<boolean>(false);

  // All Members Due Form state
  const [allTitle, setAllTitle] = useState<string>('');
  const [allAmount, setAllAmount] = useState<string>('');
  const [allCategory, setAllCategory] = useState<string>('Club Fee');
  const [allDescription, setAllDescription] = useState<string>('');
  const [allDueDate, setAllDueDate] = useState<string>('');
  const [assigningAll, setAssigningAll] = useState<boolean>(false);

  // Load registered crew members from members.csv
  useEffect(() => {
    const loadMembers = async () => {
      try {
        const res = await fetch('/members.csv');
        if (res.ok) {
          const text = await res.text();
          const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('Name,'));
          const parsed: MemberOption[] = lines.map((line) => {
            const parts = line.split(',');
            return {
              name: parts[0] || 'Member',
              regNo: parts[1] || '',
              email: parts[3] ? parts[3].toLowerCase() : '',
              team: parts[4] || '',
            };
          }).filter((m) => m.email);

          const uniqueMembers = Array.from(new Map(parsed.map((m) => [m.email, m])).values());
          setMembersList(uniqueMembers);
          setMembersMap(new Map(uniqueMembers.map((m) => [m.email, m])));
        }
      } catch (err) {
        console.error('Error parsing members.csv:', err);
      }
    };

    loadMembers();
  }, []);

  // Fetch payments from Firestore
  const loadPayments = useCallback(async (email: string, adminStatus: boolean) => {
    setLoading(true);
    try {
      const data = await fetchPaymentsFromFirestore(email, adminStatus);
      setPayments(data);
    } catch (err) {
      console.error('Error loading payments:', err);
      showToast('Failed to load payments from database', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userEmail) {
      loadPayments(userEmail, isAdminState && adminViewAll);
    } else {
      setLoading(false);
    }
  }, [userEmail, isAdminState, adminViewAll, loadPayments]);

  // Firestore realtime listener for payments collection
  useEffect(() => {
    if (!userEmail) return;

    const colRef = collection(db, PAYMENTS_COLLECTION);
    const q = isAdminState && adminViewAll
      ? query(colRef)
      : query(colRef, where('user_email', '==', userEmail.toLowerCase()));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: PaymentItem[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        items.push({
          id: docSnap.id,
          user_email: data.user_email || '',
          title: data.title || '',
          description: data.description || '',
          category: data.category || 'Club Fee',
          amount: Number(data.amount) || 0,
          currency: data.currency || 'INR',
          status: (data.status as PaymentStatus) || 'Pending',
          due_date: data.due_date || '',
          razorpay_order_id: data.razorpay_order_id || '',
          razorpay_payment_id: data.razorpay_payment_id || '',
          razorpay_signature: data.razorpay_signature || '',
          paid_at: data.paid_at || '',
          created_at: data.created_at?.toDate ? data.created_at.toDate().toISOString() : data.created_at || new Date().toISOString(),
          updated_at: data.updated_at?.toDate ? data.updated_at.toDate().toISOString() : data.updated_at || new Date().toISOString(),
        });
      });
      items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setPayments(items);
      setLoading(false);
    }, (err) => {
      console.warn('Firestore payments subscription warning:', err);
    });

    return () => unsubscribe();
  }, [userEmail, isAdminState, adminViewAll]);

  // Load transaction logs from Firestore invoices collection
  const loadTransactionLogs = useCallback(async () => {
    if (!isAdminState) return;
    setLogsLoading(true);
    try {
      const logs = await fetchInvoicesFromFirestore(userEmail, isAdminState);
      setTransactionLogs(logs);
    } catch (err) {
      console.error('Error loading transaction logs:', err);
    } finally {
      setLogsLoading(false);
    }
  }, [userEmail, isAdminState]);

  // Firestore realtime subscription for invoices collection
  useEffect(() => {
    if (!isAdminState || !showLogsPanel) return;

    loadTransactionLogs();

    const colRef = collection(db, INVOICES_COLLECTION);
    const unsubscribe = onSnapshot(colRef, () => {
      loadTransactionLogs();
    }, (err) => {
      console.warn('Firestore invoices subscription warning:', err);
    });

    return () => unsubscribe();
  }, [isAdminState, showLogsPanel, loadTransactionLogs]);

  // Toast Helper
  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Seed sample demo dues (Admin function)
  const handleSeedDemo = async () => {
    if (!isAdminState) {
      showToast('Only authorized VRGC Admins can seed demo dues.', 'error');
      return;
    }
    setLoading(true);
    const destinationEmail = targetEmail || selectedMemberEmail || userEmail || 'member@vrgc.club';
    const seeded = await seedDemoPayments(destinationEmail);
    if (seeded && seeded.length > 0) {
      setPayments((prev) => [...seeded, ...prev]);
      showToast(`Sample payment dues assigned to ${destinationEmail}! 🎉`, 'success');
    } else {
      showToast('Could not seed sample payments.', 'error');
    }
    setLoading(false);
  };

  // Handle Member selection change in Modal
  const handleSelectMemberInModal = (email: string) => {
    setSelectedMemberEmail(email);
    if (email !== 'custom') {
      setTargetEmail(email);
    } else {
      setTargetEmail('');
    }
  };

  // Create single member payment (Admin function)
  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdminState) {
      showToast('Unauthorized: Only admins can assign payments.', 'error');
      return;
    }

    const finalTargetEmail = (targetEmail || selectedMemberEmail).trim().toLowerCase();

    if (!newTitle || !newAmount || Number(newAmount) <= 0 || !finalTargetEmail) {
      showToast('Please select a target member email, valid title, and amount.', 'error');
      return;
    }

    setCreating(true);
    try {
      const created = await createPaymentInFirestore({
        user_email: finalTargetEmail,
        title: newTitle,
        description: newDescription || 'Assigned VRGC Payment Due',
        category: newCategory,
        amount: Number(newAmount),
        currency: 'INR',
        status: 'Pending' as PaymentStatus,
        due_date: newDueDate ? new Date(newDueDate).toISOString() : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });

      if (created) {
        setPayments((prev) => [created, ...prev]);
        showToast(`Payment due of ₹${newAmount} assigned to ${finalTargetEmail}! ✨`, 'success');
      } else {
        showToast('Failed to create payment due in Firestore', 'error');
      }

      setShowCreateModal(false);
      setNewTitle('');
      setNewAmount('');
      setNewDescription('');
      setTargetEmail('');
      setSelectedMemberEmail('');
      setNewDueDate('');
    } catch (err: any) {
      showToast(err.message || 'Failed to create payment due', 'error');
    } finally {
      setCreating(false);
    }
  };

  // Assign Payment Due to ALL Registered Members
  const handleAssignToAllMembers = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdminState) return;

    if (!allTitle || !allAmount || Number(allAmount) <= 0) {
      showToast('Please enter a valid title and amount.', 'error');
      return;
    }

    if (membersList.length === 0) {
      showToast('No registered crew members found in directory.', 'error');
      return;
    }

    setAssigningAll(true);
    try {
      let createdCount = 0;
      for (const m of membersList) {
        const created = await createPaymentInFirestore({
          user_email: m.email.toLowerCase(),
          title: allTitle,
          description: allDescription || 'Mandatory VRGC Member Due',
          category: allCategory,
          amount: Number(allAmount),
          currency: 'INR',
          status: 'Pending' as PaymentStatus,
          due_date: allDueDate ? new Date(allDueDate).toISOString() : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        });
        if (created) createdCount++;
      }

      showToast(`Successfully assigned ₹${allAmount} due to ${createdCount} crew members in Firestore! 🎉`, 'success');
      setShowAssignAllModal(false);
      setAllTitle('');
      setAllAmount('');
      setAllDescription('');
      setAllDueDate('');
    } catch (err: any) {
      showToast(err.message || 'Failed to assign dues to all members.', 'error');
    } finally {
      setAssigningAll(false);
    }
  };

  // Delete payment (Admin function)
  const handleDeletePayment = async (paymentId: string) => {
    if (!isAdminState) return;
    if (!confirm('Are you sure you want to delete this payment record?')) return;

    const ok = await deletePaymentFromFirestore(paymentId);
    if (ok) {
      setPayments((prev) => prev.filter((p) => p.id !== paymentId));
      if (activeRosterCampaign) {
        setActiveRosterCampaign((prev) =>
          prev ? { ...prev, items: prev.items.filter((item) => item.id !== paymentId) } : null
        );
      }
      showToast('Payment record deleted from Firestore successfully.', 'info');
    } else {
      setPayments((prev) => prev.filter((p) => p.id !== paymentId));
      showToast('Payment removed locally.', 'info');
    }
  };

  // Export CSV helper
  const handleExportCSV = (campaignTitle?: string, paidOnly: boolean = false) => {
    let exportItems = payments;

    if (campaignTitle) {
      exportItems = exportItems.filter((p) => p.title.toLowerCase() === campaignTitle.toLowerCase());
    }

    if (paidOnly) {
      exportItems = exportItems.filter((p) => p.status === 'Paid');
    }

    if (exportItems.length === 0) {
      showToast('No payment records to export for this filter.', 'info');
      return;
    }

    const headers = [
      'Member Name',
      'Regn Number',
      'Team',
      'Payer Email',
      'Payment Title',
      'Category',
      'Amount (INR)',
      'Status',
      'Paid At',
      'Razorpay Payment ID',
      'Razorpay Order ID',
      'Created Date',
    ];

    const rows = exportItems.map((p) => {
      const email = p.user_email ? p.user_email.toLowerCase() : '';
      const member = membersMap.get(email);
      const name = member ? member.name : 'Unknown Member';
      const regNo = member ? member.regNo : '';
      const team = member ? member.team : '';

      return [
        `"${name.replace(/"/g, '""')}"`,
        `"${regNo}"`,
        `"${team}"`,
        `"${email}"`,
        `"${(p.title || '').replace(/"/g, '""')}"`,
        `"${p.category || ''}"`,
        p.amount,
        p.status,
        `"${p.paid_at ? new Date(p.paid_at).toLocaleString('en-IN') : ''}"`,
        `"${p.razorpay_payment_id || ''}"`,
        `"${p.razorpay_order_id || ''}"`,
        `"${p.created_at ? new Date(p.created_at).toLocaleString('en-IN') : ''}"`,
      ];
    });

    const csvString = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const cleanTitle = (campaignTitle || 'All_Payments').replace(/[^a-zA-Z0-9]/g, '_');
    link.setAttribute('download', `VRGC_${cleanTitle}_${paidOnly ? 'PaidOnly' : 'FullReport'}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast(`Exported CSV report with ${exportItems.length} records! 📊`, 'success');
  };

  // Razorpay Checkout Handler
  const handlePayNow = async (payment: PaymentItem) => {
    setProcessingId(payment.id);

    try {
      const isSdkLoaded = await loadRazorpayScript();
      if (!isSdkLoaded) {
        showToast('Failed to load Razorpay Checkout SDK. Check internet connection.', 'error');
        setProcessingId(null);
        return;
      }

      const res = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId: payment.id,
          amount: payment.amount,
          currency: payment.currency || 'INR',
          title: payment.title,
          userEmail: userEmail || payment.user_email || '',
        }),
      });

      const orderData = await res.json();

      if (!res.ok || !orderData.success) {
        throw new Error(orderData.error || 'Failed to create Razorpay order.');
      }

      setPayments((prev) =>
        prev.map((item) => (item.id === payment.id ? { ...item, status: 'Processing' } : item))
      );

      let razorpayKey = orderData.key_id;
      if (!razorpayKey) {
        try {
          const keyRes = await fetch('/api/get-razorpay-key');
          if (keyRes.ok) {
            const keyJson = await keyRes.json();
            razorpayKey = keyJson.keyId;
          }
        } catch (err) {
          console.error('Failed to fetch Razorpay key:', err);
        }
      }

      const options = {
        key: razorpayKey,
        amount: orderData.amount,
        currency: orderData.currency,
        name: 'VRGC Platform',
        description: payment.title,
        order_id: orderData.order_id,
        image: '/icon.svg',
        prefill: {
          name: currentUser?.displayName || 'VRGC Crew Member',
          email: userEmail || 'member@vrgc.club',
        },
        theme: {
          color: '#a855f7',
        },
        modal: {
          ondismiss: () => {
            setProcessingId(null);
            setPayments((prev) =>
              prev.map((item) => (item.id === payment.id ? { ...item, status: 'Pending' } : item))
            );
            showToast('Payment Cancelled', 'info');
          },
        },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const verifyRes = await fetch('/api/verify-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                paymentId: payment.id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                userEmail: userEmail || payment.user_email || '',
                paymentTitle: payment.title,
                amount: payment.amount,
                currency: payment.currency || 'INR',
              }),
            });

            const verifyData = await verifyRes.json();

            if (verifyRes.ok && verifyData.success) {
              const updatedItem: PaymentItem = {
                ...payment,
                status: 'Paid',
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                paid_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };

              setPayments((prev) =>
                prev.map((item) => (item.id === payment.id ? updatedItem : item))
              );

              // Save transaction log & update payment status in Firestore
              saveTransactionToFirestore({
                payment_id: payment.id,
                user_email: payment.user_email || userEmail,
                payment_title: payment.title,
                amount: payment.amount,
                currency: payment.currency || 'INR',
                status: 'Paid',
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
                paid_at: updatedItem.paid_at!,
              });

              showToast('Payment Successful 🎉 Your payment has been confirmed successfully.', 'success');
              setReceiptModalPayment(updatedItem);
            } else {
              setPayments((prev) =>
                prev.map((item) => (item.id === payment.id ? { ...item, status: 'Failed' } : item))
              );
              // Log failed transaction to Firestore
              saveTransactionToFirestore({
                payment_id: payment.id,
                user_email: userEmail || payment.user_email || '',
                payment_title: payment.title,
                amount: payment.amount,
                currency: payment.currency || 'INR',
                status: 'Failed',
                error_description: verifyData.error || 'Verification failed',
              });
              showToast(verifyData.error || 'Payment verification failed.', 'error');
            }
          } catch (err: any) {
            console.error('Verification error:', err);
            setPayments((prev) =>
              prev.map((item) => (item.id === payment.id ? { ...item, status: 'Failed' } : item))
            );
            saveTransactionToFirestore({
              payment_id: payment.id,
              user_email: userEmail || payment.user_email || '',
              payment_title: payment.title,
              amount: payment.amount,
              currency: payment.currency || 'INR',
              status: 'Failed',
              error_description: err?.message || 'Exception during verification',
            });
            showToast('Verification failed. Please contact support.', 'error');
          } finally {
            setProcessingId(null);
          }
        },
      };

      const razorpayInstance = new (window as any).Razorpay(options);
      razorpayInstance.on('payment.failed', (resp: any) => {
        console.error('Razorpay payment failed:', resp.error);
        setProcessingId(null);
        setPayments((prev) =>
          prev.map((item) => (item.id === payment.id ? { ...item, status: 'Failed' } : item))
        );
        // Log failed transaction to Firestore
        saveTransactionToFirestore({
          payment_id: payment.id,
          user_email: userEmail || payment.user_email || '',
          payment_title: payment.title,
          amount: payment.amount,
          currency: payment.currency || 'INR',
          status: 'Failed',
          razorpay_order_id: resp.error?.metadata?.order_id,
          razorpay_payment_id: resp.error?.metadata?.payment_id,
          error_description: resp.error?.description || 'Transaction declined',
        });
        showToast(`Payment Failed: ${resp.error.description || 'Transaction declined'}`, 'error');
      });

      razorpayInstance.open();
    } catch (error: any) {
      console.error('Payment initialization error:', error);
      setProcessingId(null);
      setPayments((prev) =>
        prev.map((item) => (item.id === payment.id ? { ...item, status: 'Pending' } : item))
      );
      showToast(error.message || 'Payment Failed. Please try again or contact support.', 'error');
    }
  };

  // Group Payments by Campaign Title for Admin View
  const campaignGroups = useMemo<CampaignGroup[]>(() => {
    if (!isAdminState || !adminViewAll) return [];

    const map = new Map<string, PaymentItem[]>();

    payments.forEach((p) => {
      const key = `${p.title.trim()}__${p.amount}`;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(p);
    });

    const groups: CampaignGroup[] = [];

    map.forEach((items, key) => {
      const first = items[0];
      const title = first.title;
      const category = first.category;
      const amount = Number(first.amount);
      const currency = first.currency || 'INR';
      const due_date = first.due_date;

      const totalAssigned = items.length;
      const paidCount = items.filter((i) => i.status === 'Paid').length;
      const pendingCount = items.filter((i) => i.status === 'Pending' || i.status === 'Processing').length;
      const failedCount = items.filter((i) => i.status === 'Failed').length;
      const totalCollected = paidCount * amount;
      const totalTarget = totalAssigned * amount;
      const percentage = totalTarget > 0 ? Math.round((totalCollected / totalTarget) * 100) : 0;

      // Filter by category or search query if applicable
      const matchesCategory =
        selectedCategory === 'All' || category.toLowerCase() === selectedCategory.toLowerCase();
      const matchesSearch =
        !searchQuery.trim() ||
        title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        items.some(
          (i) => i.user_email && i.user_email.toLowerCase().includes(searchQuery.toLowerCase())
        );

      if (matchesCategory && matchesSearch) {
        groups.push({
          key,
          title,
          category,
          amount,
          currency,
          due_date,
          totalAssigned,
          paidCount,
          pendingCount,
          failedCount,
          totalCollected,
          totalTarget,
          percentage,
          items,
        });
      }
    });

    return groups.sort((a, b) => b.totalAssigned - a.totalAssigned);
  }, [payments, isAdminState, adminViewAll, selectedCategory, searchQuery]);

  // Statistics calculation
  const stats = useMemo(() => {
    const totalPending = payments
      .filter((p) => p.status === 'Pending' || p.status === 'Processing')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const totalPaid = payments
      .filter((p) => p.status === 'Paid')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const pendingCount = payments.filter((p) => p.status === 'Pending' || p.status === 'Processing').length;
    const paidCount = payments.filter((p) => p.status === 'Paid').length;
    return { totalPending, totalPaid, pendingCount, paidCount, total: payments.length };
  }, [payments]);

  // Helper badge generator
  const renderStatusBadge = (status: PaymentStatus) => {
    switch (status) {
      case 'Pending':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            🟡 Pending
          </span>
        );
      case 'Processing':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
            🔵 Processing
          </span>
        );
      case 'Paid':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" />
            🟢 Paid
          </span>
        );
      case 'Failed':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <AlertCircle className="w-3.5 h-3.5" />
            🔴 Failed
          </span>
        );
      case 'Cancelled':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-500/10 text-slate-400 border border-slate-500/30">
            ⚪ Cancelled
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 text-[#e2e8f0]">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-20 right-4 md:right-8 z-[100] px-6 py-4 rounded-xl backdrop-blur-xl border shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-5 duration-200 ${
            toastMessage.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200 shadow-[0_0_30px_rgba(16,185,129,0.3)]'
              : toastMessage.type === 'error'
              ? 'bg-rose-950/90 border-rose-500/50 text-rose-200 shadow-[0_0_30px_rgba(244,63,94,0.3)]'
              : 'bg-purple-950/90 border-purple-500/50 text-purple-200 shadow-[0_0_30px_rgba(168,85,247,0.3)]'
          }`}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          ) : toastMessage.type === 'error' ? (
            <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          ) : (
            <ShieldCheck className="w-5 h-5 text-purple-400 flex-shrink-0" />
          )}
          <span className="text-sm font-semibold">{toastMessage.text}</span>
        </div>
      )}

      {/* Top Banner & Header — Minimal Admin Panel */}
      <div className="relative overflow-hidden rounded-2xl bg-[#0e0518] border border-purple-500/20 p-5 shadow-lg">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {/* Left: title + status */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center flex-shrink-0">
              <CreditCard className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-extrabold text-white tracking-tight">Payments & Dues</h1>
                {isAdminState && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    <ShieldAlert className="w-3 h-3" /> ADMIN
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {userEmail || 'Guest'} •{' '}
                <span className="text-emerald-400 font-semibold">Razorpay Secured</span>
              </p>
            </div>
          </div>

          {/* Right: action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {onRedirect && (
              <button
                onClick={onRedirect}
                className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-bold text-slate-400 transition-all"
              >
                ← Dashboard
              </button>
            )}
            {isAdminState && (
              <>
                <button
                  onClick={() => setShowLogsPanel((v) => !v)}
                  className={`px-3 py-2 rounded-lg border text-xs font-bold transition-all flex items-center gap-1.5 ${
                    showLogsPanel
                      ? 'bg-blue-600/30 border-blue-500/50 text-blue-200'
                      : 'bg-blue-600/10 hover:bg-blue-600/20 text-blue-300 border border-blue-500/30'
                  }`}
                >
                  <Receipt className="w-3.5 h-3.5" />
                  Tx Logs
                </button>
                <button
                  onClick={() => handleExportCSV(undefined, true)}
                  className="px-3 py-2 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Export CSV
                </button>
                <button
                  onClick={() => setShowAssignAllModal(true)}
                  className="px-3 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <Megaphone className="w-3.5 h-3.5" />
                  All Members
                </button>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-3 py-2 rounded-lg bg-purple-600/80 hover:bg-purple-500 text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-[0_0_15px_rgba(168,85,247,0.3)]"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  Assign Due
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Summary Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-[#0e0518]/90 border border-purple-500/20 backdrop-blur-md shadow-lg flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
            <span>PENDING DUES</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl md:text-3xl font-black text-amber-300">
            ₹{stats.totalPending.toLocaleString('en-IN')}
          </div>
          <div className="text-[11px] text-amber-400/80 font-medium">
            {stats.pendingCount} payment{stats.pendingCount !== 1 ? 's' : ''} awaiting completion
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-[#0e0518]/90 border border-emerald-500/20 backdrop-blur-md shadow-lg flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
            <span>TOTAL COLLECTED</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl md:text-3xl font-black text-emerald-300">
            ₹{stats.totalPaid.toLocaleString('en-IN')}
          </div>
          <div className="text-[11px] text-emerald-400/80 font-medium">
            {stats.paidCount} confirmed transaction{stats.paidCount !== 1 ? 's' : ''}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-[#0e0518]/90 border border-purple-500/20 backdrop-blur-md shadow-lg flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
            <span>REGISTERED CREW</span>
            <Users className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl md:text-3xl font-black text-purple-300">
            {membersList.length} Members
          </div>
          <div className="text-[11px] text-slate-400 font-medium">
            Active club directory
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-[#0e0518]/90 border border-purple-500/20 backdrop-blur-md shadow-lg flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
            <span>GATEWAY STATUS</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-emerald-400 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            Razorpay Live
          </div>
          <div className="text-[11px] text-emerald-400/70 font-semibold">
            Payments Secured
          </div>
        </div>
      </div>

      {/* Transaction Logs Panel (Admin Only) */}
      {isAdminState && showLogsPanel && (
        <div className="rounded-2xl bg-[#0e0518]/90 border border-blue-500/30 backdrop-blur-md shadow-lg overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-blue-500/20 bg-blue-950/30">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-bold text-white">Transaction Logs</h2>
              <span className="text-[10px] font-mono text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">LIVE</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{transactionLogs.length} records</span>
              <button
                onClick={loadTransactionLogs}
                className="p-1.5 rounded-lg hover:bg-blue-500/10 text-blue-400 transition-all"
                title="Refresh logs"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {logsLoading ? (
            <div className="flex items-center justify-center py-8 gap-3 text-blue-400">
              <div className="w-5 h-5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
              <span className="text-xs font-semibold">Loading transaction logs...</span>
            </div>
          ) : transactionLogs.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-slate-400">No transactions recorded yet.</p>
              <p className="text-xs text-slate-500 mt-1">Transaction logs will appear here after payments are processed.</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-80 custom-scrollbar">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#0e0518]/95 border-b border-blue-500/10">
                  <tr className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Member</th>
                    <th className="px-4 py-2 text-left">Payment</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-left">Razorpay ID</th>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-left">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {transactionLogs.map((log) => (
                    <tr key={log.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2.5">
                        {log.status === 'Paid' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3" />Paid
                          </span>
                        ) : log.status === 'Failed' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            <AlertCircle className="w-3 h-3" />Failed
                          </span>
                        ) : log.status === 'Processing' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            <Clock className="w-3 h-3" />Processing
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            <Clock className="w-3 h-3" />Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-300 font-mono">{log.user_email}</td>
                      <td className="px-4 py-2.5 text-slate-200 max-w-[160px] truncate">{log.payment_title}</td>
                      <td className="px-4 py-2.5 text-right text-white font-bold">₹{Number(log.amount).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-2.5 text-slate-400 font-mono text-[10px]">
                        {log.razorpay_payment_id ? (
                          <span title={log.razorpay_payment_id}>{log.razorpay_payment_id.slice(-8)}</span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="px-4 py-2.5 text-rose-400/80 text-[10px] max-w-[120px] truncate" title={log.error_description}>
                        {log.error_description || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Toolbar: Category Filters & Search */}
      <div className="p-4 rounded-2xl bg-[#0e0518]/80 border border-purple-500/20 backdrop-blur-md flex flex-col lg:flex-row gap-4 items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
          {/* Search Input */}
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search payment title, category or member..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 transition-all"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 w-full lg:w-auto justify-between lg:justify-end">
          {/* Category Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar">
            <span className="text-xs text-slate-400 font-semibold pr-1">Category:</span>
            {['All', 'Club Fee', 'Event Registration', 'Merchandise', 'Fine'].map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                  selectedCategory === cat
                    ? 'bg-purple-600 text-white shadow-[0_0_15px_rgba(168,85,247,0.4)]'
                    : 'bg-white/5 hover:bg-white/10 text-slate-400 border border-white/5'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* MAIN VIEW: Admin Unified Campaign Cards vs Non-Admin Personal Dues */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="p-6 rounded-2xl bg-[#0e0518]/70 border border-purple-500/10 animate-pulse space-y-4"
            >
              <div className="flex justify-between items-center">
                <div className="h-6 w-1/3 bg-purple-500/20 rounded-lg" />
                <div className="h-6 w-20 bg-purple-500/20 rounded-full" />
              </div>
              <div className="h-4 w-2/3 bg-purple-500/10 rounded" />
              <div className="h-10 w-full bg-purple-500/20 rounded-xl" />
            </div>
          ))}
        </div>
      ) : isAdminState && adminViewAll ? (
        /* ADMIN VIEW: Unified Payment Due Campaign Cards */
        campaignGroups.length === 0 ? (
          <div className="p-12 rounded-3xl bg-[#0e0518]/60 border border-purple-500/20 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mx-auto text-purple-400">
              <Layers className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-white">No Payment Campaigns Found</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              No active payment campaigns exist. Click below to assign a payment due to all crew members.
            </p>
            <div className="pt-2 flex justify-center gap-3">
              <button
                onClick={() => setShowAssignAllModal(true)}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-xs font-bold text-white shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all flex items-center gap-2"
              >
                <Megaphone className="w-4 h-4" />
                <span>Assign Due to ALL Members</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Layers className="w-5 h-5 text-purple-400" />
                <span>Active Payment Campaigns ({campaignGroups.length})</span>
              </h2>
              <span className="text-xs text-slate-400">
                Click any campaign to inspect assigned members and payment statuses.
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {campaignGroups.map((group) => (
                <div
                  key={group.key}
                  className="rounded-xl bg-[#0b0415] border border-purple-500/20 hover:border-purple-500/40 transition-all p-4 flex flex-col gap-4 shadow-lg"
                >
                  {/* Minimal Campaign Card Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <span className="text-[9px] font-mono text-purple-400 uppercase tracking-wider">{group.category}</span>
                      <h3 className="text-sm font-bold text-white truncate">{group.title}</h3>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-base font-black text-white">₹{group.amount.toLocaleString('en-IN')}</span>
                      {/* Delete entire campaign */}
                      <button
                        onClick={() => {
                          if (confirm(`Delete ALL ${group.totalAssigned} invoice records for "${group.title}"? This cannot be undone.`)) {
                            group.items.forEach((item) => handleDeletePayment(item.id));
                          }
                        }}
                        title="Delete campaign"
                        className="p-1.5 text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-semibold">
                      <span className="text-slate-400">₹{group.totalCollected.toLocaleString('en-IN')} collected</span>
                      <span className="text-purple-300">{group.percentage}% of ₹{group.totalTarget.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-purple-500 to-emerald-400 transition-all duration-500"
                        style={{ width: `${Math.min(group.percentage, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Counts row */}
                  <div className="flex items-center gap-2 text-[11px] font-semibold flex-wrap">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Users className="w-3 h-3 text-purple-400" />{group.totalAssigned}
                    </span>
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />{group.paidCount} paid
                    </span>
                    <span className="text-amber-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />{group.pendingCount} pending
                    </span>
                    {group.failedCount > 0 && (
                      <span className="text-rose-400 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />{group.failedCount} failed
                      </span>
                    )}
                  </div>

                  {/* Action footer */}
                  <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-2">
                    <button
                      onClick={() => handleExportCSV(group.title, true)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/20 text-[11px] font-bold transition-all flex items-center gap-1.5"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      Paid CSV
                    </button>
                    <button
                      onClick={() => setActiveRosterCampaign(group)}
                      className="px-3 py-1.5 rounded-lg bg-purple-600/80 hover:bg-purple-500 text-white text-[11px] font-bold transition-all flex items-center gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Inspect Roster
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      ) : (
        /* REGULAR USER / NON-ADMIN VIEW: Personal Dues Cards */
        payments.length === 0 ? (
          <div className="p-12 rounded-3xl bg-[#0e0518]/60 border border-purple-500/20 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mx-auto text-purple-400">
              <CreditCard className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-white">No Assigned Dues</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              You currently have no pending payment dues assigned to your account.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {payments.map((payment) => {
              const isProcessing = processingId === payment.id || payment.status === 'Processing';
              const isPaid = payment.status === 'Paid';

              return (
                <div
                  key={payment.id}
                  className={`group relative rounded-2xl bg-[#0e0518]/90 border transition-all duration-300 p-6 flex flex-col justify-between backdrop-blur-md hover:shadow-[0_0_30px_rgba(168,85,247,0.2)] ${
                    isPaid
                      ? 'border-emerald-500/30 hover:border-emerald-500/50'
                      : isProcessing
                      ? 'border-blue-500/40 hover:border-blue-500/60'
                      : 'border-purple-500/20 hover:border-purple-500/40'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <span className="text-[10px] font-mono text-purple-400 tracking-wider uppercase bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
                          {payment.category}
                        </span>
                        <h3 className="text-lg font-bold text-white group-hover:text-purple-300 transition-colors">
                          {payment.title}
                        </h3>
                      </div>
                      {renderStatusBadge(payment.status)}
                    </div>

                    {payment.description && (
                      <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                        {payment.description}
                      </p>
                    )}
                  </div>

                  <div className="my-5 p-4 rounded-xl bg-surface-container-lowest/60 border border-white/5 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-semibold">AMOUNT DUE</span>
                      <span className="text-2xl font-black text-white tracking-tight">
                        ₹{Number(payment.amount).toLocaleString('en-IN')}
                        <span className="text-xs font-normal text-slate-400 ml-1">INR</span>
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block font-semibold">
                        {isPaid ? 'PAID ON' : 'DUE DATE'}
                      </span>
                      <span className="text-xs font-mono font-medium text-slate-300">
                        {isPaid && payment.paid_at
                          ? new Date(payment.paid_at).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })
                          : payment.due_date
                          ? new Date(payment.due_date).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })
                          : 'No Due Date'}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-3">
                    <div className="text-[11px] font-mono text-slate-500 truncate max-w-[140px]">
                      ID: {payment.id.slice(0, 12)}...
                    </div>

                    {isPaid ? (
                      <button
                        onClick={() => setReceiptModalPayment(payment)}
                        className="px-4 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold transition-all flex items-center gap-1.5"
                      >
                        <Receipt className="w-3.5 h-3.5" />
                        <span>View Receipt</span>
                      </button>
                    ) : (
                      <button
                        disabled={isProcessing}
                        onClick={() => handlePayNow(payment)}
                        className={`px-5 py-2.5 rounded-xl font-bold text-xs shadow-lg transition-all flex items-center gap-2 ${
                          isProcessing
                            ? 'bg-blue-600/50 text-white cursor-wait opacity-80'
                            : 'bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.4)] hover:scale-102 active:scale-98'
                        }`}
                      >
                        {isProcessing ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>Processing...</span>
                          </>
                        ) : (
                          <>
                            <CreditCard className="w-4 h-4" />
                            <span>Pay Now (₹{payment.amount})</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ADMIN CAMPAIGN MEMBER ROSTER MODAL */}
      {activeRosterCampaign && (
        <div className="fixed inset-0 z-[130] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#0e0518] border border-purple-500/40 rounded-3xl max-w-4xl w-full p-6 md:p-8 space-y-6 shadow-[0_0_60px_rgba(168,85,247,0.3)] relative max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <button
              onClick={() => setActiveRosterCampaign(null)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                <Layers className="w-3.5 h-3.5 text-purple-400" /> CAMPAIGN ROSTER & COMPLIANCE
              </div>
              <h3 className="text-2xl font-bold text-white">{activeRosterCampaign.title}</h3>
              <p className="text-xs text-slate-400">
                Category: <strong>{activeRosterCampaign.category}</strong> | Amount per member:{' '}
                <strong className="text-white">₹{activeRosterCampaign.amount} INR</strong>
              </p>
            </div>

            {/* Roster Toolbar */}
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-surface-container-lowest/60 p-3 rounded-2xl border border-white/5">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter roster by member name, reg no or email..."
                  value={rosterSearch}
                  onChange={(e) => setRosterSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto justify-between">
                <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10 text-xs">
                  {['All', 'Paid', 'Pending'].map((st) => (
                    <button
                      key={st}
                      onClick={() => setRosterStatusFilter(st)}
                      className={`px-3 py-1 rounded-lg font-bold transition-all ${
                        rosterStatusFilter === st ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => handleExportCSV(activeRosterCampaign.title, true)}
                  className="px-3 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Download Paid CSV</span>
                </button>
              </div>
            </div>

            {/* Roster Table */}
            <div className="overflow-y-auto flex-1 custom-scrollbar border border-white/10 rounded-2xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#180a2b] text-slate-400 font-semibold sticky top-0 border-b border-white/10">
                  <tr>
                    <th className="p-3.5">Member Name</th>
                    <th className="p-3.5">Registration No</th>
                    <th className="p-3.5">Email</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Payment Ref / Date</th>
                    <th className="p-3.5 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono text-slate-300">
                  {activeRosterCampaign.items
                    .filter((item) => {
                      const email = item.user_email ? item.user_email.toLowerCase() : '';
                      const member = membersMap.get(email);
                      const name = member ? member.name : '';
                      const regNo = member ? member.regNo : '';

                      const matchesSearch =
                        !rosterSearch.trim() ||
                        name.toLowerCase().includes(rosterSearch.toLowerCase()) ||
                        regNo.toLowerCase().includes(rosterSearch.toLowerCase()) ||
                        email.includes(rosterSearch.toLowerCase());

                      const matchesStatus =
                        rosterStatusFilter === 'All' ||
                        (rosterStatusFilter === 'Paid' && item.status === 'Paid') ||
                        (rosterStatusFilter === 'Pending' && (item.status === 'Pending' || item.status === 'Processing'));

                      return matchesSearch && matchesStatus;
                    })
                    .map((item) => {
                      const email = item.user_email ? item.user_email.toLowerCase() : '';
                      const member = membersMap.get(email);
                      const name = member ? member.name : 'Unknown Member';
                      const regNo = member ? member.regNo : 'N/A';

                      return (
                        <tr key={item.id} className="hover:bg-white/5 transition-colors">
                          <td className="p-3.5 font-sans font-bold text-white">{name}</td>
                          <td className="p-3.5 text-purple-300 font-semibold">{regNo}</td>
                          <td className="p-3.5 text-slate-400">{email}</td>
                          <td className="p-3.5 font-sans">{renderStatusBadge(paymentStatusToString(item.status))}</td>
                          <td className="p-3.5 text-right">
                            {item.status === 'Paid' && item.paid_at ? (
                              <div className="text-[11px] text-emerald-400 font-mono">
                                <div>{item.razorpay_payment_id || 'Paid'}</div>
                                <div className="text-[9px] text-slate-400">
                                  {new Date(item.paid_at).toLocaleDateString('en-IN')}
                                </div>
                              </div>
                            ) : (
                              <span className="text-amber-400 text-[11px]">Unpaid</span>
                            )}
                          </td>
                          <td className="p-3.5 text-center">
                            <button
                              onClick={() => handleDeletePayment(item.id)}
                              title="Delete record"
                              className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setActiveRosterCampaign(null)}
                className="px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-all"
              >
                Close Roster
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Helper type function */}
      {/* Receipt Modal */}
      {receiptModalPayment && (
        <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#0e0518] border border-emerald-500/40 rounded-3xl max-w-lg w-full p-6 md:p-8 space-y-6 shadow-[0_0_50px_rgba(16,185,129,0.2)] relative">
            <button
              onClick={() => setReceiptModalPayment(null)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-2xl font-black text-white">Payment Receipt</h3>
              <p className="text-xs text-emerald-400 font-semibold">Payment Confirmed & Synchronized with Supabase</p>
            </div>

            <div className="space-y-3 bg-surface-container-lowest/80 border border-white/10 rounded-2xl p-4 text-xs">
              <div className="flex justify-between py-1.5 border-b border-white/5">
                <span className="text-slate-400">Payment Title</span>
                <span className="text-white font-bold">{receiptModalPayment.title}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-white/5">
                <span className="text-slate-400">Payer Email</span>
                <span className="text-purple-300 font-mono">{receiptModalPayment.user_email || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-white/5">
                <span className="text-slate-400">Category</span>
                <span className="text-purple-300 font-semibold">{receiptModalPayment.category}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-white/5">
                <span className="text-slate-400">Amount Paid</span>
                <span className="text-emerald-400 font-extrabold text-sm">
                  ₹{Number(receiptModalPayment.amount).toLocaleString('en-IN')} INR
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-white/5">
                <span className="text-slate-400">Razorpay Payment ID</span>
                <span className="text-slate-200 font-mono">{receiptModalPayment.razorpay_payment_id || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-white/5">
                <span className="text-slate-400">Razorpay Order ID</span>
                <span className="text-slate-200 font-mono">{receiptModalPayment.razorpay_order_id || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-400">Timestamp</span>
                <span className="text-slate-300 font-mono">
                  {receiptModalPayment.paid_at
                    ? new Date(receiptModalPayment.paid_at).toLocaleString('en-IN')
                    : 'N/A'}
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => window.print()}
                className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Print Receipt</span>
              </button>
              <button
                onClick={() => setReceiptModalPayment(null)}
                className="flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-all"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Assign Due to Single Member Modal */}
      {showCreateModal && isAdminState && (
        <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <form
            onSubmit={handleCreatePayment}
            className="bg-[#0e0518] border border-amber-500/40 rounded-3xl max-w-md w-full p-6 md:p-8 space-y-5 shadow-[0_0_50px_rgba(245,158,11,0.2)] relative"
          >
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                <UserCheck className="w-3 h-3" /> SINGLE MEMBER DUE
              </div>
              <h3 className="text-xl font-bold text-white">Assign Payment Due to Member</h3>
              <p className="text-xs text-slate-400">Select a registered crew member or type a custom email.</p>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Select Registered Member *</label>
                <select
                  value={selectedMemberEmail}
                  onChange={(e) => handleSelectMemberInModal(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0a0315] border border-white/10 text-white focus:outline-none focus:border-amber-500 [&>option]:bg-[#130828] [&>option]:text-white"
                >
                  <option value="" className="bg-[#130828] text-slate-300">-- Choose Member from Directory ({membersList.length}) --</option>
                  {membersList.map((m) => (
                    <option key={m.email} value={m.email} className="bg-[#130828] text-white">
                      {m.name} ({m.regNo}) - {m.email} [{m.team}]
                    </option>
                  ))}
                  <option value="custom" className="bg-[#130828] text-amber-300">-- Type Custom Email --</option>
                </select>
              </div>

              {(selectedMemberEmail === 'custom' || !selectedMemberEmail) && (
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Member Email Address *</label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. member.24bcg10003@vitbhopal.ac.in"
                    value={targetEmail}
                    onChange={(e) => setTargetEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Payment Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. VRGC Membership Fee 2026"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Amount (₹ INR) *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="500"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0a0315] border border-white/10 text-white focus:outline-none focus:border-amber-500 [&>option]:bg-[#130828] [&>option]:text-white"
                  >
                    <option value="Club Fee" className="bg-[#130828]">Club Fee</option>
                    <option value="Event Registration" className="bg-[#130828]">Event Registration</option>
                    <option value="Merchandise" className="bg-[#130828]">Merchandise</option>
                    <option value="Fine" className="bg-[#130828]">Fine</option>
                    <option value="Other" className="bg-[#130828]">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Due Date</label>
                <input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Brief description of this payment requirement..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 resize-none"
                />
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="flex-1 py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all flex items-center justify-center gap-2"
              >
                {creating ? 'Assigning...' : 'Assign Payment Due'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Admin Assign Due to ALL Registered Members Modal */}
      {showAssignAllModal && isAdminState && (
        <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <form
            onSubmit={handleAssignToAllMembers}
            className="bg-[#0e0518] border border-amber-500/50 rounded-3xl max-w-md w-full p-6 md:p-8 space-y-5 shadow-[0_0_60px_rgba(245,158,11,0.3)] relative"
          >
            <button
              type="button"
              onClick={() => setShowAssignAllModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                <Megaphone className="w-3.5 h-3.5 text-amber-400" /> BROADCAST TO ALL {membersList.length} MEMBERS
              </div>
              <h3 className="text-xl font-bold text-white">Assign Due to ALL Crew Members</h3>
              <p className="text-xs text-slate-400">
                This action will generate a payment due for all <strong className="text-amber-300">{membersList.length} registered members</strong>.
              </p>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Broadcast Payment Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. VRGC Annual Club Fee 2026"
                  value={allTitle}
                  onChange={(e) => setAllTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Amount (₹ INR per member) *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="500"
                    value={allAmount}
                    onChange={(e) => setAllAmount(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Category</label>
                  <select
                    value={allCategory}
                    onChange={(e) => setAllCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0a0315] border border-white/10 text-white focus:outline-none focus:border-amber-500 [&>option]:bg-[#130828] [&>option]:text-white"
                  >
                    <option value="Club Fee" className="bg-[#130828]">Club Fee</option>
                    <option value="Event Registration" className="bg-[#130828]">Event Registration</option>
                    <option value="Merchandise" className="bg-[#130828]">Merchandise</option>
                    <option value="Fine" className="bg-[#130828]">Fine</option>
                    <option value="Other" className="bg-[#130828]">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Due Date</label>
                <input
                  type="date"
                  value={allDueDate}
                  onChange={(e) => setAllDueDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Mandatory annual membership dues for all VRGC crew members..."
                  value={allDescription}
                  onChange={(e) => setAllDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 resize-none"
                />
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={() => setShowAssignAllModal(false)}
                className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={assigningAll}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-bold text-xs shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all flex items-center justify-center gap-2"
              >
                {assigningAll ? `Assigning to ${membersList.length}...` : `Assign to ALL (${membersList.length})`}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

// Helper converter
function paymentStatusToString(status: PaymentStatus): PaymentStatus {
  return status;
}

export default Payments;
