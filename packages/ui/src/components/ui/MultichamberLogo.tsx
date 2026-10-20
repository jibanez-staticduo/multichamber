import React from 'react';
import brand from '@/assets/multichamber-brand.png';
import { useI18n } from '@/lib/i18n';
import { useWaitingPhase } from '@/hooks/useDurationTicker';
import { cn } from '@/lib/utils';

interface MultichamberLogoProps {
  className?: string;
  width?: number;
  height?: number;
  isAnimated?: boolean;
  variant?: 'default' | 'splash';
}

export const MultichamberLogo: React.FC<MultichamberLogoProps> = ({
  className,
  width = 70,
  height = 70,
  isAnimated = false,
}) => {
  const { t } = useI18n();
  const dimmed = useWaitingPhase(isAnimated, 2) === 1;
  return <img
    src={brand}
    alt={t('multichamberLogo.aria.logo')}
    width={width}
    height={height}
    draggable={false}
    className={cn('object-contain', dimmed && 'opacity-60', className)}
  />;
};
