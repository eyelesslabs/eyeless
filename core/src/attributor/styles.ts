/**
 * CSS properties we track for style snapshots.
 * Focused on visual properties that affect layout and appearance.
 */
export const TRACKED_PROPERTIES = [
  // Box model
  'width', 'height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-radius',

  // Layout
  'display', 'position', 'top', 'right', 'bottom', 'left',
  'flex-direction', 'justify-content', 'align-items', 'gap',
  'grid-template-columns', 'grid-template-rows',

  // Visual
  'background-color', 'color', 'opacity',
  'font-family', 'font-size', 'font-weight', 'line-height', 'text-align',
  'box-shadow', 'text-shadow',

  // Transform
  'transform', 'transform-origin',

  // SVG
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
  'stroke-linejoin', 'stroke-opacity', 'fill-opacity',

  // Visibility
  'visibility', 'overflow', 'z-index',
] as const;

/**
 * SVG-specific attributes that are not exposed via getComputedStyle
 * and must be read directly from the element.
 */
export const SVG_ATTRIBUTES = [
  'd', 'r', 'cx', 'cy', 'rx', 'ry', 'x', 'y', 'width', 'height',
  'viewBox', 'points', 'x1', 'y1', 'x2', 'y2',
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'fill-opacity',
  'opacity', 'transform',
] as const;

export type TrackedProperty = typeof TRACKED_PROPERTIES[number];
