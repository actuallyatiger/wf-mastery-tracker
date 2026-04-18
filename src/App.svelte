<script>
  import { onMount } from 'svelte'
  import ItemCard from './components/ItemCard.svelte'
  import SettingsPanel from './components/SettingsPanel.svelte'
  import Toolbar from './components/Toolbar.svelte'
  import { loadTrackerData } from './lib/data-loader'
  import { importProfileData } from './lib/profile-import'
  import {
    STORAGE_KEY,
    DEFAULT_SETTINGS,
    TABS,
    SORT_OPTIONS,
    PROFILE_URL_PC,
    EMPTY_ITEM_STATE,
    cleanDisplayName,
    isPrime,
    isUmbra,
    createItemState,
    normalizeItemState,
    normalizeItems,
    getComponentRequirementId,
    isComponentRequirementOwned,
    getBlueprintRows as getBlueprintRowsCore,
    getBlueprintTreeGuides,
    getBlueprintTooltip as getBlueprintTooltipCore,
    isCraftReady,
    isAutoCrafted,
    isCrafted,
    isSubsumed,
    matchesSearch,
    matchesVariant,
    matchesStatus,
    sortItems,
    computeSummary,
    getStatusFilterLabel,
  } from './lib/tracker-core'

  let data = {
    items: [],
    components: {},
    blueprints: {},
    generatedAt: null,
    counts: {},
  }

  let progress = {
    settings: { ...DEFAULT_SETTINGS },
    items: {},
  }

  let loading = true
  let error = ''
  let activeTab = 'warframes'
  let search = ''
  let variantNormal = true
  let variantPrime = true
  let variantLich = true
  let hideCrafted = false
  let hideMastered = false
  let hideSubsumed = false
  let sortBy = 'name-asc'
  let filteredItems = []
  let currentItems = []
  let summary = { blueprintOwned: 0, blueprintTotal: 0, ready: 0, crafted: 0, mastered: 0, subsumed: 0 }
  let showSettings = false
  let settingsAnchorElement

  function resolveTheme(setting) {
    if (setting === 'light' || setting === 'dark') {
      return setting
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  function applyTheme(setting) {
    const theme = resolveTheme(setting)
    document.documentElement.dataset.theme = theme
  }

  function updateItemState(item, updater) {
    const current = normalizeItemState(progress.items?.[item.id] ?? createItemState())
    const updated = normalizeItemState(updater(current) ?? current)

    progress = {
      ...progress,
      items: {
        ...(progress.items ?? {}),
        [item.id]: updated,
      },
    }

    persist()
  }

  function getBlueprintRows(item) {
    return getBlueprintRowsCore(item, data.blueprints)
  }

  function getBlueprintTooltip(item, row) {
    return getBlueprintTooltipCore(item, row, data.components)
  }

  function isCraftReadyForItem(item) {
    return isCraftReady(progress, item)
  }

  function isAutoCraftedForItem(item) {
    return isAutoCrafted(progress, item)
  }

  function isCraftedForItem(item) {
    return isCrafted(progress, item)
  }

  function isSubsumedForItem(item) {
    return isSubsumed(progress, item)
  }

  function persist() {
    let nextItems = normalizeItems(progress.items)

    if (progress.settings.craftedMode === 'auto') {
      const allItems = data.items ?? []
      const itemsById = new Map(allItems.map((item) => [item.id, item]))
      const syncedItems = normalizeItems(nextItems)

      for (const [itemId, itemState] of Object.entries(nextItems)) {
        const item = itemsById.get(itemId)
        if (!item || !itemState || typeof itemState !== 'object') {
          continue
        }

        const crafted = isCraftReady(progress, item)
        if (itemState.crafted !== crafted) {
          syncedItems[itemId] = {
            ...itemState,
            crafted,
          }
        }
      }

      nextItems = syncedItems
    }

    const nextProgress = {
      ...progress,
      items: normalizeItems(nextItems),
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextProgress))
    progress = {
      ...nextProgress,
      items: normalizeItems(nextProgress.items),
    }
  }

  function hydrateStoredProgress() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const stored = JSON.parse(raw)
        progress = {
          settings: {
            ...DEFAULT_SETTINGS,
            ...(stored.settings ?? {}),
          },
          items: normalizeItems(stored.items ?? {}),
        }
        return
      } catch {
        progress = {
          settings: { ...DEFAULT_SETTINGS },
          items: {},
        }
        return
      }
    }

    progress = {
      settings: { ...DEFAULT_SETTINGS },
      items: {},
    }
  }

  function toggleMainBlueprint(item, value) {
    updateItemState(item, (state) => ({
      ...state,
      mainBlueprintOwned: value,
    }))
  }

  function toggleComponentBlueprint(item, requirement, index, value) {
    updateItemState(item, (state) => {
      const currentOwned = { ...(state.componentBlueprintsOwned ?? {}) }
      const requirementId = getComponentRequirementId(requirement, index)

      if (value) {
        currentOwned[requirementId] = true
      } else {
        delete currentOwned[requirementId]
      }

      return {
        ...state,
        componentBlueprintsOwned: currentOwned,
      }
    })
  }

  function toggleCrafted(item, value) {
    updateItemState(item, (state) => ({
      ...state,
      crafted: value,
    }))
  }

  function toggleMastered(item, value) {
    updateItemState(item, (state) => ({
      ...state,
      mastered: value,
    }))
  }

  function toggleSubsumed(item, value) {
    updateItemState(item, (state) => ({
      ...state,
      subsumed: value,
    }))
  }

  function setCraftedMode(value) {
    progress.settings = {
      ...progress.settings,
      craftedMode: value,
    }
    persist()
  }

  function setTheme(value) {
    progress.settings = {
      ...progress.settings,
      theme: value,
    }
    persist()
    applyTheme(value)
  }

  function resetFilters() {
    search = ''
    variantNormal = true
    variantPrime = true
    variantLich = true
    hideCrafted = false
    hideMastered = false
    hideSubsumed = false
    sortBy = 'name-asc'
  }

  function closeOpenMenus() {
    document.querySelectorAll('.filter-menu[open]').forEach((menu) => {
      menu.removeAttribute('open')
    })
  }

  function onGlobalPointerDown(event) {
    const target = event.target
    if (!(target instanceof Node)) {
      return
    }

    if (showSettings && settingsAnchorElement && !settingsAnchorElement.contains(target)) {
      showSettings = false
    }

    const openMenus = Array.from(document.querySelectorAll('.filter-menu[open]'))
    if (openMenus.length === 0) {
      return
    }

    const clickedInsideOpenMenu = openMenus.some((menu) => menu.contains(target))
    if (!clickedInsideOpenMenu) {
      closeOpenMenus()
    }
  }


  function applyImportedProfile(parsed) {
    const result = importProfileData(parsed, data.items, progress.items, DEFAULT_SETTINGS.craftedMode)
    progress = {
      settings: {
        ...progress.settings,
        ...result.settingsPatch,
      },
      items: result.items,
    }
    persist()
  }

  function importProgress(event) {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))

        applyImportedProfile(parsed)
      } catch {
        alert('Could not import JSON. Use profile JSON from Warframe.')
      } finally {
        if (event.target) {
          event.target.value = ''
        }
      }
    }
    reader.readAsText(file)
  }

  function clearProgress() {
    if (!confirm('Clear all tracked progress? This cannot be undone.')) return
    progress = {
      settings: {
        ...DEFAULT_SETTINGS,
        theme: progress.settings.theme,
      },
      items: {},
    }
    persist()
    progress = {
      ...progress,
      items: { ...progress.items },
    }
  }

  async function loadData() {
    loading = true
    error = ''

    try {
      const payload = await loadTrackerData(import.meta.env.BASE_URL)

      data = {
        items: payload.items ?? [],
        components: payload.components ?? {},
        blueprints: payload.blueprints ?? {},
        generatedAt: payload.generatedAt ?? null,
        counts: payload.counts ?? {},
      }

      hydrateStoredProgress()
      applyTheme(progress.settings.theme)
    } catch (loadError) {
      error = loadError.message
    } finally {
      loading = false
    }
  }

  $: tabItems = (data.items ?? []).filter((item) => item.tab === activeTab)

  $: activeFilters = {
    variantNormal,
    variantPrime,
    variantLich,
    hideCrafted,
    hideMastered,
    hideSubsumed,
  }

  $: {
    progress
    filteredItems = sortItems(
      tabItems
        .filter((item) => matchesSearch(item, search))
        .filter((item) => matchesVariant(item, activeTab, activeFilters))
        .filter((item) => matchesStatus(progress, item, activeTab, activeFilters)),
      sortBy,
      progress
    )
  }

  $: currentItems = filteredItems.length === 0 && tabItems.length > 0 ? tabItems : filteredItems

  $: {
    progress
    summary = computeSummary(currentItems, activeTab, progress)
  }

  $: statusFilterLabel = getStatusFilterLabel(activeTab, activeFilters)

  $: sortLabel = SORT_OPTIONS.find((option) => option.value === sortBy)?.label ?? 'A to Z'

  onMount(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onThemeChange = () => {
      if (progress.settings.theme === 'system') {
        applyTheme('system')
      }
    }

    if (media.addEventListener) {
      media.addEventListener('change', onThemeChange)
    } else {
      media.addListener(onThemeChange)
    }

    document.addEventListener('pointerdown', onGlobalPointerDown)

    loadData()
    applyTheme(progress.settings.theme)

    return () => {
      if (media.removeEventListener) {
        media.removeEventListener('change', onThemeChange)
      } else {
        media.removeListener(onThemeChange)
      }

      document.removeEventListener('pointerdown', onGlobalPointerDown)
    }
  })
