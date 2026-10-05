'use client';
import { useApp } from '../providers';
import { ChallengeManager } from '@/components/challenge-manager';

export default function HrChallengesPage() {
  const { t } = useApp();
  return (
    <ChallengeManager
      scope="corporate"
      title={t('hr.nav.challenges')}
      description={t('org.challenges.hr.description')}
    />
  );
}
