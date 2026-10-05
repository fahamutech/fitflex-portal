'use client';
import { useApp } from '../../providers';
import { RewardQueue } from '@/components/reward-queue';

export default function HrRewardsPage() {
  const { t } = useApp();
  return (
    <RewardQueue
      scope="corporate"
      title={t('hr.nav.rewards')}
      description={t('org.rewards.hr.description')}
    />
  );
}
