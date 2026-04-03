<script>
  import { onMount } from 'svelte'

  const STORAGE_KEY = 'wf-mastery-tracker-v2'
  const DEFAULT_SETTINGS = {
    craftedMode: 'manual',
    theme: 'system',
  }

  const TABS = [
    { id: 'warframes', label: 'Warframes' },
    { id: 'necramechs', label: 'Necramechs' },
    { id: 'archwings', label: 'Archwings' },
    { id: 'primary', label: 'Primary' },
    { id: 'secondary', label: 'Secondary' },
    { id: 'melee', label: 'Melee' },
  ]

  const SORT_OPTIONS = [
    { value: 'name-asc', label: 'A to Z' },
    { value: 'name-desc', label: 'Z to A' },
    { value: 'mr-asc', label: 'MR (Ascending)', weaponsOnly: true },
    { value: 'mr-desc', label: 'MR (Descending)', weaponsOnly: true },
    { value: 'progress-desc', label: 'Blueprint Progress' },
  ]

  let data = {
    warframes: [],
    weapons: [],
    components: {},
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
  let sortBy = 'name-asc'
  let showSettings = false

  async function loadData() {
    loading = true
    error = ''

    try {
      const response = await fetch(`${import.meta.env.BASE_URL}data/items.json`)
      if (!response.ok) {
        throw new Error(`Could not load data (status ${response.status}).`)
      }

      const payload = await response.json()
      data = {
        ...payload,
        warframes: payload.warframes ?? [],
        weapons: payload.weapons ?? [],
        components: payload.components ?? {},
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

  function hydrateStoredProgress() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return
    }

    try {
      const stored = JSON.parse(raw)
      progress = {
        settings: {
          ...DEFAULT_SETTINGS,
          ...(stored.settings ?? {}),
        },
        items: stored.items ?? {},
      }
    } catch {
      progress = {
        settings: { ...DEFAULT_SETTINGS },
        items: {},
      }
    }
  }

  function ensureItemState(item) {
    if (!progress.items[item.id]) {
      progress.items[item.id] = {
        mainBlueprintOwned: false,
        componentBlueprintsOwned: {},
        crafted: false,
        mastered: false,
        subsumed: false,
      }
    }

    return progress.items[item.id]
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
    progress = {
      ...progress,
      items: { ...progress.items },
    }
  }

  function isPrime(item) {
    return item.variant === 'prime' || /\bprime\b/i.test(item.name)
  }

  function cleanDisplayName(name) {
    return String(name ?? '')
      .replace(/^<ARCHWING>\s*/i, '')
      .trim()
  }

  function getNameSortKey(name) {
    return cleanDisplayName(name)
      .replace(/^(?:kuva|tenet|coda)\s+/i, '')
      .trim()
  }

  function isLichVariant(item) {
    if (item.variant === 'lich') {
      return true
    }
    return /\b(kuva|tenet|coda)\b/i.test(item.name)
  }

  function inferWarframeTab(item) {
    if (item.tab) {
      return item.tab
    }

    if (item.productCategory === 'SpaceSuits') {
      return 'archwings'
    }
    if (item.productCategory === 'MechSuits') {
      return 'necramechs'
    }
    return 'warframes'
  }

  function inferWeaponTab(item) {
    if (item.tab) {
      return item.tab
    }

    if (item.productCategory === 'LongGuns' || item.slot === 1) {
      return 'primary'
    }
    if (item.productCategory === 'Pistols' || item.slot === 0) {
      return 'secondary'
    }
    if (item.productCategory === 'Melee' || item.slot === 5) {
      return 'melee'
    }
    return 'other'
  }

  function getFilteredByTab(tabId, warframes, weapons) {
    if (['warframes', 'necramechs', 'archwings'].includes(tabId)) {
      const direct = warframes.filter((item) => item.tab === tabId)
      if (direct.length > 0) {
        return direct
      }

      return warframes.filter((item) => inferWarframeTab(item) === tabId)
    }

    const direct = weapons.filter((item) => item.tab === tabId)
    if (direct.length > 0) {
      return direct
    }

    return weapons.filter((item) => inferWeaponTab(item) === tabId)
  }

  function matchesSearch(item, text) {
    if (!text) {
      return true
    }
    return cleanDisplayName(item.name).toLowerCase().includes(text.toLowerCase())
  }

  function resetFilters() {
    search = ''
    variantNormal = true
    variantPrime = true
    variantLich = true
    sortBy = 'name-asc'
  }

  function isDefaultFilterState() {
    return (
      !search &&
      variantNormal &&
      variantPrime &&
      variantLich
    )
  }

  function buildVariantFilterLabel({ normal, prime, lich, hasLichOption }) {
    const selected = []
    if (normal) selected.push('normal')
    if (prime) selected.push('prime')
    if (hasLichOption && lich) selected.push('lich')

    const options = ['normal', 'prime', ...(hasLichOption ? ['lich'] : [])]

    if (selected.length === options.length) {
      return options
        .map((key) => (key === 'lich' ? 'Kuva/Tenet/Coda' : key === 'prime' ? 'Prime' : 'Normal'))
        .join(' + ')
    }

    if (selected.length === 0) return 'None'

    const labels = selected.map((key) =>
      key === 'lich' ? 'Kuva/Tenet/Coda' : key === 'prime' ? 'Prime' : 'Normal'
    )
    return labels.join(' + ')
  }

  function matchesVariantSelectionForCurrentTab(item, filterState) {
    if (!filterState.visible) {
      return true
    }

    if (filterState.noneSelected) {
      return true
    }

    const isWeaponTab = filterState.hasLichOption
    const lich = isLichVariant(item)
    const prime = isPrime(item)

    if (isWeaponTab && lich) {
      return filterState.lich
    }
    if (prime) {
      return filterState.prime
    }
    return filterState.normal
  }

  function getItemState(item) {
    return ensureItemState(item)
  }

  function getComponentRequirements(item) {
    return item.componentRequirements ?? []
  }

  function getComponentRequirementId(requirement, index) {
    return `${requirement.itemKey}::${index + 1}`
  }

  function getOwnedBlueprintCount(item) {
    const state = ensureItemState(item)
    const requirements = getComponentRequirements(item)
    let owned = state.mainBlueprintOwned && item.mainBlueprintKey ? 1 : 0

    for (let i = 0; i < requirements.length; i += 1) {
      const requirementId = getComponentRequirementId(requirements[i], i)
      if (state.componentBlueprintsOwned?.[requirementId]) {
        owned += 1
      }
    }

    return owned
  }

  function getTotalBlueprintCount(item) {
    return (item.mainBlueprintKey ? 1 : 0) + getComponentRequirements(item).length
  }

  function isCraftReady(item) {
    const state = ensureItemState(item)
    const requirements = getComponentRequirements(item)
    const hasMain = item.mainBlueprintKey ? state.mainBlueprintOwned : true
    const hasComponents = requirements.every(
      (requirement, index) => state.componentBlueprintsOwned?.[getComponentRequirementId(requirement, index)]
    )
    return hasMain && hasComponents
  }

  function isCrafted(item) {
    const state = ensureItemState(item)
    if (progress.settings.craftedMode === 'manual') {
      return state.crafted
    }
    return isCraftReady(item)
  }

  function getProgressScore(item) {
    const total = getTotalBlueprintCount(item)
    if (total === 0) {
      return 0
    }
    return getOwnedBlueprintCount(item) / total
  }

  function sortItems(items, sortState) {
    const next = [...items]
    if (sortState.mode === 'name-asc') {
      next.sort(
        (a, b) =>
          getNameSortKey(a.name).localeCompare(getNameSortKey(b.name)) ||
          cleanDisplayName(a.name).localeCompare(cleanDisplayName(b.name))
      )
      return next
    }
    if (sortState.mode === 'name-desc') {
      next.sort(
        (a, b) =>
          getNameSortKey(b.name).localeCompare(getNameSortKey(a.name)) ||
          cleanDisplayName(b.name).localeCompare(cleanDisplayName(a.name))
      )
      return next
    }
    if (sortState.mode === 'mr-asc') {
      next.sort(
        (a, b) =>
          Number(a.masteryReq ?? 0) - Number(b.masteryReq ?? 0) ||
          cleanDisplayName(a.name).localeCompare(cleanDisplayName(b.name))
      )
      return next
    }
    if (sortState.mode === 'mr-desc') {
      next.sort(
        (a, b) =>
          Number(b.masteryReq ?? 0) - Number(a.masteryReq ?? 0) ||
          cleanDisplayName(a.name).localeCompare(cleanDisplayName(b.name))
      )
      return next
    }
    if (sortState.mode === 'progress-desc') {
      next.sort(
        (a, b) =>
          getProgressScore(b) - getProgressScore(a) ||
          cleanDisplayName(a.name).localeCompare(cleanDisplayName(b.name))
      )
      return next
    }

    next.sort((a, b) => cleanDisplayName(a.name).localeCompare(cleanDisplayName(b.name)))
    return next
  }

  function toggleMainBlueprint(item, value) {
    const state = ensureItemState(item)
    state.mainBlueprintOwned = value
    persist()
  }

  function toggleComponentBlueprint(item, requirement, index, value) {
    const state = ensureItemState(item)
    const requirementId = getComponentRequirementId(requirement, index)

    state.componentBlueprintsOwned = {
      ...(state.componentBlueprintsOwned ?? {}),
      [requirementId]: value,
    }
    persist()
  }

  function toggleCrafted(item, value) {
    const state = ensureItemState(item)
    state.crafted = value
    persist()
  }

  function toggleMastered(item, value) {
    const state = ensureItemState(item)
    state.mastered = value
    persist()
  }

  function toggleSubsumed(item, value) {
    const state = ensureItemState(item)
    state.subsumed = value
    persist()
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

  function exportProgress() {
    const serialized = JSON.stringify(progress, null, 2)
    const blob = new Blob([serialized], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `wf-progress-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function importProgress(event) {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        progress = {
          settings: {
            ...DEFAULT_SETTINGS,
            ...(parsed.settings ?? {}),
          },
          items: parsed.items ?? {},
        }
        persist()
      } catch {
        alert('Could not import progress JSON.')
      }
    }
    reader.readAsText(file)
  }

  function clearProgress() {
    if (!confirm('Clear all tracked progress?')) return
    progress = {
      settings: { ...DEFAULT_SETTINGS },
      items: {},
    }
    persist()
  }

  $: tabItems = getFilteredByTab(activeTab, data.warframes, data.weapons)

  $: variantFilterVisible = ['warframes', 'archwings', 'primary', 'secondary', 'melee'].includes(activeTab)
  $: variantFilterHasLichOption = ['primary', 'secondary', 'melee'].includes(activeTab)
  $: noVariantSelection = variantFilterHasLichOption
    ? !variantNormal && !variantPrime && !variantLich
    : !variantNormal && !variantPrime

  $: variantFilterState = {
    visible: variantFilterVisible,
    hasLichOption: variantFilterHasLichOption,
    noneSelected: noVariantSelection,
    normal: variantNormal,
    prime: variantPrime,
    lich: variantLich,
  }

  $: variantFilterLabel = buildVariantFilterLabel({
    normal: variantNormal,
    prime: variantPrime,
    lich: variantLich,
    hasLichOption: variantFilterHasLichOption,
  })

  $: sortState = {
    mode: sortBy,
    progressItems: progress.items,
  }

  $: isWeaponTab = ['primary', 'secondary', 'melee'].includes(activeTab)
  $: availableSortOptions = SORT_OPTIONS.filter((option) => !option.weaponsOnly || isWeaponTab)
  $: sortLabel = availableSortOptions.find((option) => option.value === sortBy)?.label ?? 'A to Z'

  $: if (
    !isWeaponTab &&
    (sortBy === 'mr-asc' || sortBy === 'mr-desc')
  ) {
    sortBy = 'name-asc'
  }

  $: filteredItems = sortItems(
    tabItems
      .filter((item) => matchesSearch(item, search))
      .filter((item) => matchesVariantSelectionForCurrentTab(item, variantFilterState)),
    sortState
  )

  $: currentItems =
    filteredItems.length === 0 && tabItems.length > 0 && isDefaultFilterState()
      ? sortItems(tabItems, sortState)
      : filteredItems

  $: summary = currentItems.reduce(
    (acc, item) => {
      const state = ensureItemState(item)
      const ownedBlueprints = getOwnedBlueprintCount(item)
      const totalBlueprints = getTotalBlueprintCount(item)
      acc.blueprintOwned += ownedBlueprints
      acc.blueprintTotal += totalBlueprints
      if (isCraftReady(item)) acc.ready += 1
      if (isCrafted(item)) acc.crafted += 1
      if (state.mastered) acc.mastered += 1
      if (activeTab === 'warframes' && state.subsumed) acc.subsumed += 1
      return acc
    },
    { blueprintOwned: 0, blueprintTotal: 0, ready: 0, crafted: 0, mastered: 0, subsumed: 0 }
  )

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

    loadData()
    applyTheme(progress.settings.theme)

    return () => {
      if (media.removeEventListener) {
        media.removeEventListener('change', onThemeChange)
      } else {
        media.removeListener(onThemeChange)
      }
    }
  })
</script>

<main>
  <header>
    <div class="header-row">
      <div>
        <h1>Warframe Mastery Tracker</h1>
        <p class="subtitle">Track blueprints, crafted status, and mastery.</p>
      </div>
      <div class="settings-anchor">
        <button class="icon-button" on:click={() => (showSettings = !showSettings)} aria-label="Open settings">⚙</button>

        {#if showSettings}
          <section class="settings-popover card">
            <h2>Settings</h2>
            <label>
              Crafted behavior
              <select
                value={progress.settings.craftedMode}
                on:change={(event) => setCraftedMode(event.currentTarget.value)}
              >
                <option value="manual">Manual crafted toggle (default)</option>
                <option value="auto">Auto crafted from required blueprints</option>
              </select>
            </label>

            <label>
              Theme
              <select
                value={progress.settings.theme}
                on:change={(event) => setTheme(event.currentTarget.value)}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </label>

            <div class="actions">
              <button on:click={exportProgress}>Export progress</button>
              <label class="file-upload">
                Import progress
                <input type="file" accept="application/json" on:change={importProgress} />
              </label>
              <button class="danger" on:click={clearProgress}>Clear progress</button>
            </div>
          </section>
        {/if}
      </div>
    </div>
  </header>

  <section class="toolbar card">
    <div class="tab-row">
      {#each TABS as tab}
        <button class:active={activeTab === tab.id} on:click={() => (activeTab = tab.id)}>{tab.label}</button>
      {/each}
    </div>

    <div class="controls">
      <div class="search-input-wrap">
        <input placeholder="Search by name" bind:value={search} />
        {#if search}
          <button
            type="button"
            class="search-clear"
            aria-label="Clear search"
            on:click={() => {
              search = ''
            }}
          >
            ×
          </button>
        {/if}
      </div>

      {#if variantFilterVisible}
        <details class="filter-menu">
          <summary>{variantFilterLabel}</summary>
          <div class="filter-list">
            <label>
              <input
                type="checkbox"
                bind:checked={variantNormal}
              />
              Normal
            </label>
            <label>
              <input
                type="checkbox"
                bind:checked={variantPrime}
              />
              Prime
            </label>
            {#if variantFilterHasLichOption}
              <label>
                <input
                  type="checkbox"
                  bind:checked={variantLich}
                />
                Kuva / Tenet / Coda
              </label>
            {/if}
          </div>
        </details>
      {/if}

      <details class="filter-menu sort-menu">
        <summary>{sortLabel}</summary>
        <div class="filter-list">
          {#each availableSortOptions as option}
            <button
              type="button"
              class:active={sortBy === option.value}
              on:click={(event) => {
                sortBy = option.value
                const parent = event.currentTarget.closest('details')
                if (parent) {
                  parent.removeAttribute('open')
                }
              }}
            >
              {option.label}
            </button>
          {/each}
        </div>
      </details>
    </div>

    <div class="stats">
      <span>Blueprints: {summary.blueprintOwned}/{summary.blueprintTotal}</span>
      <span>Craft-ready: {summary.ready}/{currentItems.length}</span>
      <span>Crafted: {summary.crafted}/{currentItems.length}</span>
      <span>Mastered: {summary.mastered}/{currentItems.length}</span>
      {#if activeTab === 'warframes'}
        <span>Subsumed: {summary.subsumed}/{currentItems.length}</span>
      {/if}
    </div>
  </section>

  {#if loading}
    <p class="status">Loading data...</p>
  {:else if error}
    <p class="status error">{error}</p>
  {:else if currentItems.length === 0}
    {#if tabItems.length > 0}
      <div class="status">
        <p>No items match your current filters since the last data update.</p>
        <button on:click={resetFilters}>Reset filters</button>
      </div>
    {:else}
      <p class="status">No items available for this tab since the last data update.</p>
    {/if}
  {:else}
    <section class="grid">
      {#each currentItems as item}
        {@const state = getItemState(item)}
        {@const requirements = getComponentRequirements(item)}
        <article class="card item-card">
          <div class="title-row">
            <h3>{cleanDisplayName(item.name)}</h3>
            {#if ['primary', 'secondary', 'melee'].includes(activeTab)}
              <small>MR {item.masteryReq}</small>
            {/if}
          </div>

          {#if item.mainBlueprintKey}
            <label class="check-row">
              <input
                type="checkbox"
                checked={state.mainBlueprintOwned}
                on:change={(event) => toggleMainBlueprint(item, event.currentTarget.checked)}
              />
              Main blueprint owned
            </label>
          {/if}

          {#if requirements.length > 0}
            <div class="component-list">
              <p>Component blueprints</p>
              {#each requirements as requirement, index}
                {@const reqId = getComponentRequirementId(requirement, index)}
                <label class="check-row">
                  <input
                    type="checkbox"
                    checked={Boolean(state.componentBlueprintsOwned?.[reqId])}
                    on:change={(event) =>
                      toggleComponentBlueprint(item, requirement, index, event.currentTarget.checked)}
                  />
                  {cleanDisplayName(requirement.name)}
                </label>
              {/each}
            </div>
          {/if}

          <details>
            <summary>Recipe requirements ({item.requirements.length})</summary>
            {#if item.requirements.length === 0}
              <p class="tiny">No requirements found.</p>
            {:else}
              <ul>
                {#each item.requirements as requirement}
                  {@const count = Math.max(1, requirement.count ?? 1)}
                  <li>{count === 1 ? cleanDisplayName(requirement.name) : `${cleanDisplayName(requirement.name)} x${count}`}</li>
                {/each}
              </ul>
            {/if}
          </details>

          <div class="toggle-grid">
            <label class="check-row">
              <input
                type="checkbox"
                checked={isCrafted(item)}
                aria-readonly={progress.settings.craftedMode === 'auto'}
                on:click={(event) => {
                  if (progress.settings.craftedMode === 'auto') {
                    event.preventDefault()
                  }
                }}
                on:change={(event) => {
                  if (progress.settings.craftedMode !== 'auto') {
                    toggleCrafted(item, event.currentTarget.checked)
                  }
                }}
              />
              Crafted
            </label>

            <label class="check-row">
              <input
                type="checkbox"
                checked={state.mastered}
                on:change={(event) => toggleMastered(item, event.currentTarget.checked)}
              />
              Mastered
            </label>

            {#if activeTab === 'warframes'}
              <label class="check-row">
                <input
                  type="checkbox"
                  checked={state.subsumed}
                  on:change={(event) => toggleSubsumed(item, event.currentTarget.checked)}
                />
                Subsumed
              </label>
            {/if}
          </div>
        </article>
      {/each}
    </section>
  {/if}

  <footer>
    <p>Last data update: {data.generatedAt ? new Date(data.generatedAt).toLocaleString() : 'unknown'}</p>
    <p>
      Counts: {data.counts.warframes ?? 0} Warframes, {data.counts.necramechs ?? 0} Necramechs,
      {data.counts.archwings ?? 0} Archwings, {data.counts.primary ?? 0} Primary,
      {data.counts.secondary ?? 0} Secondary, {data.counts.melee ?? 0} Melee
    </p>
  </footer>
</main>
