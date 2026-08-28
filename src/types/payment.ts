export type PaymentStatus = 'Pending' | 'Paid' | 'Failed' | 'Cancelled' | 'Processing' | 'Expired';

export type PaymentCategory = 'Club Fee' | 'Event Registration' | 'Merchandise' | 'Fine' | 'Other';

export interface PaymentItem {
  id: string;
  user_id?: string;
  user_email?: string;
  candidate_name?: string;
  registration_number?: string;
  team?: string;
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
  razorpay_vpa?: string;
  razorpay_bank?: string;
  razorpay_wallet?: string;
  razorpay_contact?: string;
  error_description?: string;
  paid_at?: string;
  failed_at?: string;
  visible_to_faculty?: boolean;
  created_at: string;
  updated_at?: string;
}

export interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}
