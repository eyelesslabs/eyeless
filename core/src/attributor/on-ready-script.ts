/**
 * BackstopJS onReadyScript — receives the raw Playwright page object.
 * Captures a style snapshot of all visible elements and writes it to disk.
 *
 * BackstopJS calls: require(scriptPath)(page, scenario, viewport, isReference, browserContext, config)
 * See runPlaywright.js line 196.
 */
import * as fs from 'fs';
import * as path from 'path';
import { TRACKED_PROPERTIES, SVG_ATTRIBUTES, sanitizeLabel } from './styles';
import { ElementStyleSnapshot, StyleSnapshot } from '../types';

/**
 * The onReadyScript entry point. BackstopJS passes the Playwright page object directly.
 */
module.exports = async function onReadyScript(
  page: any,
  scenario: any,
  viewport: any,
  isReference: boolean,
  _browserContext: any,
  _config: any,
) {
  // --- Execute interactions in order before capture ---
  const eyelessInteractions: any[] = scenario.eyelessInteractions || [];
  for (const interaction of eyelessInteractions) {
    switch (interaction.type) {
      case 'click':
        if (interaction.selector) {
          await page.click(interaction.selector);
        }
        break;
      case 'hover':
        if (interaction.selector) {
          await page.hover(interaction.selector);
        }
        break;
      case 'type':
        if (interaction.selector && interaction.value) {
          await page.fill(interaction.selector, interaction.value);
        }
        break;
      case 'scroll':
        if (interaction.selector) {
          const el = await page.$(interaction.selector);
          if (el) await el.scrollIntoViewIfNeeded();
        }
        break;
      case 'evaluate':
        if (interaction.expression) {
          await page.evaluate(interaction.expression);
        }
        break;
    }
  }

  // --- Execute wait strategies ---
  const eyelessWaitFor: any[] = scenario.eyelessWaitFor || [];
  for (const wait of eyelessWaitFor) {
    switch (wait.type) {
      case 'selector':
        if (wait.selector) {
          await page.waitForSelector(wait.selector, { state: 'visible', timeout: 30000 });
        }
        break;
      case 'timeout':
        if (wait.timeout && wait.timeout > 0) {
          await page.waitForTimeout(Math.min(wait.timeout, 30000));
        }
        break;
      case 'animations':
        // Wait until no CSS animations/transitions are running (max 10s)
        await page.evaluate(() => {
          return new Promise<void>((resolve) => {
            const deadline = Date.now() + 10000;
            const check = () => {
              if (Date.now() > deadline) {
                resolve();
                return;
              }
              const all = document.querySelectorAll('*');
              for (const el of Array.from(all)) {
                const anims = (el as any).getAnimations?.();
                if (anims && anims.length > 0) {
                  requestAnimationFrame(check);
                  return;
                }
              }
              resolve();
            };
            check();
          });
        });
        break;
      case 'cssClass':
        if (wait.selector && wait.className) {
          const sel = wait.selector;
          const cls = wait.className;
          await page.waitForFunction(
            ({ sel, cls }: { sel: string; cls: string }) => {
              const el = document.querySelector(sel);
              return el && el.classList.contains(cls);
            },
            { sel, cls },
            { timeout: 30000 },
          );
        }
        break;
    }
  }

  // Disable all animations and transitions for deterministic captures
  await page.addStyleTag({
    content: `*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}`,
  });

  const trackedProps = [...TRACKED_PROPERTIES];
  const svgAttrs = [...SVG_ATTRIBUTES];

  // page.evaluate with a string expression executes it in the browser context.
  // Playwright serializes the arguments and the function body safely.
  const elements: ElementStyleSnapshot[] = await page.evaluate(
    ({ props, svgAttrList }: { props: string[]; svgAttrList: string[] }) => {
      const results: any[] = [];
      const seen = new Set();

      /** Confidence levels for selector strategies */
      const CONFIDENCE_ID = 1.0;
      const CONFIDENCE_TESTID = 1.0;
      const CONFIDENCE_UNIQUE_CLASS = 0.8;
      const CONFIDENCE_PATH = 0.6;
      const CONFIDENCE_AMBIGUOUS = 0.4;

      interface SelectorResult {
        selector: string;
        confidence: number;
      }

      function generateSelectorForElement(el: any, shadowHostPath?: string): SelectorResult {
        const prefix = shadowHostPath ? shadowHostPath + '::shadow ' : '';

        if (el.id) {
          const sel = prefix + '#' + CSS.escape(el.id);
          return { selector: sel, confidence: CONFIDENCE_ID };
        }

        const testId = el.getAttribute('data-testid');
        if (testId) {
          const sel = prefix + '[data-testid="' + testId + '"]';
          return { selector: sel, confidence: CONFIDENCE_TESTID };
        }

        // Try unique class within the element's root (document or shadow root)
        const root = el.getRootNode();
        for (const cls of Array.from(el.classList) as string[]) {
          const escapedCls = CSS.escape(cls);
          const matches = root.querySelectorAll('.' + escapedCls);
          if (matches.length === 1) {
            return { selector: prefix + '.' + escapedCls, confidence: CONFIDENCE_UNIQUE_CLASS };
          }
        }

        // Build a path-based selector
        const parts: string[] = [];
        let current: any = el;
        const rootEl = root === document ? document.documentElement : (root as any).host || root;
        while (current && current !== rootEl && current !== document.documentElement) {
          const tag = current.tagName.toLowerCase();
          if (current.id) {
            parts.unshift('#' + CSS.escape(current.id));
            break;
          }
          const parent = current.parentElement || (current.parentNode !== root ? current.parentNode : null);
          if (parent && parent.children) {
            const siblings = Array.from(parent.children).filter((c: any) => c.tagName === current.tagName);
            if (siblings.length > 1) {
              parts.unshift(tag + ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')');
            } else {
              parts.unshift(tag);
            }
          } else {
            parts.unshift(tag);
          }
          current = parent;
        }

        const pathSelector = prefix + parts.join(' > ');

        // Check if path selector is ambiguous
        try {
          const matchCount = root.querySelectorAll(parts.join(' > ')).length;
          if (matchCount > 1) {
            return { selector: pathSelector, confidence: CONFIDENCE_AMBIGUOUS };
          }
        } catch {
          // querySelectorAll may fail on complex selectors; treat as ambiguous
          return { selector: pathSelector, confidence: CONFIDENCE_AMBIGUOUS };
        }

        return { selector: pathSelector, confidence: CONFIDENCE_PATH };
      }

      function isSVGElement(el: any): boolean {
        return el instanceof SVGElement && !(el instanceof SVGSVGElement && el.ownerSVGElement === null && el.parentElement?.tagName !== 'svg');
      }

      function captureElement(el: any, shadowHostPath?: string): void {
        if (seen.has(el)) return;
        seen.add(el);

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        if (rect.bottom < 0 || rect.right < 0) return;

        const computed = window.getComputedStyle(el);
        if (computed.display === 'none' || computed.visibility === 'hidden') return;

        const styles: Record<string, string> = {};
        for (const prop of props) {
          const value = computed.getPropertyValue(prop);
          if (value && value !== '' && value !== 'none' && value !== 'normal' && value !== 'auto') {
            styles[prop] = value;
          }
        }

        // Capture SVG attributes for SVG elements
        let svgAttributes: Record<string, string> | undefined;
        if (el instanceof SVGElement) {
          svgAttributes = {};
          for (const attr of svgAttrList) {
            const val = el.getAttribute(attr);
            if (val !== null && val !== '') {
              svgAttributes[attr] = val;
            }
          }
          if (Object.keys(svgAttributes).length === 0) {
            svgAttributes = undefined;
          }
        }

        if (Object.keys(styles).length === 0 && !svgAttributes) return;

        const { selector, confidence } = generateSelectorForElement(el, shadowHostPath);

        const entry: any = {
          selector,
          tagName: el.tagName.toLowerCase(),
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          computedStyles: styles,
          selectorConfidence: confidence,
        };

        if (svgAttributes) {
          entry.svgAttributes = svgAttributes;
        }

        results.push(entry);

        // Capture pseudo-elements (::before and ::after)
        for (const pseudo of ['::before', '::after'] as const) {
          const pseudoComputed = window.getComputedStyle(el, pseudo);
          const content = pseudoComputed.getPropertyValue('content');
          // Only capture if the pseudo-element has non-empty, non-none content
          if (!content || content === 'none' || content === 'normal' || content === '""' || content === "''") {
            continue;
          }

          const pseudoStyles: Record<string, string> = {};
          for (const prop of props) {
            const value = pseudoComputed.getPropertyValue(prop);
            if (value && value !== '' && value !== 'none' && value !== 'normal' && value !== 'auto') {
              pseudoStyles[prop] = value;
            }
          }
          // Always include content for pseudo-elements
          pseudoStyles['content'] = content;

          if (Object.keys(pseudoStyles).length === 0) continue;

          results.push({
            selector: selector + pseudo,
            tagName: el.tagName.toLowerCase() + pseudo,
            boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            computedStyles: pseudoStyles,
            selectorConfidence: confidence,
          });
        }
      }

      function traverseElements(root: any, shadowHostPath?: string): void {
        const allElements = root.querySelectorAll('*');
        for (const el of Array.from(allElements)) {
          captureElement(el, shadowHostPath);

          // Traverse into open shadow DOMs
          if ((el as any).shadowRoot) {
            const { selector: hostSelector } = generateSelectorForElement(el, shadowHostPath);
            traverseElements((el as any).shadowRoot, hostSelector);
          }
        }
      }

      // Start traversal from document body
      traverseElements(document.body);

      return results;
    },
    { props: trackedProps, svgAttrList: svgAttrs },
  );

  const snapshot: StyleSnapshot = {
    url: scenario.url || page.url(),
    viewport: {
      label: viewport.label || 'default',
      width: viewport.width || 1920,
      height: viewport.height || 1080,
    },
    timestamp: new Date().toISOString(),
    elements,
  };

  // Store snapshot in a known location for the check/capture flow to pick up
  const snapshotDir = process.env.EYELESS_SNAPSHOT_DIR;
  if (snapshotDir) {
    const scenarioLabel = sanitizeLabel(scenario.label || 'default');
    const viewportLabel = sanitizeLabel(viewport.label || 'default');
    const filename = `${scenarioLabel}_${viewportLabel}.json`;
    const filepath = path.join(snapshotDir, isReference ? 'reference' : 'test', filename);

    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2));
  }
};
