import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const titleFilter = searchParams.get('title');

    let query = supabase
      .from('payments')
      .select('*')
      .order('paid_at', { ascending: false });

    if (titleFilter) {
      query = query.eq('title', titleFilter);
    }

    const { data: paymentsData, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const payments = paymentsData || [];

    // Construct CSV Header
    const headers = [
      'Payer Email',
      'Payment Title',
      'Category',
      'Amount (INR)',
      'Status',
      'Paid At',
      'Razorpay Payment ID',
      'Razorpay Order ID',
      'Created At',
    ];

    // Format Rows
    const rows = payments.map((p) => [
      `"${p.user_email || ''}"`,
      `"${(p.title || '').replace(/"/g, '""')}"`,
      `"${p.category || ''}"`,
      p.amount,
      p.status,
      `"${p.paid_at ? new Date(p.paid_at).toLocaleString('en-IN') : ''}"`,
      `"${p.razorpay_payment_id || ''}"`,
      `"${p.razorpay_order_id || ''}"`,
      `"${p.created_at ? new Date(p.created_at).toLocaleString('en-IN') : ''}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const fileName = titleFilter
      ? `VRGC_Payments_${titleFilter.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.csv`
      : `VRGC_All_Payments_${Date.now()}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'CSV Export failed' }, { status: 500 });
  }
}
