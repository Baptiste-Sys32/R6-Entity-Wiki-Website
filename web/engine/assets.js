/* Wiki Engine - local image resolution + AssetFrame. Adapter supplies: IMAGE_LOCAL_PREFIXES (array), DEFAULT_IMAGES (map); optionally resolveExtraImageSource() (sync pack/CDN hook, undefined = not handled), resolveAsyncImageSource() (async hook), IMAGE_DIAMOND_TYPES / IMAGE_CONTAIN_TYPES (defaults preserve DBD behavior). Shares globals. */
    const toLocalImageSource = (url) => {
      if (!url) return null;
      const normalized = String(url).replace(/\\/g, '/').replace(/^\.\//, '');
      if (typeof resolveExtraImageSource === 'function') {
        const extra = resolveExtraImageSource(normalized);
        if (extra !== undefined) return extra;
      }
      const prefixes = (typeof IMAGE_LOCAL_PREFIXES !== 'undefined' && IMAGE_LOCAL_PREFIXES) || ['assets/'];
      if (prefixes.some((prefix) => normalized.startsWith(prefix))) return `./${normalized}`;
      return null;
    };
    const resolveAppImageSource = async (url) => {
      if (!url) return null;
      const normalized = String(url).replace(/\\/g, '/').replace(/^\.\//, '');
      if (typeof resolveAsyncImageSource === 'function') {
        const resolved = await resolveAsyncImageSource(normalized);
        if (resolved !== undefined) return resolved;
      }
      return toLocalImageSource(normalized);
    };
    const getPreloadedImageCache = () => {
      if (!(window.__entityPreloadedImages instanceof Set)) {
        window.__entityPreloadedImages = new Set();
      }
      return window.__entityPreloadedImages;
    };
    const preloadResolvedImage = async (imageUrl, assetRevision = 0) => {
      if (!imageUrl || navigator.connection?.saveData) return;
      const cache = getPreloadedImageCache();
      const cacheKey = `${assetRevision}:${String(imageUrl)}`;
      if (cache.has(cacheKey)) return;
      cache.add(cacheKey);
      const source = await resolveAppImageSource(imageUrl);
      if (!source) return;
      await new Promise((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = source;
        if (typeof img.decode === 'function') {
          img.decode().then(resolve).catch(resolve);
        }
      });
    };
    const preloadImageBatch = (imageUrls = [], assetRevision = 0, limit = 16) => {
      const urls = [...new Set((imageUrls || []).filter(Boolean))].slice(0, limit);
      if (urls.length === 0) return () => {};
      let cancelled = false;
      const run = async () => {
        for (const url of urls) {
          if (cancelled) return;
          await preloadResolvedImage(url, assetRevision);
        }
      };
      const idleId = typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(run, { timeout: 1200 })
        : window.setTimeout(run, 250);
      return () => {
        cancelled = true;
        if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId);
        else window.clearTimeout(idleId);
      };
    };
    const AssetFrame = ({ type, imageUrl, fallbackIcon, size = 'normal', assetRevision = 0, imageLoading = null }) => {
      const [primarySource, setPrimarySource] = useState(null);
      const [broken, setBroken] = useState(false);
      const [loaded, setLoaded] = useState(false);
      const [sourceIndex, setSourceIndex] = useState(0);
      const defaultImg = DEFAULT_IMAGES[type];
      const sources = useMemo(() => {
        const entries = [];
        const add = (val) => { if (val && !entries.includes(val)) entries.push(val); };
        add(primarySource);
        add(toLocalImageSource(defaultImg));
        return entries;
      }, [primarySource, defaultImg]);
      useEffect(() => {
        let cancelled = false;
        setPrimarySource(null);
        setBroken(false);
        setLoaded(false);
        setSourceIndex(0);
        const resolveSource = async () => {
          const nextSource = await resolveAppImageSource(imageUrl);
          if (!cancelled) {
            setPrimarySource(nextSource);
          }
        };
        resolveSource();
        return () => {
          cancelled = true;
        };
      }, [imageUrl, type, assetRevision]);
      const diamondTypes = (typeof IMAGE_DIAMOND_TYPES !== 'undefined' && IMAGE_DIAMOND_TYPES) || ['Perk'];
      const isDiamond = diamondTypes.includes(type);
      const handleError = () => {
        const next = sourceIndex + 1;
        if (next < sources.length) {
          setSourceIndex(next);
        } else {
          setBroken(true);
        }
      };
      const handleLoad = () => {
        setLoaded(true);
      };
      const src = broken ? null : sources[sourceIndex];
      let containerClass = isDiamond ? 'w-16 h-16 rotate-45 m-2 rounded-lg' : 'w-16 h-20 rounded-xl';
      let imgClass = isDiamond ? '-rotate-45 scale-125' : '';
      if (size === 'large') {
        containerClass = isDiamond ? 'w-24 h-24 rotate-45 m-4 rounded-xl' : 'w-24 h-32 rounded-2xl';
      } else if (size === 'fill') {
        containerClass = 'w-full h-full rounded-none';
        imgClass = '';
      }
      const baseClasses = size === 'fill'
        ? `relative flex items-center justify-center overflow-hidden ${containerClass}`
        : `relative flex items-center justify-center bg-zinc-950/50 border border-white/10 overflow-hidden shrink-0 ${containerClass}`;
      const containTypes = (typeof IMAGE_CONTAIN_TYPES !== 'undefined' && IMAGE_CONTAIN_TYPES) || ['Addon', 'Item', 'Offering', 'Power', 'GameIcon'];
      const objectFit = containTypes.includes(type) ? 'object-contain' : 'object-cover';
      return (
        <div className={baseClasses}>
          {/* Skeleton shimmer while loading */}
          {!loaded && !broken && src && (
            <div className={`absolute inset-0 skeleton-shimmer ${isDiamond ? '' : 'rounded-xl'}`}></div>
          )}
          {src && !broken ? (
            <img
              src={src}
              alt={type}
              loading={imageLoading || undefined}
              className={`w-full h-full ${objectFit} ${imgClass} ${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
              onError={handleError}
              onLoad={handleLoad}
            />
          ) : (
            <div className={`flex items-center justify-center w-full h-full text-zinc-700 ${isDiamond && size !== 'fill' ? '-rotate-45' : ''}`}>
              {fallbackIcon ? fallbackIcon : <Icons.Image width={size === 'large' ? 32 : 20} height={size === 'large' ? 32 : 20} />}
            </div>
          )}
          <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 10px rgba(0,0,0,0.5)' }}></div>
        </div>
      );
    };
