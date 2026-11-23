export type OutputErrorSourceKind = 'session' | 'command';
export interface OutputErrorCandidate { id: string; line: number; message: string }
export interface OutputErrorPreview { sourceKind: OutputErrorSourceKind; sourceId: string; sourceLabel: string; endedAt: string; candidates: OutputErrorCandidate[] }
export interface CreateOutputErrorCard { projectId: string; sourceKind: OutputErrorSourceKind; sourceId: string; candidateId: string; columnId: string; reproduction: string }
