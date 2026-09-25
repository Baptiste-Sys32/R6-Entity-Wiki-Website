/* Wiki Engine - device profile, pull-to-refresh, glass button, pull indicator. Game-agnostic; shares globals. */
    const useDeviceProfile = () => {
      const readProfile = () => {
        if (typeof window === 'undefined') {
          return { isMobile: false, width: 1024 };
        }
        const coarse = window.matchMedia?.('(pointer: coarse)').matches;
        const narrow = window.matchMedia?.('(max-width: 768px)').matches;
        return { isMobile: Boolean(coarse || narrow), width: window.innerWidth || 0 };
      };
      const [profile, setProfile] = useState(readProfile);
      useEffect(() => {
        const update = () => setProfile(readProfile());
        const coarseQuery = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
        const narrowQuery = window.matchMedia ? window.matchMedia('(max-width: 768px)') : null;
        window.addEventListener('resize', update);
        coarseQuery?.addEventListener ? coarseQuery.addEventListener('change', update) : coarseQuery?.addListener?.(update);
        narrowQuery?.addEventListener ? narrowQuery.addEventListener('change', update) : narrowQuery?.addListener?.(update);
        return () => {
          window.removeEventListener('resize', update);
          coarseQuery?.removeEventListener ? coarseQuery.removeEventListener('change', update) : coarseQuery?.removeListener?.(update);
          narrowQuery?.removeEventListener ? narrowQuery.removeEventListener('change', update) : narrowQuery?.removeListener?.(update);
        };
      }, []);
      return profile;
    };
    const GlassButton = ({ children, onClick, active, className = '' }) => (
      <button
        onClick={onClick}
        className={`relative px-5 py-2.5 rounded-2xl font-semibold text-sm transition-all duration-300 backdrop-blur-md glass-button ${active
          ? 'glass-button--active translate-y-[-1px]'
          : 'hover:text-white hover:-translate-y-0.5'
          } ${className}`}
      >
        {children}
      </button>
    );
    const usePullToRefresh = (onRefresh, options = {}) => {
      const { threshold = 80, resistance = 2.5 } = options;
      const containerRef = useRef(null);
      const [pullDistance, setPullDistance] = useState(0);
      const [isRefreshing, setIsRefreshing] = useState(false);
      const startY = useRef(0);
      const isPulling = useRef(false);

      const handleTouchStart = (e) => {
        const container = containerRef.current;
        if (!container || container.scrollTop > 5) return;
        startY.current = e.touches[0].clientY;
        isPulling.current = true;
      };

      const handleTouchMove = (e) => {
        if (!isPulling.current || isRefreshing) return;
        const container = containerRef.current;
        if (!container || container.scrollTop > 5) {
          isPulling.current = false;
          setPullDistance(0);
          return;
        }
        const currentY = e.touches[0].clientY;
        const diff = (currentY - startY.current) / resistance;
        if (diff > 0) {
          setPullDistance(Math.min(diff, threshold * 1.5));
          if (diff > 10 && e.cancelable) e.preventDefault();
        }
      };

      const handleTouchEnd = async () => {
        if (!isPulling.current) return;
        isPulling.current = false;
        if (pullDistance >= threshold && !isRefreshing) {
          setIsRefreshing(true);
          triggerHaptic('Medium');
          try {
            await onRefresh?.();
          } catch (e) { }
          setTimeout(() => {
            setIsRefreshing(false);
            setPullDistance(0);
          }, 500);
        } else {
          setPullDistance(0);
        }
      };

      return {
        containerRef,
        pullDistance,
        isRefreshing,
        pullHandlers: {
          onTouchStart: handleTouchStart,
          onTouchMove: handleTouchMove,
          onTouchEnd: handleTouchEnd,
        },
      };
    };
    const PullIndicator = ({ pullDistance, threshold, isRefreshing }) => {
      const progress = Math.min(pullDistance / threshold, 1);
      const rotation = progress * 180;
      if (pullDistance < 5 && !isRefreshing) return null;
      return (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-30 flex items-center justify-center transition-all duration-200"
          style={{ top: Math.max(pullDistance - 40, 10), opacity: Math.min(progress + 0.3, 1) }}
        >
          <div className={`w-10 h-10 rounded-full bg-zinc-800/90 backdrop-blur-md border border-white/10 flex items-center justify-center ${isRefreshing ? 'animate-spin' : ''}`}>
            <svg
              width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="text-white transition-transform"
              style={{ transform: `rotate(${isRefreshing ? 0 : rotation}deg)` }}
            >
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </div>
        </div>
      );
    };
