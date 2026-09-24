'use client';
import { RewardQueue } from '@/components/reward-queue';

export default function AdminRewardsPage() {
  return (
    <RewardQueue
      scope="admin"
      title="Rewards"
      description="Challenge rewards members have earned, funded by FitFlex or a partner (and trainer and gym challenges). Approve, then mark issued once handed over."
    />
  );
}
