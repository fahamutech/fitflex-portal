'use client';
import { ChallengeManager } from '@/components/challenge-manager';

export default function HrChallengesPage() {
  return (
    <ChallengeManager
      scope="corporate"
      title="Wellness challenges"
      description="Challenges for your employees. You see participation, completion and team or department progress, never anyone's personal activity."
    />
  );
}
