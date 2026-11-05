import { Redirect } from 'expo-router';
import { homeRoute } from '@/lib/features';
import { useSession } from '@/lib/session';

export default function Index() {
  const { me, access } = useSession();
  if (!me) return <Redirect href="/login" />;
  return <Redirect href={homeRoute(me.user.role, access) as never} />;
}
