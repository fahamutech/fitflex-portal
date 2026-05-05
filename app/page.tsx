'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from './providers';

export default function Home() {
  const { ready, token, user } = useApp();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    router.replace(token ? (user?.userType === 'admin' ? '/admin' : '/dashboard') : '/login');
  }, [ready, token, user, router]);
  return null;
}
