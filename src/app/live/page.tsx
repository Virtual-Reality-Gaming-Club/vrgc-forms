import { redirect } from 'next/navigation';

export default function LiveRedirect() {
  redirect('/?tab=live_admin');
}

