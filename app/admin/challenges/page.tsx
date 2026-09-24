'use client';
import { ChallengeManager } from '@/components/challenge-manager';

export default function AdminChallengesPage() {
  return (
    <ChallengeManager
      scope="admin"
      title="Challenges"
      description="FitFlex challenges for members: create, edit, monitor participation and completion, close and archive. Totals only."
    />
  );
}
