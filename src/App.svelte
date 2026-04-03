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
  let hideCrafted = false
  let hideMastered = false
  let hideSubsumed = false
  let sortBy = 'name-asc'
  let showSettings = false
  let settingsAnchorElement

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
      migrateLegacyProgressFormat()
      applyTheme(progress.settings.theme)
    } catch (loadError) {
      error = loadError.message
    } finally {
      loading = false
    }
  }

  function migrateLegacyProgressFormat() {
    const allItems = [...(data.warframes ?? []), ...(data.weapons ?? [])]
    if (allItems.length === 0) {
      return false
    }

    const itemsById = new Map(allItems.map((item) => [item.id, item]))
    const nextItems = { ...(progress.items ?? {}) }
    let migratedAny = false

    for (const [itemId, itemState] of Object.entries(progress.items ?? {})) {
      const item = itemsById.get(itemId)
      if (!item || !itemState || typeof itemState !== 'object') {
        continue
      }

      const requirements = getComponentRequirements(item)
      if (requirements.length === 0) {
        continue
      }

      const migratedOwned = {}
      for (let i = 0; i < requirements.length; i += 1) {
        const requirement = requirements[i]
        if (isComponentRequirementOwned(itemState, requirement, i, requirements)) {
          migratedOwned[getComponentRequirementId(requirement, i)] = true
        }
      }

      const currentOwned = itemState.componentBlueprintsOwned ?? {}
      const currentTrueKeys = Object.keys(currentOwned).filter((key) => currentOwned[key])
      const migratedKeys = Object.keys(migratedOwned)

      const keysMatch =
        currentTrueKeys.length === migratedKeys.length &&
        currentTrueKeys.every((key) => migratedOwned[key])

      if (!keysMatch) {
        nextItems[itemId] = {
          ...itemState,
          componentBlueprintsOwned: migratedOwned,
        }
        migratedAny = true
      }
    }

    if (migratedAny) {
      progress = {
        ...progress,
        items: nextItems,
      }
      persist()
    }

    return migratedAny
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
    let nextItems = progress.items ?? {}

    if (progress.settings.craftedMode === 'auto') {
      const allItems = [...(data.warframes ?? []), ...(data.weapons ?? [])]
      const itemsById = new Map(allItems.map((item) => [item.id, item]))
      const syncedItems = { ...nextItems }

      for (const [itemId, itemState] of Object.entries(nextItems)) {
        const item = itemsById.get(itemId)
        if (!item || !itemState || typeof itemState !== 'object') {
          continue
        }

        const requirements = getComponentRequirements(item)
        const hasMain = item.mainBlueprintKey ? Boolean(itemState.mainBlueprintOwned) : true
        const hasComponents = requirements.every((requirement, index) =>
          isComponentRequirementOwned(itemState, requirement, index, requirements)
        )
        const crafted = hasMain && hasComponents

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
      items: nextItems,
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextProgress))
    progress = {
      ...nextProgress,
      items: { ...nextProgress.items },
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
      .replace(/^mk1[-\s]+/i, '')
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
    hideCrafted = false
    hideMastered = false
    hideSubsumed = false
    sortBy = 'name-asc'
  }

  function getVariantSelectedCount(hasLichOption = variantFilterHasLichOption) {
    return (
      (variantNormal ? 1 : 0) +
      (variantPrime ? 1 : 0) +
      (hasLichOption && variantLich ? 1 : 0)
    )
  }

  function setVariantChecked(key, nextChecked) {
    const currentChecked =
      key === 'normal' ? variantNormal : key === 'prime' ? variantPrime : variantLich

    if (!nextChecked && currentChecked) {
      const selectedCount = getVariantSelectedCount()
      if (selectedCount <= 1) {
        return
      }
    }

    if (key === 'normal') variantNormal = nextChecked
    if (key === 'prime') variantPrime = nextChecked
    if (key === 'lich') variantLich = nextChecked
  }

  function shouldBlockVariantUncheck(key) {
    const currentChecked =
      key === 'normal' ? variantNormal : key === 'prime' ? variantPrime : variantLich

    return currentChecked && getVariantSelectedCount() <= 1
  }

  function isDefaultFilterState() {
    return (
      !search &&
      variantNormal &&
      variantPrime &&
      variantLich &&
      !hideCrafted &&
      !hideMastered &&
      !hideSubsumed
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

  function buildStatusFilterLabel({ hideCrafted, hideMastered, hideSubsumed, isWarframeTab }) {
    const labels = []
    if (hideCrafted) labels.push('Hide crafted')
    if (hideMastered) labels.push('Hide mastered')
    if (isWarframeTab && hideSubsumed) labels.push('Hide subsumed')
    return labels.length === 0 ? 'Status filters' : labels.join(' + ')
  }

  function matchesStatusVisibility(item, statusState) {
    const state = ensureItemState(item)
    if (statusState.hideCrafted && isCrafted(item)) {
      return false
    }
    if (statusState.hideMastered && state.mastered) {
      return false
    }
    if (statusState.hideSubsumed && statusState.isWarframeTab && isSubsumed(item)) {
      return false
    }
    return true
  }

  function getItemState(item) {
    return ensureItemState(item)
  }

  function getComponentRequirements(item) {
    return item.componentRequirements ?? []
  }

  function getMainBlueprintName(item) {
    if (!item.mainBlueprintKey) {
      return `${cleanDisplayName(item.name)} Blueprint`
    }

    return data.blueprints?.[item.mainBlueprintKey] ?? `${cleanDisplayName(item.name)} Blueprint`
  }

  function getBlueprintRows(item) {
    const rows = []

    if (item.mainBlueprintKey) {
      rows.push({
        kind: 'main',
        id: item.mainBlueprintKey,
        itemKey: item.mainBlueprintKey,
        name: getMainBlueprintName(item),
        level: 0,
      })
    }

    for (const [componentIndex, requirement] of getComponentRequirements(item).entries()) {
      rows.push({
        kind: 'component',
        ...requirement,
        componentIndex,
        level: Number(requirement.level ?? 0) + (item.mainBlueprintKey ? 1 : 0),
      })
    }

    return rows
  }

  function formatRequirementTooltip(requirements) {
    const lines = Array.isArray(requirements)
      ? requirements.map((requirement) => {
        const count = Math.max(1, Number(requirement.count ?? 1))
        const name = cleanDisplayName(requirement.name)
        return count === 1 ? name : `${name} x${count}`
      })
      : []

    if (lines.length === 0) {
      return 'Resources Required:\nNone'
    }

    return `Resources Required:\n${lines.join('\n')}`
  }

  function getBlueprintTooltip(item, row) {
    if (row.kind === 'main') {
      return formatRequirementTooltip(item.requirements ?? [])
    }

    const requirements = data.components?.[row.itemKey]?.requirements ?? []
    return formatRequirementTooltip(requirements)
  }

  function getBlueprintTreeGuides(rows, index) {
    const row = rows[index]
    const level = Number(row?.level ?? 0)
    if (level <= 0) {
      return []
    }

    function findAncestorIndex(targetDepth) {
      for (let i = index - 1; i >= 0; i -= 1) {
        const candidateLevel = Number(rows[i]?.level ?? 0)
        if (candidateLevel < targetDepth) {
          return -1
        }
        if (candidateLevel === targetDepth) {
          return i
        }
      }
      return -1
    }

    function hasNextSiblingAtDepth(fromIndex, targetDepth) {
      for (let i = fromIndex + 1; i < rows.length; i += 1) {
        const nextLevel = Number(rows[i]?.level ?? 0)
        if (nextLevel < targetDepth) {
          break
        }
        if (nextLevel === targetDepth) {
          return true
        }
      }

      return false
    }

    function hasPreviousSiblingAtDepth(fromIndex, targetDepth) {
      for (let i = fromIndex - 1; i >= 0; i -= 1) {
        const previousLevel = Number(rows[i]?.level ?? 0)
        if (previousLevel < targetDepth) {
          break
        }
        if (previousLevel === targetDepth) {
          return true
        }
      }

      return false
    }

    const guides = []

    for (let depth = 1; depth < level; depth += 1) {
      const ancestorIndex = findAncestorIndex(depth)
      const ancestorHasNextSibling =
        ancestorIndex >= 0 && hasNextSiblingAtDepth(ancestorIndex, depth)
      guides.push(ancestorHasNextSibling ? 'pipe' : 'blank')
    }

    const hasNextSibling = hasNextSiblingAtDepth(index, level)
    const hasPreviousSibling = hasPreviousSiblingAtDepth(index, level)

    if (hasNextSibling) {
      guides.push(hasPreviousSibling ? 'tee' : 'tee-root')
    } else {
      guides.push('elbow')
    }
    return guides
  }

  function getComponentRequirementId(requirement, index) {
    return requirement.id ?? `${requirement.itemKey}::${index + 1}`
  }

  function getLegacyComponentRequirementId(requirement, index) {
    if (!requirement?.itemKey) {
      return null
    }
    return `${String(requirement.itemKey)}::${index + 1}`
  }

  function getComponentRequirementAliases(requirement, index) {
    const aliases = new Set([getComponentRequirementId(requirement, index)])
    const legacyId = getLegacyComponentRequirementId(requirement, index)
    if (legacyId) {
      aliases.add(legacyId)
    }
    return aliases
  }

  function isComponentRequirementOwned(state, requirement, index, requirements = null) {
    const owned = state.componentBlueprintsOwned ?? {}
    const aliases = getComponentRequirementAliases(requirement, index)

    for (const alias of aliases) {
      if (owned[alias]) {
        return true
      }
    }

    if (!requirement?.itemKey || !owned[String(requirement.itemKey)]) {
      return false
    }

    // Legacy fallback for very old saves that stored raw item keys with no instance suffix.
    if (Array.isArray(requirements)) {
      const sameKeyCount = requirements.filter((row) => row.itemKey === requirement.itemKey).length
      return sameKeyCount === 1
    }

    return false
  }

  function getOwnedBlueprintCount(item) {
    const state = ensureItemState(item)
    const requirements = getComponentRequirements(item)
    let owned = state.mainBlueprintOwned && item.mainBlueprintKey ? 1 : 0

    for (let i = 0; i < requirements.length; i += 1) {
      if (isComponentRequirementOwned(state, requirements[i], i, requirements)) {
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
    const hasComponents = requirements.every((requirement, index) =>
      isComponentRequirementOwned(state, requirement, index, requirements)
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
    const currentOwned = { ...(state.componentBlueprintsOwned ?? {}) }
    const aliases = getComponentRequirementAliases(requirement, index)

    if (value) {
      const canonicalId = getComponentRequirementId(requirement, index)
      currentOwned[canonicalId] = true
    } else {
      for (const key of aliases) {
        delete currentOwned[key]
      }
    }

    state.componentBlueprintsOwned = currentOwned
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

  function isSubsumed(item) {
    if (isPrime(item)) {
      return false
    }
    return ensureItemState(item).subsumed
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
    const exportPayload = {
      items: progress.items ?? {},
    }

    const serialized = JSON.stringify(exportPayload, null, 2)
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
            ...progress.settings,
            craftedMode: DEFAULT_SETTINGS.craftedMode,
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
    if (!confirm('Clear all tracked progress? This cannot be undone.')) return
    progress = {
      settings: {
        ...DEFAULT_SETTINGS,
        theme: progress.settings.theme,
      },
      items: {},
    }
    persist()
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

  $: tabItems = getFilteredByTab(activeTab, data.warframes, data.weapons)

  $: variantFilterVisible = ['warframes', 'archwings', 'primary', 'secondary', 'melee'].includes(activeTab)
  $: variantFilterHasLichOption = ['primary', 'secondary', 'melee'].includes(activeTab)

  $: if (variantFilterHasLichOption && getVariantSelectedCount(true) === 0) {
    variantNormal = true
  }

  $: if (!variantFilterHasLichOption && getVariantSelectedCount(false) === 0) {
    variantNormal = true
  }

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

  $: statusFilterState = {
    hideCrafted,
    hideMastered,
    hideSubsumed,
    isWarframeTab: activeTab === 'warframes',
  }

  $: statusFilterLabel = buildStatusFilterLabel(statusFilterState)

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
      .filter((item) => matchesVariantSelectionForCurrentTab(item, variantFilterState))
      .filter((item) => matchesStatusVisibility(item, statusFilterState)),
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
      if (activeTab === 'warframes' && isSubsumed(item)) acc.subsumed += 1
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
        <p class="subtitle">Track blueprints, crafted status, and mastery.</p>
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
          <summary><span class="summary-label">{variantFilterLabel}</span></summary>
          <div class="filter-list">
            <label>
              <input
                type="checkbox"
                checked={variantNormal}
                on:click={(event) => {
                  if (shouldBlockVariantUncheck('normal')) {
                    event.preventDefault()
                  }
                }}
                on:change={(event) => setVariantChecked('normal', event.currentTarget.checked)}
              />
              Normal
            </label>
            <label>
              <input
                type="checkbox"
                checked={variantPrime}
                on:click={(event) => {
                  if (shouldBlockVariantUncheck('prime')) {
                    event.preventDefault()
                  }
                }}
                on:change={(event) => setVariantChecked('prime', event.currentTarget.checked)}
              />
              Prime
            </label>
            {#if variantFilterHasLichOption}
              <label>
                <input
                  type="checkbox"
                  checked={variantLich}
                  on:click={(event) => {
                    if (shouldBlockVariantUncheck('lich')) {
                      event.preventDefault()
                    }
                  }}
                  on:change={(event) => setVariantChecked('lich', event.currentTarget.checked)}
                />
                Kuva / Tenet / Coda
              </label>
            {/if}
          </div>
        </details>
      {/if}

      <details class="filter-menu status-menu">
        <summary><span class="summary-label">{statusFilterLabel}</span></summary>
        <div class="filter-list">
          <label>
            <input type="checkbox" bind:checked={hideCrafted} />
            Hide crafted
          </label>
          <label>
            <input type="checkbox" bind:checked={hideMastered} />
            Hide mastered
          </label>
          {#if activeTab === 'warframes'}
            <label>
              <input type="checkbox" bind:checked={hideSubsumed} />
              Hide subsumed
            </label>
          {/if}
        </div>
      </details>

      <details class="filter-menu sort-menu">
        <summary><span class="summary-label">{sortLabel}</span></summary>
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
        {@const hasBlueprintRows = getBlueprintRows(item).length > 0}
        <article class="card item-card">
          <div class="title-row">
            <h3>{cleanDisplayName(item.name)}</h3>
            {#if ['primary', 'secondary', 'melee'].includes(activeTab)}
              <small>MR {item.masteryReq}</small>
            {/if}
          </div>

          {#if hasBlueprintRows}
            {@const blueprintRows = getBlueprintRows(item)}
            <div class="blueprints-section">
              <p class="blueprints-heading">Blueprints</p>
              {#each blueprintRows as row, index}
                <label
                  class="check-row component-row"
                  class:component-row-nested={Number(row.level ?? 0) > 0}
                  class:component-row-deep={Number(row.level ?? 0) > 1}
                  style={`--blueprint-level:${Math.max(0, Number(row.level ?? 0))}`}
                >
                  {#if Number(row.level ?? 0) > 0}
                    <span class="tree-guides" aria-hidden="true">
                      {#each getBlueprintTreeGuides(blueprintRows, index) as guide}
                        <span class={`tree-guide ${guide}`}></span>
                      {/each}
                    </span>
                  {/if}

                  {#if row.kind === 'main'}
                    <input
                      type="checkbox"
                      checked={state.mainBlueprintOwned}
                      on:change={(event) => toggleMainBlueprint(item, event.currentTarget.checked)}
                    />
                    <span class="component-row-text" data-tooltip={getBlueprintTooltip(item, row)}>
                      {cleanDisplayName(row.name)}
                    </span>
                  {:else}
                    {@const componentIndex = Number(row.componentIndex ?? index)}
                    <input
                      type="checkbox"
                      checked={isComponentRequirementOwned(
                        state,
                        row,
                        componentIndex,
                        getComponentRequirements(item)
                      )}
                      on:change={(event) =>
                        toggleComponentBlueprint(
                          item,
                          row,
                          componentIndex,
                          event.currentTarget.checked
                        )}
                    />
                    <span class="component-row-text" data-tooltip={getBlueprintTooltip(item, row)}>
                      {cleanDisplayName(row.name)}
                    </span>
                  {/if}
                </label>
              {/each}
            </div>
          {/if}

          <div class="toggle-grid" class:with-blueprint-divider={hasBlueprintRows}>
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

            {#if activeTab === 'warframes' && !isPrime(item)}
              <label class="check-row">
                <input
                  type="checkbox"
                  checked={isSubsumed(item)}
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
