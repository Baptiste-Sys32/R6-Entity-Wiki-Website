/* Wiki Engine - article kit: infobox/meta/toc/table primitives, lightbox, narrow-tier hook, notes editor. Game-agnostic; shares globals. */
    const InfoCallout = () => null;
    const NotesEditor = ({ title = 'Personal Notes', value = '', onChange, placeholder = 'Write anything useful here...' }) => (
      <div className="mt-4 pt-4 border-t border-white/10">
        <div className="flex items-center gap-2 mb-2">
          <Icons.BookOpen width={14} height={14} className="text-zinc-400" />
          <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{title}</p>
        </div>
        <textarea
          value={value}
          onChange={e => onChange && onChange(e.target.value)}
          rows={4}
          placeholder={placeholder}
          className="w-full bg-zinc-800/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-500"
        />
        <p className="text-[10px] text-zinc-600 mt-1">Stored locally only. Not included when sharing builds.</p>
      </div>
    );
    const ArticleShell = ({ crumbs, title, hatnote, meta, lead, toc, infobox, categories, children }) => {
      return (
        <article className="cx-article w-full min-w-0">
          {crumbs && crumbs.length > 0 ? (
            <nav className="cx-crumbs" aria-label="Breadcrumbs">
              {crumbs.map((crumb, i) => {
                const isLast = i === crumbs.length - 1;
                const label = typeof crumb === "string" ? crumb : crumb.label;
                const href = typeof crumb === "string" ? "#" : (crumb.href || "#");
                return (
                  <span key={i}>
                    {i > 0 ? <span className="cx-sep" aria-hidden="true">›</span> : null}
                    {isLast ? <b>{label}</b> : <a href={href}>{label}</a>}
                  </span>
                );
              })}
            </nav>
          ) : null}
          <h1 className="cx-title">{title}</h1>
          {hatnote ? <Hatnote>{hatnote}</Hatnote> : null}
          {meta ? <MetaLine updated={meta.updated} editsLabel={meta.editsLabel} onHistory={meta.onHistory} onTalk={meta.onTalk} /> : null}
          <div className="cx-leadgrid">
            <div className="cx-leadmain">
              {lead}
              {toc && toc.length > 0 ? <Toc items={toc} /> : null}
            </div>
            {infobox ? (
              <Infobox title={infobox.title} sub={infobox.sub} image={infobox.image} imageAlt={infobox.imageAlt} imageType={infobox.imageType} rows={infobox.rows} note={infobox.note} />
            ) : null}
          </div>
          {children}
          {categories && categories.length > 0 ? <CategoryBar categories={categories} /> : null}
        </article>
      );
    };
    const ImageLightbox = ({ src, alt, meta, fit, onClose }) => {
      useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [onClose]);
      if (!src) return null;
      return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }} onClick={onClose} role="dialog" aria-label={alt || 'Image preview'}>
          <div className="relative w-full max-w-5xl" onClick={e => e.stopPropagation()}>
            <img src={src} alt={alt || ''} style={fit === 'icon' ? { display: 'block', width: '100%', maxWidth: '320px', margin: '0 auto' } : { display: 'block', width: '100%', maxHeight: '86vh', objectFit: 'contain' }} />
            <div className="flex items-center justify-between gap-4 mt-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: '#fafafa' }}>{alt}</p>
                {meta ? <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,250,0.65)' }}>{meta}</p> : null}
              </div>
              <button type="button" onClick={onClose} className="cx-alink shrink-0" style={{ color: '#fafafa' }}>Close</button>
            </div>
          </div>
        </div>
      );
    };
    const useNarrowTier = () => {
      const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches);
      useEffect(() => {
        const mq = window.matchMedia('(max-width: 860px)');
        const onChange = (e) => setNarrow(e.matches);
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else mq.addListener(onChange);
        return () => {
          if (mq.removeEventListener) mq.removeEventListener('change', onChange);
          else mq.removeListener(onChange);
        };
      }, []);
      return narrow;
    };
    const Hatnote = ({ children }) => {
      if (!children) return null;
      return (
        <p className="cx-hatnote">{children}</p>
      );
    };
    const MetaLine = () => {
      return null;
    };
    const Infobox = ({ title, sub, image, imageAlt, imageType, rows, note }) => {
      return (
        <aside className="cx-infobox w-full">
          <div className="cx-ib-title">{title}</div>
          {sub ? <div className="cx-ib-sub">{sub}</div> : null}
          {image ? (
            <div className="cx-ib-media w-full aspect-[3/4] overflow-hidden" title={imageAlt || title}>
              <AssetFrame type={imageType || "Killer"} imageUrl={image} size="fill" />
            </div>
          ) : null}
          {rows && rows.length > 0 ? (
            <table>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <th scope="row">{row.label}</th>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {note ? <div className="cx-ib-note">{note}</div> : null}
        </aside>
      );
    };
    const Toc = ({ items }) => {
      if (!items || items.length === 0) return null;
      return (
        <nav className="cx-toc" aria-label="Contents">
          <div className="cx-toc-title">Contents</div>
          <ol>
            {items.map((item) => (
              <li key={item.id}>
                <a href={"#" + item.id}>{item.label}</a>
                {item.children && item.children.length > 0 ? (
                  <ol>
                    {item.children.map((child) => (
                      <li key={child.id} className="cx-l2">
                        <a href={"#" + child.id}>{child.label}</a>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            ))}
          </ol>
        </nav>
      );
    };
    const CategoryBar = ({ categories }) => {
      if (!categories || categories.length === 0) return null;
      return (
        <div className="cx-cats">
          <span>Categories:</span>
          {categories.map((cat, i) => {
            const label = typeof cat === "string" ? cat : cat.label;
            const onClick = typeof cat === "string" ? null : (cat.onClick || null);
            return (
              <span key={i}>
                {i > 0 ? <span className="cx-sep" aria-hidden="true">·</span> : null}
                {onClick ? (
                  <a href="#" onClick={(e) => { e.preventDefault(); onClick(e); }}>{label}</a>
                ) : (
                  <a href="#">{label}</a>
                )}
              </span>
            );
          })}
        </div>
      );
    };
