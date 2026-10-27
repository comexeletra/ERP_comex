"use client";

import { cloneElement, createContext, type FocusEvent, type PointerEvent, type ReactElement, type ReactNode, useCallback,
  useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tooltipPosition, type TooltipPlacement } from "../lib/tooltip-position";

type Point = { x: number; y: number };
type Anchor = { owner: string; target: Element; placement: TooltipPlacement; point?: Point };
type Shown = { owner: string; content: ReactNode; container: Element };
type TooltipApi = {
  show: (anchor: Anchor, content: ReactNode, immediate: boolean) => void;
  move: (owner: string, point: Point) => void;
  refresh: (owner: string, content: ReactNode) => void;
  hide: (owner: string) => void;
};
type TriggerProps = {
  onPointerEnter?: (event: PointerEvent<Element>) => void; onPointerMove?: (event: PointerEvent<Element>) => void;
  onPointerLeave?: (event: PointerEvent<Element>) => void; onFocus?: (event: FocusEvent<Element>) => void;
  onBlur?: (event: FocusEvent<Element>) => void;
};

const TooltipContext = createContext<TooltipApi | null>(null);
const showDelay = 100;
const cursorGap = 12;

/**
 * Owner of the single tooltip box of the app, rendered in a portal on top of the page (or of the open
 * dialog). The box is placed directly on the DOM, so following the pointer does not re-render.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const tooltipId = useId();
  const box = useRef<HTMLDivElement>(null);
  const anchor = useRef<Anchor | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const place = useCallback(() => {
    const current = anchor.current;
    if (!box.current || !current) return;
    const rect = current.point ? { left: current.point.x, top: current.point.y, width: 0, height: 0 } : current.target.getBoundingClientRect();
    const { left, top } = tooltipPosition(rect, { width: box.current.offsetWidth, height: box.current.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight }, current.placement, current.point ? cursorGap : undefined);
    box.current.style.transform = `translate(${left}px, ${top}px)`;
  }, []);

  const hide = useCallback((owner: string) => {
    if (anchor.current?.owner !== owner) return;
    window.clearTimeout(timer.current);
    anchor.current.target.removeAttribute("aria-describedby");
    anchor.current = null;
    setShown(null);
  }, []);

  const show = useCallback((next: Anchor, content: ReactNode, immediate: boolean) => {
    window.clearTimeout(timer.current);
    anchor.current?.target.removeAttribute("aria-describedby");
    anchor.current = next;
    const open = () => {
      next.target.setAttribute("aria-describedby", tooltipId);
      setShown({ owner: next.owner, content, container: next.target.closest("dialog") ?? document.body });
    };
    // Moving from one trigger to the next while a tooltip is open shows the new one at once.
    if (immediate || box.current) open();
    else timer.current = window.setTimeout(open, showDelay);
  }, [tooltipId]);

  const move = useCallback((owner: string, point: Point) => {
    if (anchor.current?.owner !== owner) return;
    anchor.current.point = point;
    place();
  }, [place]);

  // Every trigger calls this after it renders; only the one on screen updates the box.
  const refresh = useCallback((owner: string, content: ReactNode) => {
    if (anchor.current?.owner !== owner) return;
    setShown(current => current?.owner === owner ? { ...current, content } : current);
  }, []);

  useLayoutEffect(place, [shown, place]);

  useEffect(() => {
    if (!shown) return;
    const close = () => hide(shown.owner);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    // Capture, so scrolling a table or a panel also closes it.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [shown, hide]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const api = useMemo(() => ({ show, move, refresh, hide }), [show, move, refresh, hide]);
  return <TooltipContext.Provider value={api}>
    {children}
    {shown && createPortal(<div ref={box} id={tooltipId} role="tooltip" className="tooltip">{shown.content}</div>, shown.container)}
  </TooltipContext.Provider>;
}

/**
 * Shows `content` (text or a card) next to the child while the pointer is over it or it has keyboard
 * focus, in place of the browser `title`. Without content the child is returned as is. `followCursor`
 * keeps the tooltip at the pointer, for chart marks. Touch does not open it, as with `title`.
 * The content renders under the provider, outside the app contexts: pass ready text or props (such as
 * `m`) instead of components that read a context.
 */
export function Tooltip({ content, placement = "top", followCursor = false, children }: {
  content: ReactNode; placement?: TooltipPlacement; followCursor?: boolean; children: ReactElement<TriggerProps>;
}) {
  const api = useContext(TooltipContext);
  const owner = useId();
  const empty = content === undefined || content === null || content === false || content === "";

  useEffect(() => {
    if (empty) api?.hide(owner);
    else api?.refresh(owner, content);
  });
  useEffect(() => () => api?.hide(owner), [api, owner]);

  if (!api || empty) return children;
  const own = children.props;
  const point = (event: PointerEvent<Element>) => followCursor ? { x: event.clientX, y: event.clientY } : undefined;
  return cloneElement(children, {
    onPointerEnter: event => {
      own.onPointerEnter?.(event);
      if (event.pointerType !== "touch") api.show({ owner, target: event.currentTarget, placement, point: point(event) }, content, false);
    },
    onPointerMove: event => {
      own.onPointerMove?.(event);
      if (followCursor) api.move(owner, { x: event.clientX, y: event.clientY });
    },
    onPointerLeave: event => { own.onPointerLeave?.(event); api.hide(owner); },
    onFocus: event => {
      own.onFocus?.(event);
      if (event.currentTarget.matches(":focus-visible")) api.show({ owner, target: event.currentTarget, placement }, content, true);
    },
    onBlur: event => { own.onBlur?.(event); api.hide(owner); },
  });
}
