import { PerkieJump } from './PerkieJump';

interface PerkyJumpProps {
  apiUrl: string;
  telegramId?: string;
  onPointsEarned?: (points: number) => void;
}

export function PerkyJump({ apiUrl, telegramId, onPointsEarned }: PerkyJumpProps) {
  return (
    <PerkieJump
      apiUrl={apiUrl}
      telegramId={telegramId}
      onScoreSubmit={(_score, pointsAwarded) => {
        if (pointsAwarded > 0) {
          onPointsEarned?.(pointsAwarded);
        }
      }}
    />
  );
}
