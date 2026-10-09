import { redirect } from 'next/navigation';

export default function AdminLiveRedirect() {
  redirect('/?tab=live_admin');
}

