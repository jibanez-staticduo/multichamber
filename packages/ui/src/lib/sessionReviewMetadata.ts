import type { Metadata, Session } from '@/lib/opencode/model';

export type SessionMetadataRecord = Metadata;

type MultichamberMetadata = {
  kind?: 'review';
  originalSessionID?: string;
  reviewSessionID?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const getSessionMetadata = (session: Session | null | undefined): SessionMetadataRecord => (
  session?.metadata ?? {}
);

const getMultichamberMetadata = (metadata: SessionMetadataRecord): MultichamberMetadata => {
  const value = metadata.openchamber;
  return isRecord(value) ? value as MultichamberMetadata : {};
};

export const getReviewSessionID = (session: Session | null | undefined): string | null => {
  const value = getMultichamberMetadata(getSessionMetadata(session)).reviewSessionID;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

export const getOriginalSessionID = (session: Session | null | undefined): string | null => {
  const value = getMultichamberMetadata(getSessionMetadata(session)).originalSessionID;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

export const isReviewSession = (session: Session | null | undefined): boolean =>
  getMultichamberMetadata(getSessionMetadata(session)).kind === 'review' && Boolean(getOriginalSessionID(session));

export const withReviewSessionLink = (
  metadata: SessionMetadataRecord,
  reviewSessionID: string,
): SessionMetadataRecord => {
  const current = getMultichamberMetadata(metadata);
  return {
    ...metadata,
    openchamber: {
      ...current,
      reviewSessionID,
    },
  };
};

export const withReviewSessionMarker = (
  metadata: SessionMetadataRecord,
  originalSessionID: string,
): SessionMetadataRecord => {
  const current = getMultichamberMetadata(metadata);
  return {
    ...metadata,
    openchamber: {
      ...current,
      kind: 'review' as const,
      originalSessionID,
    },
  };
};

export const withoutReviewSessionLink = (
  metadata: SessionMetadataRecord,
  reviewSessionID: string,
): SessionMetadataRecord => {
  const current = getMultichamberMetadata(metadata);
  if (current.reviewSessionID !== reviewSessionID) return metadata;

  const restMultichamber = { ...current };
  delete restMultichamber.reviewSessionID;
  const next: SessionMetadataRecord = { ...metadata };
  if (Object.keys(restMultichamber).length > 0) {
    next.openchamber = restMultichamber;
  } else {
    delete next.openchamber;
  }
  return next;
};
