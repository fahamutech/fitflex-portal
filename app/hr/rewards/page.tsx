'use client';
import { RewardQueue } from '@/components/reward-queue';

export default function HrRewardsPage() {
  return (
    <RewardQueue
      scope="corporate"
      title="Rewards"
      description="Company-funded rewards your employees have earned. Approve, then mark issued once handed over. Rewards FitFlex funds are handed out by FitFlex."
    />
  );
}
