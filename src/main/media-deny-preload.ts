(() => {
  const denied = () => Promise.reject(new DOMException("Media capture is disabled in Pin Paper.", "NotAllowedError"));
  const emptyDevices = () => Promise.resolve([]);
  const mediaDevices = {
    getUserMedia: denied,
    getDisplayMedia: denied,
    enumerateDevices: emptyDevices,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  };

  const install = (target: any) => {
    try {
      Object.defineProperty(target, "mediaDevices", {
        configurable: false,
        enumerable: true,
        get: () => mediaDevices
      });
    } catch {
      try { target.mediaDevices = mediaDevices; } catch {}
    }
  };

  try { install(navigator); } catch {}
  try { install(Navigator.prototype); } catch {}
})();
