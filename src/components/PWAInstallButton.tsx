import { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-1.5 rounded border border-lime-400 bg-white px-2.5 py-1.5 text-xs font-bold text-[#0f2557] shadow-sm hover:bg-lime-100 transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5 text-lime-700" />
        <span className="hidden sm:inline">Install Field App</span>
        <span className="sm:hidden">Install</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 rounded border border-blue-800 bg-blue-950/60 px-2.5 py-1.5 text-xs font-semibold text-white hover:text-lime-300 transition-colors whitespace-nowrap shrink-0"
        >
          <Smartphone className="w-3.5 h-3.5 text-lime-400" />
          <span className="hidden sm:inline">Install on iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
            <div className="w-full max-w-sm rounded border-2 border-[#0f2557] bg-white p-5 shadow-2xl text-slate-900">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200">
                <h3 className="text-base font-display font-bold text-[#0f2557]">
                  Install TerraSight on iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 text-slate-400 hover:text-[#0f2557]"
                  aria-label="Close iOS install instructions"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="mt-3 text-xs text-slate-700 leading-relaxed">
                Install TerraSight for offline field inspection access:
              </p>
              <ol className="mt-2 space-y-1.5 text-xs text-slate-800 list-decimal list-inside">
                <li>
                  Tap the <strong>Share</strong> button in the Safari toolbar.
                </li>
                <li>
                  Scroll down and tap <strong>Add to Home Screen</strong>.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded bg-[#0f2557] py-2 text-xs font-bold text-white hover:bg-[#163375]"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}

interface OfflineIndicatorProps {
  cachedSiteCount?: number;
}

export function OfflineIndicator({ cachedSiteCount = 0 }: OfflineIndicatorProps) {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 left-5 z-40 flex items-center gap-2.5 rounded border-2 border-lime-400 bg-[#0f2557] px-3.5 py-2 text-xs font-semibold text-white shadow-xl max-w-[calc(100vw-2.5rem)] print:hidden"
    >
      <WifiOff className="w-4 h-4 text-lime-400 shrink-0" />
      <span className="truncate">
        Offline Mode — Using Workbox cached assets
        {cachedSiteCount > 0 ? ` (${cachedSiteCount} field site${cachedSiteCount === 1 ? '' : 's'} cached)` : ''}
      </span>
    </div>
  );
}
