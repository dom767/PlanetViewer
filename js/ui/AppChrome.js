const DESKTOP_MQ = "(min-width: 768px)";

/**
 * Navigation chrome: four-item nav bar, sheet overlays, and responsive info panel.
 */
export class AppChrome {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.appRoot
   * @param {HTMLElement} opts.nav
   * @param {HTMLElement} opts.scrim
   * @param {HTMLElement} opts.searchSheet
   * @param {HTMLElement} opts.settingsSheet
   * @param {HTMLElement} opts.infoPanel
   * @param {import("./InfoPanel.js").InfoPanel} opts.infoPanelApi
   * @param {import("./SystemSearch.js").SystemSearch} opts.search
   * @param {() => void} opts.onHome
   * @param {() => object | null} opts.getFocusedSystem
   */
  constructor({
    appRoot,
    nav,
    scrim,
    searchSheet,
    settingsSheet,
    infoPanel,
    infoPanelApi,
    search,
    onHome,
    getFocusedSystem,
  }) {
    this.appRoot = appRoot;
    this.nav = nav;
    this.scrim = scrim;
    this.searchSheet = searchSheet;
    this.settingsSheet = settingsSheet;
    this.infoPanel = infoPanel;
    this.infoPanelApi = infoPanelApi;
    this.search = search;
    this.onHome = onHome;
    this.getFocusedSystem = getFocusedSystem;

    /** @type {null | 'search' | 'info' | 'settings'} */
    this.activeNav = null;
    this.mq = window.matchMedia(DESKTOP_MQ);
    this.isWide = this.mq.matches;

    for (const btn of nav.querySelectorAll("[data-nav]")) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onNavClick(btn.dataset.nav);
      });
      btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    }

    scrim.addEventListener("click", () => this.closeAllSheets());
    scrim.addEventListener("pointerdown", (e) => e.stopPropagation());

    this.mq.addEventListener("change", () => {
      this.isWide = this.mq.matches;
      this.syncLayout();
    });

    this.syncLayout();
  }

  onNavClick(navId) {
    switch (navId) {
      case "home":
        this.onHome();
        this.closeAllSheets();
        this.setNavActive(null);
        break;
      case "search":
        this.toggleSearch();
        break;
      case "info":
        this.toggleInfo();
        break;
      case "settings":
        this.toggleSettings();
        break;
      default:
        break;
    }
  }

  isSearchOpen() {
    return !this.searchSheet.classList.contains("hidden");
  }

  isSettingsOpen() {
    return !this.settingsSheet.classList.contains("hidden");
  }

  isInfoOpen() {
    return this.infoPanelApi.isOpen();
  }

  openSearch() {
    this.closeSettings();
    if (this.isWide) this.infoPanelApi.dismiss();
    this.searchSheet.classList.remove("hidden");
    this.search.open();
    this.activeNav = "search";
    this.setNavActive("search");
    this.syncScrim();
  }

  closeSearch() {
    this.search.close();
    this.searchSheet.classList.add("hidden");
    if (this.activeNav === "search") {
      this.activeNav = null;
      this.setNavActive(null);
    }
    this.syncScrim();
  }

  toggleSearch() {
    if (this.isSearchOpen()) this.closeSearch();
    else this.openSearch();
  }

  openSettings() {
    this.closeSearch();
    if (this.isWide) this.infoPanelApi.dismiss();
    this.settingsSheet.classList.remove("hidden");
    this.activeNav = "settings";
    this.setNavActive("settings");
    this.syncScrim();
  }

  closeSettings() {
    this.settingsSheet.classList.add("hidden");
    if (this.activeNav === "settings") {
      this.activeNav = null;
      this.setNavActive(null);
    }
    this.syncScrim();
  }

  toggleSettings() {
    if (this.isSettingsOpen()) this.closeSettings();
    else this.openSettings();
  }

  openInfo(system) {
    const target =
      system ?? this.getFocusedSystem() ?? this.infoPanelApi.getSystem();
    if (!target) return;

    this.infoPanelApi.open(target);
    this.closeSearch();
    this.closeSettings();
    this.activeNav = "info";
    this.setNavActive("info");
    this.syncScrim();
  }

  closeInfo() {
    this.infoPanelApi.dismiss();
    if (this.activeNav === "info") {
      this.activeNav = null;
      this.setNavActive(null);
    }
    this.syncScrim();
  }

  toggleInfo() {
    if (this.isInfoOpen()) this.closeInfo();
    else this.openInfo();
  }

  closeAllSheets() {
    this.closeSearch();
    this.closeSettings();
    this.closeInfo();
  }

  /** Escape key: close topmost overlay first. Returns true if handled. */
  handleEscape() {
    if (this.isSearchOpen()) {
      this.closeSearch();
      return true;
    }
    if (this.isSettingsOpen()) {
      this.closeSettings();
      return true;
    }
    if (this.isInfoOpen()) {
      this.closeInfo();
      return true;
    }
    return false;
  }

  setNavActive(navId) {
    for (const btn of this.nav.querySelectorAll("[data-nav]")) {
      const active = navId != null && btn.dataset.nav === navId;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-current", active ? "page" : "false");
    }
  }

  syncScrim() {
    const sheetOpen =
      (!this.isWide && this.isSearchOpen()) ||
      (!this.isWide && this.isSettingsOpen()) ||
      (!this.isWide && this.isInfoOpen());

    this.scrim.classList.toggle("hidden", !sheetOpen);
    this.scrim.setAttribute("aria-hidden", sheetOpen ? "false" : "true");
    this.appRoot.classList.toggle("chrome-sheet-open", sheetOpen);
  }

  syncLayout() {
    this.infoPanel.classList.toggle("info-panel--sheet", !this.isWide);

    if (this.isWide) {
      this.appRoot.classList.remove("chrome-sheet-open");
      this.scrim.classList.add("hidden");
    } else {
      this.syncScrim();
    }
  }

  /** After selecting a system from search — close search, optionally open info. */
  onSystemSelected(fromSearch = false) {
    this.closeSearch();
    if (!this.isWide) this.openInfo();
    else this.setNavActive(this.isInfoOpen() ? "info" : null);
  }
}