</script>

<main>
  <header>
    <div class="header-row">
      <div>
        <h1>Warframe Mastery Tracker</h1>
        <p class="subtitle">Track blueprints, crafted status, and mastery with WFCD item data.</p>
      </div>
      <div class="settings-anchor header-actions" bind:this={settingsAnchorElement}>
        <a
          class="icon-button icon-link"
          href="https://github.com/actuallyatiger/wf-mastery-tracker"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open GitHub repository"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              fill="currentColor"
              d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38v-1.34c-2.23.49-2.69-.95-2.69-.95-.36-.92-.88-1.16-.88-1.16-.72-.49.05-.48.05-.48.79.06 1.21.82 1.21.82.71 1.2 1.86.86 2.31.66.07-.5.28-.86.5-1.06-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.58.82-2.14-.08-.2-.36-1.01.08-2.11 0 0 .67-.22 2.2.82A7.7 7.7 0 0 1 8 3.87c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.91.08 2.11.51.56.82 1.27.82 2.14 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.14.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8"
            />
          </svg>
        </a>
        <button class="icon-button" on:click={() => (showSettings = !showSettings)} aria-label="Open settings">⚙</button>

        {#if showSettings}
          <SettingsPanel
            settings={progress.settings}
            profileUrl={PROFILE_URL_PC}
            onSetCraftedMode={setCraftedMode}
            onSetTheme={setTheme}
            onImportProgress={importProgress}
            onClearProgress={clearProgress}
          />
        {/if}
      </div>
    </div>
  </header>

  <Toolbar
    tabs={TABS}
    sortOptions={SORT_OPTIONS}
    bind:activeTab
    bind:search
    bind:variantNormal
    bind:variantPrime
    bind:variantLich
    bind:hideCrafted
    bind:hideMastered
    bind:hideSubsumed
    bind:sortBy
    statusFilterLabel={statusFilterLabel}
    sortLabel={sortLabel}
    summary={summary}
    currentItemCount={currentItems.length}
    onResetFilters={resetFilters}
  />

  {#if loading}
    <p class="status">Loading data...</p>
  {:else if error}
    <p class="status error">{error}</p>
  {:else if currentItems.length === 0}
    <div class="status">
      <p>No items match your current filters.</p>
      <button on:click={resetFilters}>Reset filters</button>
    </div>
  {:else}
    <section class="grid">
      {#each currentItems as item}
        <ItemCard
          item={item}
          activeTab={activeTab}
          state={progress.items?.[item.id] ?? EMPTY_ITEM_STATE}
          cleanDisplayName={cleanDisplayName}
          isPrime={isPrime}
          isUmbra={isUmbra}
          isSubsumed={isSubsumedForItem}
          isCrafted={isCraftedForItem}
          isAutoCrafted={isAutoCraftedForItem}
          getBlueprintRows={getBlueprintRows}
          getBlueprintTreeGuides={getBlueprintTreeGuides}
          getBlueprintTooltip={getBlueprintTooltip}
          isComponentRequirementOwned={isComponentRequirementOwned}
          toggleMainBlueprint={toggleMainBlueprint}
          toggleComponentBlueprint={toggleComponentBlueprint}
          toggleCrafted={toggleCrafted}
          toggleMastered={toggleMastered}
          toggleSubsumed={toggleSubsumed}
        />
      {/each}
    </section>
  {/if}

  <footer>
    <p>Last data update: {data.generatedAt ? new Date(data.generatedAt).toLocaleString() : 'unknown'}</p>
    <p>
      {#each TABS as tab, index}
        {data.counts?.[tab.id] ?? 0} {tab.label}{index < TABS.length - 1 ? ', ' : ''}
      {/each}
    </p>
  </footer>
</main>
