'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from './providers';
import { homeFor } from '@/components/Shell';

export default function Home() {
  const { ready, token, user } = useApp();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    router.replace(token ? homeFor(user) : '/login');
  }, [ready, token, user, router]);
  return null;
}
