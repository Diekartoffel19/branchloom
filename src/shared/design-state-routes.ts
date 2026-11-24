export type DesignStateKind = 'normal' | 'loading' | 'empty' | 'error';

export interface DesignStateRoute {
  projectId: string;
  kind: DesignStateKind;
  url: string;
  updatedAt: string;
}

export interface DesignStateRouteInput {
  projectId: string;
  kind: DesignStateKind;
  url: string;
}

export interface DesignStateRouteKey {
  projectId: string;
  kind: DesignStateKind;
}
