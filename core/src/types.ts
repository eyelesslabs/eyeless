/** Core types for Eyeless */

export interface EyelessConfig {
  url: string;
  viewports: Viewport[];
  threshold: number;
  scenarios: ScenarioConfig[];
  ignore: IgnoreRule[];
  /** Maximum number of baseline versions to keep per scenario. Default: 20 */
  maxVersions?: number;
}

export interface Viewport {
  label: string;
  width: number;
  height: number;
}

export interface WaitStrategy {
  type: 'selector' | 'timeout' | 'animations' | 'cssClass';
  /** CSS selector to wait for (type: 'selector' or 'cssClass') */
  selector?: string;
  /** CSS class name to wait for on the selector (type: 'cssClass') */
  className?: string;
  /** Timeout in milliseconds (type: 'timeout') */
  timeout?: number;
}

export interface ScenarioConfig {
  label: string;
  url?: string;
  selectors?: string[];
  readySelector?: string;
  delay?: number;
  interactions?: Interaction[];
  waitFor?: WaitStrategy[];
}

export interface Interaction {
  type: 'click' | 'hover' | 'type' | 'scroll' | 'evaluate';
  selector: string;
  value?: string;
  /** JavaScript expression to execute in the page context (type: 'evaluate') */
  expression?: string;
}

export interface IgnoreRule {
  selector: string;
  reason?: string;
}

/** Style snapshot for a single element */
export interface ElementStyleSnapshot {
  selector: string;
  tagName: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  computedStyles: Record<string, string>;
  /** SVG attributes captured from the element (only for SVG elements) */
  svgAttributes?: Record<string, string>;
  /** Confidence in the selector's accuracy (0.0-1.0) */
  selectorConfidence?: number;
}

/** Full style snapshot for a page state */
export interface StyleSnapshot {
  url: string;
  viewport: Viewport;
  timestamp: string;
  elements: ElementStyleSnapshot[];
}

/** A single style drift on one element */
export interface StyleDrift {
  selector: string;
  tagName: string;
  property: string;
  baseline: string;
  current: string;
  /** Confidence in the selector match (0.0-1.0). Undefined for legacy snapshots. */
  confidence?: number;
}

/** Diff region from BackstopJS pixel comparison */
export interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Result of an eyeless_check call */
export interface CheckResult {
  status: 'pass' | 'drift' | 'error';
  matchPercentage: number;
  scenario: string;
  viewport: string;
  drifts: StyleDrift[];
  summary: string;
  referenceImage?: string;
  testImage?: string;
}

/** A single history entry (one check run) */
export interface HistoryEntry {
  timestamp: string;
  results: CheckResult[];
}

/** A version of a baseline snapshot */
export interface VersionEntry {
  timestamp: string;
  scenario: string;
  viewport: string;
  snapshotPath: string;
  bitmapPath?: string;
}

/** Result of an eyeless_capture call */
export interface CaptureResult {
  status: 'captured' | 'error';
  scenario: string;
  viewport: string;
  baselinePath: string;
  elementsCaptured: number;
  summary: string;
}
