import { describe, expect, it } from 'vitest';
import { contrastRatio, evaluateA11yMeasurement, a11yMeasurementScript } from '../../src/main/design-a11y';

const selection = { projectId: 'p', selectionId: 's', selector: 'button#save', sourceUrl: 'http://127.0.0.1:5173/' };

describe('bounded live design accessibility measurement', () => {
  it('calculates opaque RGB contrast and leaves unsupported colors unknown', () => {
    expect(contrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)')).toBe(21);
    expect(contrastRatio('rgb(119, 119, 119)', 'rgb(255, 255, 255)')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('rgba(0, 0, 0, 0.5)', 'rgb(255, 255, 255)')).toBeNull();
    expect(contrastRatio('rgb(300, 0, 0)', 'rgb(255, 255, 255)')).toBeNull();
    expect(contrastRatio('red', 'white')).toBeNull();
  });

  it('reports measured values and flags only defined reference thresholds', () => {
    const report = evaluateA11yMeasurement(selection, { found: true, tag: 'button', text: true, foreground: 'rgb(119, 119, 119)', background: 'rgb(255, 255, 255)', interactive: true, width: 23.5, height: 30 });
    expect(report.contrast).toMatchObject({ belowBodyTextReference: true, reason: null });
    expect(report.contrast.ratio).toBeCloseTo(4.48, 2);
    expect(report.target).toMatchObject({ width: 23.5, height: 30, belowSizeReference: true });
    expect(report.sourceUrl).toBe(selection.sourceUrl);
    expect(Number.isNaN(Date.parse(report.checkedAt))).toBe(false);
  });

  it('leaves effects, missing text and noninteractive elements unclassified', () => {
    const uncertain = evaluateA11yMeasurement(selection, { found: true, text: true, foreground: 'rgb(0, 0, 0)', background: 'rgb(255, 255, 255)', backgroundUnknown: true, interactive: false, width: 2, height: 2 });
    expect(uncertain.contrast.ratio).toBeNull();
    expect(uncertain.contrast.reason).toContain('Bild');
    expect(uncertain.target).toEqual({ interactive: false, width: null, height: null, belowSizeReference: null });
    expect(evaluateA11yMeasurement(selection, { found: true, text: false, interactive: true, width: 44, height: 44 }).contrast.ratio).toBeNull();
    expect(() => evaluateA11yMeasurement(selection, { found: false })).toThrow('nicht mehr vorhanden');
  });

  it('escapes the selector as a JavaScript literal', () => {
    const script = a11yMeasurementScript('button#save";throw new Error("injected")//');
    expect(script).toContain('document.querySelector("button#save\\\";throw new Error(\\\"injected\\\")//")');
  });
});
