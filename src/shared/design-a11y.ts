export interface DesignA11yCheck {
  projectId: string;
  selectionId: string;
  selector: string;
  sourceUrl: string;
  checkedAt: string;
  contrast: {
    ratio: number | null;
    foreground: string | null;
    background: string | null;
    belowBodyTextReference: boolean | null;
    reason: string | null;
  };
  target: {
    interactive: boolean;
    width: number | null;
    height: number | null;
    belowSizeReference: boolean | null;
  };
}
