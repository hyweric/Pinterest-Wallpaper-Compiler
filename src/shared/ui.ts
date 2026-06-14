export interface TooltipAnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface TooltipViewport {
  width: number;
  height: number;
}

export interface TooltipPosition {
  left: number;
  top: number;
  placement: "top" | "bottom";
}

export function placeTooltip(
  rect: TooltipAnchorRect,
  viewport: TooltipViewport,
  estimatedWidth = 180,
  gap = 8
): TooltipPosition {
  const margin = 12;
  const halfWidth = Math.min(Math.max(estimatedWidth, 80), Math.max(80, viewport.width - margin * 2)) / 2;
  const center = rect.left + rect.width / 2;
  const left = Math.max(margin + halfWidth, Math.min(viewport.width - margin - halfWidth, center));
  const placement = rect.top >= 54 ? "top" : "bottom";
  return {
    left,
    top: placement === "top" ? rect.top - gap : rect.bottom + gap,
    placement
  };
}
