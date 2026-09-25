/* Wiki Engine - shell chrome: search portal, app toolbar, section drawer shell, header, crumbs, scroll-to-top FAB. Game-agnostic shell; game lists via globals config. */
    const WikiHeaderSearchPortal = ({ children }) => {
      if (typeof document === 'undefined') return null;
      const slot = document.getElementById('wiki-header-search-slot');
      const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
      if (isDesktop && slot) return ReactDOM.createPortal(children, slot);
      return (
        <div className="sticky top-0 z-20 px-6 pb-4 pt-1 pointer-events-none">
          <div className="relative max-w-3xl mx-auto pointer-events-auto">{children}</div>
        </div>
      );
    };
    const AppToolbar = ({ currentView, drawerOpen, onSearch, onSections, onSaved, onSettings }) => {
      const tabs = [
        { id: 'search', label: 'Search', Icon: Icons.Search, active: currentView === 'home', onTap: onSearch },
        { id: 'sections', label: 'Sections', Icon: Icons.List, active: drawerOpen, onTap: onSections },
        { id: 'saved', label: 'Saved', Icon: Icons.Bookmark, active: currentView === 'favorites', onTap: onSaved },
        { id: 'settings', label: 'Settings', Icon: Icons.Gear, active: currentView === 'settings', onTap: onSettings },
      ];
      return (
        <nav className="apptoolbar" aria-label="App">
          {tabs.map(({ id, label, Icon, active, onTap }) => (
            <button key={id} type="button" onClick={onTap} aria-label={label} className={active ? 'active' : ''}>
              <Icon width={22} height={22} strokeWidth={active ? 2.3 : 2} />
              {label}
              <span className="tb-dot" aria-hidden="true" />
            </button>
          ))}
        </nav>
      );
    };
    const SectionDrawer = ({ open, currentView, onBrowse, onClose }) => {
      const closeRef = useRef(null);
      useEffect(() => {
        if (!open) return undefined;
        closeRef.current?.focus();
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [open, onClose]);
      const rows = BROWSE_SHORTLIST.map((s, i) => ({ ...s, num: String(i + 1) }));
      return (
        <React.Fragment>
          <div className={`cx-scrim ${open ? 'cx-scrim--open' : ''}`} onClick={onClose} aria-hidden="true" />
          <nav className={`cx-drawer ${open ? 'cx-drawer--open' : ''}`} aria-label="Sections" aria-hidden={!open} data-no-swipe>
            <div className="cx-drawer-head">
              <div className="t">Browse the wiki<small>SECTIONS</small></div>
              <button type="button" ref={closeRef} onClick={onClose} className="cx-drawer-close" aria-label="Close sections">✕</button>
            </div>
            <div className="cx-drawer-list">
              {rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={currentView === row.id ? 'current' : ''}
                  onClick={() => onBrowse(row.id)}
                >
                  <span className="n">{row.num}</span>
                  <span className="lbl">{row.label}</span>
                </button>
              ))}
            </div>
            <div className="cx-drawer-foot">Browse the wiki indexes.</div>
          </nav>
        </React.Fragment>
      );
    };
    const Header = ({ title, subtitle, onBack, onScrollTop }) => (
      <div className="mb-6 sm:mb-8 px-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="mr-1 sm:mr-3 p-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white transition-all">
              <Icons.ChevronLeft width={22} height={22} />
            </button>
          )}
          <div
            onClick={onScrollTop}
            className={onScrollTop ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}
          >
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">{title}</h1>
            <p className="text-sm text-slate-400 mt-1">{subtitle}</p>
          </div>
        </div>
      </div>
    );
    const ViewCrumbs = ({ trail = [], current }) => {
      if (!current && (!trail || trail.length === 0)) return null;
      return (
        <nav className="cx-crumbs flex items-center flex-wrap gap-x-1.5 gap-y-1 px-0.5 pb-1 text-[11.5px] leading-relaxed" aria-label="Breadcrumb">
          {trail.map((crumb, index) => (
            <span key={`cx-crumb-${index}`} className="cx-crumbs__item inline-flex items-center gap-1.5 min-w-0">
              {typeof crumb.onClick === 'function' ? (
                <button
                  type="button"
                  onClick={crumb.onClick}
                  className="cx-crumbs__link text-zinc-500 hover:text-zinc-200 transition-colors font-medium truncate"
                >
                  {crumb.label}
                </button>
              ) : (
                <span className="cx-crumbs__link text-zinc-500 font-medium truncate">{crumb.label}</span>
              )}
              <span className="cx-crumbs__sep text-zinc-700 select-none" aria-hidden="true">›</span>
            </span>
          ))}
          <span className="cx-crumbs__current text-zinc-100 font-bold truncate" aria-current="page">{current}</span>
        </nav>
      );
    };
    const ScrollToTopFAB = ({ mainRef, currentView }) => {
      const [visible, setVisible] = useState(false);
      useEffect(() => {
        setVisible(false);
        const findScrollable = () => {
          if (!mainRef.current) return null;
          const el = mainRef.current.querySelector('.overflow-y-auto, [class*="overflow-y-auto"]');
          return el;
        };
        let scrollEl = null;
        let rafId = null;
        const onScroll = () => {
          if (rafId) return;
          rafId = requestAnimationFrame(() => {
            rafId = null;
            setVisible(scrollEl ? scrollEl.scrollTop > 400 : false);
          });
        };
        const tryAttach = () => {
          const el = findScrollable();
          if (el === scrollEl) return;
          if (scrollEl) scrollEl.removeEventListener('scroll', onScroll);
          scrollEl = el;
          if (scrollEl) {
            scrollEl.addEventListener('scroll', onScroll, { passive: true });
            onScroll();
          }
        };
        const timer = setTimeout(tryAttach, 100);
        let debounceTimer = null;
        const observer = new MutationObserver(() => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(tryAttach, 150);
        });
        if (mainRef.current) observer.observe(mainRef.current, { childList: true, subtree: false });
        return () => {
          clearTimeout(timer);
          if (debounceTimer) clearTimeout(debounceTimer);
          if (rafId) cancelAnimationFrame(rafId);
          if (scrollEl) scrollEl.removeEventListener('scroll', onScroll);
          observer.disconnect();
        };
      }, [currentView]);
      const handleClick = () => {
        if (!mainRef.current) return;
        const el = mainRef.current.querySelector('.overflow-y-auto, [class*="overflow-y-auto"]');
        if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
        triggerHaptic('Light');
      };
      return (
        <button
          onClick={handleClick}
          aria-label="Scroll to top"
          className="fixed z-50 right-4 transition-all duration-300 ease-out"
          style={{
            bottom: 'calc(5rem + env(safe-area-inset-bottom, 0px) + 12px)',
            opacity: visible ? 1 : 0,
            transform: visible ? 'scale(1) translateY(0)' : 'scale(0.8) translateY(10px)',
            pointerEvents: visible ? 'auto' : 'none',
          }}
        >
          <div className="w-10 h-10 rounded-full bg-zinc-800/90 backdrop-blur border border-white/10 shadow-lg flex items-center justify-center hover:bg-zinc-700/90 active:scale-90 transition-all">
            <Icons.ChevronLeft width={18} height={18} className="text-zinc-300 rotate-90" />
          </div>
        </button>
      );
    };
