/* R6 Siege Wiki adapter - registries consumed by the wiki engine (nav options,
   sections, browse shortlist, favorites, links, meta). Loaded as text/babel
   after engine/, before the game bundle. */
    const META = {
      siteVersion: "0.1.0",
      gameVersion: "Y8S4",
      lastSynced: "September 2026",
      contact: {
        email: "",
        discord: ""
      },
      thanks: [
        "Ubisoft - Rainbow Six Siege",
        "Community contributors"
      ]
    };
    const PLAY_STORE_LINKS = {};
    const GOOGLE_PLAY_BADGES = {};
    const ALL_NAV_OPTIONS = [
      { id: 'operators', label: 'Operators' },
      { id: 'gadgets', label: 'Gadgets' },
      { id: 'maps', label: 'Maps' },
      { id: 'seasons', label: 'Seasons' },
      { id: 'favorites', label: 'Favorites' },
      { id: 'settings', label: 'Settings' },
    ];
    const NAV_ICON_MAP = {
      home: 'Search',
      operators: 'User',
      gadgets: 'Zap',
      maps: 'Map',
      seasons: 'Clock',
      favorites: 'Star',
      settings: 'Gear',
    };
    const MAIN_PAGE_TOOLS = {
      operators: 'Browse all operators',
      gadgets: 'Browse all gadgets',
      maps: 'Browse all maps',
      seasons: 'Browse all seasons',
    };
    const WEBSITE_NAV_SECTIONS = [
      { label: 'Database', ids: ['operators', 'gadgets', 'maps', 'seasons'] },
      { label: 'Personal', ids: ['favorites', 'settings'] },
    ];
    const NAV_EXTRA_LABELS = {};
    const getNavDisplayLabel = (id) => {
      if (id === 'home') return 'Search';
      if (id === 'settings') return 'Settings';
      if (id === 'seasons') return 'Seasons';
      return NAV_EXTRA_LABELS[id] || (ALL_NAV_OPTIONS.find((option) => option.id === id) || {}).label || id;
    };
    const BROWSE_SHORTLIST = [
      { id: 'home', label: 'Search' },
      { id: 'operators', label: 'Operators' },
      { id: 'gadgets', label: 'Gadgets' },
      { id: 'maps', label: 'Maps' },
      { id: 'seasons', label: 'Seasons' },
      { id: 'favorites', label: 'Favorites' },
      { id: 'settings', label: 'Settings' },
    ];
    const FAVORITE_KEYS = {
      Operator: 'favoriteOperators', Map: 'favoriteMaps', Season: 'favoriteSeasons'
    };
    const PROGRESSION_TABS = [];
    const DEFAULT_SETTINGS = {
      settingsVersion: 1,
      colorMode: 'oled',
      fontSize: 'default',
      hapticEnabled: true,
      ownedOnlyGlobal: false,
      googlePlayCtaHidden: true,
      progressionTabOrder: [],
      navItemsCustomized: false,
      navItems: ['operators', 'maps', 'seasons'],
      favoriteOperators: [],
      favoriteMaps: [],
      favoriteSeasons: []
    };
    const R6_STORAGE_KEYS = {
      settings: 'r6_settings_v1',
      favorites: 'r6_favorites_v1'
    };
    const RARITY_ALIASES = {};
    const RARITY_ORDER = {};
    const getRarityOrder = (r) => 0;
    const getRarityColor = (rarity) => 'var(--rar-common)';
    const formatRarity = (rarity) => String(rarity || '');
    const ARTICLE_VIEWS = ['operator', 'map', 'season'];
    const resolveCharacterView = (entity) => 'operator';
    const SEO_SUFFIX = " - Siege Wiki";
    const SEO_DEFAULT_TITLE = "Siege Wiki - Rainbow Six Siege Database";
    const SEO_SITE_BASE = 'https://r6-siege-wiki.pages.dev';
    const SEO_VIEW_LABELS = {
      operators: 'Operators', operator: 'Operators', gadgets: 'Gadgets', maps: 'Maps', map: 'Maps',
      seasons: 'Seasons', season: 'Seasons', settings: 'Settings', favorites: 'Favorites'
    };
    const DEFAULT_IMAGES = {
      Operator: './assets/default-operator.svg',
      Gadget: './assets/default-gadget.svg',
      Weapon: './assets/default-weapon.svg',
      Map: './assets/default-map.svg'
    };
    const IMAGE_LOCAL_PREFIXES = ['r6_images/', 'assets/'];
    const IMAGE_DIAMOND_TYPES = [];
    const IMAGE_CONTAIN_TYPES = ['Gadget', 'Weapon', 'Hero', 'Map'];
    const GAME_ACCENT = { accent: '#3da5e0', accentSoft: 'rgba(61, 165, 224, 0.14)' };
