<script>
  import { onMount } from 'svelte'

  const STORAGE_KEY = 'wf-mastery-tracker-v1'
  const DEFAULT_SETTINGS = {
    craftedMode: 'manual',
  }

  let data = {
    warframes: [],
    weapons: [],
    components: {},
    blueprints: {},
    generatedAt: null,
    counts: { warframes: 0, weapons: 0, components: 0 },
  }

  let progress = {
    settings: { ...DEFAULT_SETTINGS },
    items: {},
  }

  let loading = true
  let error = ''
  let activeTab = 'warframes'
  let search = ''
  let category = 'all'

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
        blueprints: payload.blueprints ?? {},
        counts: payload.counts ?? {
          warframes: payload.warframes?.length ?? 0,
          weapons: payload.weapons?.length ?? 0,
          components: Object.keys(payload.components ?? {}).length,
        },
      }

      hydrateStoredProgress()
    } catch (loadError) {
      error = loadError.message
    } finally {
      loading = false
    }
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

  function getItemState(item) {
    return ensureItemState(item)
  }

  function isCrafted(item) {
    const state = ensureItemState(item)
    if (progress.settings.craftedMode === 'manual') {
      return state.crafted
    }

    const hasMain = item.mainBlueprintKey ? state.mainBlueprintOwned : true
    const hasAllComponents = (item.componentBlueprintKeys ?? []).every(
      (componentKey) => state.componentBlueprintsOwned?.[componentKey]
    )
    return hasMain && hasAllComponents
  }

  function isCraftReady(item) {
    const state = ensureItemState(item)
    const hasMain = item.mainBlueprintKey ? state.mainBlueprintOwned : true
    const hasAllComponents = (item.componentBlueprintKeys ?? []).every(
      (componentKey) => state.componentBlueprintsOwned?.[componentKey]
    )

    return hasMain && hasAllComponents
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
    progress = {
      ...progress,
      items: { ...progress.items },
    }
  }

  function toggleMainBlueprint(item, value) {
    const state = ensureItemState(item)
    state.mainBlueprintOwned = value
    persist()
  }

  function toggleComponentBlueprint(item, componentKey, value) {
    const state = ensureItemState(item)
    state.componentBlueprintsOwned = {
      ...(state.componentBlueprintsOwned ?? {}),
      [componentKey]: value,
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
    if (!file) {
      return
    }

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
    if (!confirm('Clear all tracked progress?')) {
      return
    }

    progress = {
      settings: { ...DEFAULT_SETTINGS },
      items: {},
    }
    persist()
  }

  function matchesSearch(item, text) {
    if (!text) {
      return true
    }

    const needle = text.toLowerCase()
    return item.name.toLowerCase().includes(needle)
  }

  $: currentItems = activeTab === 'warframes' ? data.warframes : data.weapons
  $: categories = ['all', ...new Set(currentItems.map((item) => item.productCategory).filter(Boolean))]
  $: filteredItems = currentItems
    .filter((item) => matchesSearch(item, search))
    .filter((item) => category === 'all' || item.productCategory === category)

  $: summary = currentItems.reduce(
    (acc, item) => {
      const state = ensureItemState(item)
      const crafted = isCrafted(item)
      const ready = isCraftReady(item)

      if (state.mainBlueprintOwned) acc.mainBlueprintOwned += 1
      if (ready) acc.ready += 1
      if (crafted) acc.crafted += 1
      if (state.mastered) acc.mastered += 1
      if (activeTab === 'warframes' && state.subsumed) acc.subsumed += 1
      return acc
    },
    { mainBlueprintOwned: 0, ready: 0, crafted: 0, mastered: 0, subsumed: 0 }
  )

  onMount(loadData)
</script>

<main>
  <header>
    <h1>Warframe Mastery Tracker</h1>
    <p class="subtitle">
      Track per-item blueprints and progression for Warframes and Weapons. Data source: Digital Extremes Public Export.
    </p>
  </header>

  <section class="settings card">
    <h2>Settings</h2>
    <label>
      Crafted behavior
      <select
        value={progress.settings.craftedMode}
        on:change={(event) => setCraftedMode(event.currentTarget.value)}
      >
        <option value="manual">Manual crafted toggle (default)</option>
        <option value="auto">Auto crafted from blueprints/components</option>
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

  <section class="toolbar card">
    <div class="tab-row">
      <button class:active={activeTab === 'warframes'} on:click={() => (activeTab = 'warframes')}>Warframes</button>
      <button class:active={activeTab === 'weapons'} on:click={() => (activeTab = 'weapons')}>Weapons</button>
    </div>

    <div class="controls">
      <input placeholder="Search by name" bind:value={search} />
      <select bind:value={category}>
        {#each categories as option}
          <option value={option}>{option === 'all' ? 'All categories' : option}</option>
        {/each}
      </select>
    </div>

    <div class="stats">
      <span>Main blueprints: {summary.mainBlueprintOwned}/{currentItems.length}</span>
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
  {:else if filteredItems.length === 0}
    <p class="status">No items match your current filters.</p>
  {:else}
    <section class="grid">
      {#each filteredItems as item}
        {@const state = getItemState(item)}
        <article class="card item-card">
          <div class="title-row">
            <h3>{item.name}</h3>
            <small>MR {item.masteryReq}</small>
          </div>
          <p class="meta">{item.productCategory}</p>

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

          {#if item.componentBlueprintKeys.length > 0}
            <div class="component-list">
              <p>Component blueprints</p>
              {#each item.componentBlueprintKeys as componentKey}
                <label class="check-row">
                  <input
                    type="checkbox"
                    checked={Boolean(state.componentBlueprintsOwned?.[componentKey])}
                    on:change={(event) =>
                      toggleComponentBlueprint(item, componentKey, event.currentTarget.checked)}
                  />
                  {data.components?.[componentKey]?.name ?? componentKey}
                </label>
              {/each}
            </div>
          {/if}

          <details>
            <summary>Recipe requirements ({item.requirements.length})</summary>
            {#if item.requirements.length === 0}
              <p class="tiny">No recipe requirements found in current export.</p>
            {:else}
              <ul>
                {#each item.requirements as requirement}
                  <li>{requirement.count}x {requirement.name}</li>
                {/each}
              </ul>
            {/if}
          </details>

          <div class="toggle-grid">
            <label class="check-row">
              <input
                type="checkbox"
                disabled={progress.settings.craftedMode === 'auto'}
                checked={isCrafted(item)}
                on:change={(event) => toggleCrafted(item, event.currentTarget.checked)}
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
    <p>
      Last data update: {data.generatedAt ? new Date(data.generatedAt).toLocaleString() : 'unknown'}
    </p>
    <p>
      Counts: {data.counts.warframes} Warframes, {data.counts.weapons} Weapons, {data.counts.components} craftable components
    </p>
  </footer>
</main>
