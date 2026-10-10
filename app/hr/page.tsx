'use client';
import { ChallengeManager } from '@/components/challenge-manager';

export default function HrChallengesPage() {
  return (
    <ChallengeManager
      scope="corporate"
      title="Wellness challenges"
      description="Challenges for your employees. This page shows participation, completion and team or department progress; each person's progress is under Insights."
    />
  );
}
