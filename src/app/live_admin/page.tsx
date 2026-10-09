import { redirect } from 'next/navigation';

export default function LiveAdminRedirect() {
  redirect('/?tab=live_admin');
}

