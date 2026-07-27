-- Supabase SQL Migration Script for VRGC Payments Module
-- Execute this script in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT,
    user_email TEXT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'Club Fee',
    amount NUMERIC NOT NULL CHECK (amount >= 0),
    currency TEXT DEFAULT 'INR',
    status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Paid', 'Failed', 'Cancelled', 'Processing')),
    due_date TIMESTAMPTZ,
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    razorpay_signature TEXT,
    payment_method TEXT,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast user payments query
CREATE INDEX IF NOT EXISTS idx_payments_user_email ON public.payments(user_email);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_order ON public.payments(razorpay_order_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Allow public read access to payments
CREATE POLICY "Allow public read payments"
ON public.payments
FOR SELECT
USING (true);

-- Allow insert/update operations for payments
CREATE POLICY "Allow insert/update payments"
ON public.payments
FOR ALL
USING (true)
WITH CHECK (true);

-- ─── Transactions Table ───────────────────────────────────────────────────────
-- Stores a log of every payment attempt (successful, failed, or pending)
-- SAFE: Uses CREATE TABLE IF NOT EXISTS — won't alter existing data

CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    user_email TEXT NOT NULL,
    payment_title TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    currency TEXT DEFAULT 'INR',
    status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Paid', 'Failed', 'Cancelled', 'Processing')),
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    razorpay_signature TEXT,
    payment_method TEXT DEFAULT 'Razorpay Online',
    error_description TEXT,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for transaction queries
CREATE INDEX IF NOT EXISTS idx_transactions_user_email ON public.transactions(user_email);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_payment_id ON public.transactions(payment_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON public.transactions(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Policy: public read (admin will filter in app layer)
CREATE POLICY "Allow public read transactions"
ON public.transactions
FOR SELECT
USING (true);

-- Policy: allow insert/update
CREATE POLICY "Allow insert/update transactions"
ON public.transactions
FOR ALL
USING (true)
WITH CHECK (true);
