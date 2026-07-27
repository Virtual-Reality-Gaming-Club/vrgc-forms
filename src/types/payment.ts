export type PaymentStatus = 'Pending' | 'Paid' | 'Failed' | 'Cancelled' | 'Processing';

export type PaymentCategory = 'Club Fee' | 'Event Registration' | 'Merchandise' | 'Fine' | 'Other';

export interface PaymentItem {
  id: string;
  user_id?: string;
  user_email?: string;
  title: string;
  description?: string;
  category: PaymentCategory | string;
  amount: number; // in INR
  currency: string;
  status: PaymentStatus;
  due_date?: string;
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
  payment_method?: string;
  paid_at?: string;
  created_at: string;
  updated_at?: string;
}

export interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}
