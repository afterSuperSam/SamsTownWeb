import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { visualConfig } from "../domain/visualConfig";
import { SignatureDrawing, townSignatureLetters, writeSignature } from "./SignatureDrawing";

const InitialLoadingContext = createContext<() => void>(() => undefined);
export const useInitialHomeLoading = () => useContext(InitialLoadingContext);

// 加载层独立于身份、文案和页面边界，整个首屏只挂载一次。
export function InitialHomeLoading({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(pathname === "/");
  const [ready, setReady] = useState(false);
  const reportReady = useCallback(() => setReady(true), []);
  const finish = useCallback(() => setVisible(false), []);
  const active = visible && pathname === "/";

  return <InitialLoadingContext.Provider value={reportReady}>
    <div className="initial-home-content" data-loading={active || undefined} inert={active}>
      {children}
    </div>
    {active && <LoadingSignature ready={ready} onComplete={finish} />}
  </InitialLoadingContext.Provider>;
}

// 固定时间连续写完；数据仍在加载时保留完整签名，不重播、不逐帧更新 React。
function LoadingSignature({ ready, onComplete }: { ready: boolean; onComplete: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef<SVGSVGElement>(null);
  const [written, setWritten] = useState(false);

  useEffect(() => {
    const drawing = drawingRef.current!;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const animations = writeSignature(drawing, visualConfig.loadingSignature);
    animations.at(-1)!.onfinish = () => setWritten(true);
    const synchronize = () => {
      if (reducedMotion.matches) {
        animations.forEach(animation => animation.finish());
        setWritten(true);
      } else {
        animations.forEach(animation => {
          if (animation.playState !== "finished") {
            if (document.hidden) animation.pause();
            else animation.play();
          }
        });
      }
    };
    synchronize();
    reducedMotion.addEventListener("change", synchronize);
    document.addEventListener("visibilitychange", synchronize);
    return () => {
      animations.forEach(animation => { animation.onfinish = null; animation.cancel(); });
      reducedMotion.removeEventListener("change", synchronize);
      document.removeEventListener("visibilitychange", synchronize);
    };
  }, []);

  // 完整签名保持一体，轻微放大后淡出，退出完成再释放页面交互。
  useEffect(() => {
    if (!ready || !written) return;
    const overlay = overlayRef.current!;
    const drawing = drawingRef.current!;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const settings = visualConfig.loadingSignature;
    const options: KeyframeAnimationOptions = {
      duration: settings.exitMilliseconds,
      easing: getComputedStyle(overlay).getPropertyValue("--ease-out").trim(),
      fill: "forwards"
    };
    const animations = [drawing.animate([
      { transform: "scale(1)", opacity: 1, offset: 0 },
      { opacity: 1, offset: settings.exitFadeStart },
      { transform: `scale(${settings.exitScale})`, opacity: 0, offset: 1 }
    ], options)];
    const backdrop = overlay.animate([
      { opacity: 1, offset: 0 },
      { opacity: 1, offset: settings.exitFadeStart },
      { opacity: 0, offset: 1 }
    ], options);
    backdrop.onfinish = onComplete;
    animations.push(backdrop);
    const synchronize = () => {
      if (reducedMotion.matches) onComplete();
      else animations.forEach(animation => document.hidden ? animation.pause() : animation.play());
    };
    synchronize();
    reducedMotion.addEventListener("change", synchronize);
    document.addEventListener("visibilitychange", synchronize);
    return () => {
      animations.forEach(animation => { animation.onfinish = null; animation.cancel(); });
      reducedMotion.removeEventListener("change", synchronize);
      document.removeEventListener("visibilitychange", synchronize);
    };
  }, [ready, written, onComplete]);

  return <div className="site-initial-load" ref={overlayRef} role="status" aria-label="正在进入楹雾镇">
    <SignatureDrawing drawingRef={drawingRef} className="loading-signature"
      letters={townSignatureLetters} viewBox="0 18 488 110" label="Yingwu Town" />
  </div>;
}

// 页面切换只保留占位；全屏动画由首屏边界统一处理。
export function PageLoading({ label }: { label: string }) {
  return <div className="page-pending" role="status" aria-label={label} />;
}
