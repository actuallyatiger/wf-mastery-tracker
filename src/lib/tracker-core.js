export const STORAGE_KEY = "wf-mastery-tracker-v3";

export const DEFAULT_SETTINGS = {
  craftedMode: "manual",
  theme: "system",
};

export const TABS = [
  { id: "warframes", label: "Warframes" },
  { id: "primary", label: "Primary" },
  { id: "secondary", label: "Secondary" },
  { id: "melee", label: "Melee" },
  { id: "archwings", label: "Archwings" },
  { id: "arch-guns", label: "Arch-Guns" },
  { id: "arch-melee", label: "Arch-Melee" },
  { id: "sentinels", label: "Sentinels" },
  { id: "sentinel-weapons", label: "Sentinel Weapons" },
  { id: "pets", label: "Pets" },
];

export const SORT_OPTIONS = [
  { value: "name-asc", label: "A to Z" },
  { value: "name-desc", label: "Z to A" },
  { value: "mr-asc", label: "MR (Ascending)" },
  { value: "mr-desc", label: "MR (Descending)" },
  { value: "progress-desc", label: "Blueprint Progress" },
];

export const PROFILE_URL_PC = "https://api.warframe.com/cdn/getProfileViewingData.php?playerId=";

export const EMPTY_ITEM_STATE = Object.freeze({
  mainBlueprintOwned: false,
  componentBlueprintsOwned: Object.freeze({}),
  crafted: false,
  mastered: false,
  subsumed: false,
});

export function cleanDisplayName(name) {
  return String(name ?? "")
    .replace(/^<ARCHWING>\s*/i, "")
    .trim();
}

export function getNameSortKey(name) {
  return cleanDisplayName(name)
    .replace(/^(?:kuva|tenet|coda)\s+/i, "")
    .replace(/^mk1[-\s]+/i, "")
    .trim();
}

export function isPrime(item) {
  return item.variant === "prime" || /\bprime\b/i.test(item.name);
}

export function isUmbra(item) {
  return /\bumbra\b$/i.test(cleanDisplayName(item.name));
}

export function isLichVariant(item) {
  if (item.variant === "lich") {
    return true;
  }

  return /\b(kuva|tenet|coda)\b/i.test(item.name);
}

export function createItemState() {
  return {
    mainBlueprintOwned: false,
    componentBlueprintsOwned: {},
    crafted: false,
    mastered: false,
    subsumed: false,
  };
}

export function normalizeItemState(itemState) {
  return {
    mainBlueprintOwned: Boolean(itemState?.mainBlueprintOwned),
    componentBlueprintsOwned: { ...(itemState?.componentBlueprintsOwned ?? {}) },
    crafted: Boolean(itemState?.crafted),
    mastered: Boolean(itemState?.mastered),
    subsumed: Boolean(itemState?.subsumed),
  };
}

export function normalizeItems(items) {
  const next = {};

  for (const [itemId, itemState] of Object.entries(items ?? {})) {
    next[itemId] = normalizeItemState(itemState);
  }

  return next;
}

export function getItemState(progress, item) {
  return progress.items?.[item.id] ?? EMPTY_ITEM_STATE;
}

export function getComponentRequirements(item) {
  return item.componentRequirements ?? [];
}

export function getMainBlueprintName(item, blueprints) {
  if (!item.mainBlueprintKey) {
    return `${cleanDisplayName(item.name)} Blueprint`;
  }

  return blueprints?.[item.mainBlueprintKey] ?? `${cleanDisplayName(item.name)} Blueprint`;
}

export function getComponentRequirementId(requirement, index) {
  return requirement.id ?? `${requirement.itemKey}::${index + 1}`;
}

export function isComponentRequirementOwned(state, requirement, index) {
  const owned = state.componentBlueprintsOwned ?? {};
  const requirementId = getComponentRequirementId(requirement, index);
  return Boolean(owned[requirementId]);
}

export function getBlueprintRows(item, blueprints) {
  const rows = [];

  if (item.mainBlueprintKey) {
    rows.push({
      kind: "main",
      id: item.mainBlueprintKey,
      itemKey: item.mainBlueprintKey,
      name: getMainBlueprintName(item, blueprints),
      level: 0,
    });
  }

  for (const [componentIndex, requirement] of getComponentRequirements(item).entries()) {
    rows.push({
      kind: "component",
      ...requirement,
      componentIndex,
      level: Number(requirement.level ?? 0) + (item.mainBlueprintKey ? 1 : 0),
    });
  }

  return rows;
}

export function getBlueprintTreeGuides(rows, index) {
  const row = rows[index];
  const level = Number(row?.level ?? 0);
  if (level <= 0) {
    return [];
  }

  function findAncestorIndex(targetDepth) {
    for (let i = index - 1; i >= 0; i -= 1) {
      const candidateLevel = Number(rows[i]?.level ?? 0);
      if (candidateLevel < targetDepth) {
        return -1;
      }
      if (candidateLevel === targetDepth) {
        return i;
      }
    }
    return -1;
  }

  function hasNextSiblingAtDepth(fromIndex, targetDepth) {
    for (let i = fromIndex + 1; i < rows.length; i += 1) {
      const nextLevel = Number(rows[i]?.level ?? 0);
      if (nextLevel < targetDepth) {
        break;
      }
      if (nextLevel === targetDepth) {
        return true;
      }
    }

    return false;
  }

  function hasPreviousSiblingAtDepth(fromIndex, targetDepth) {
    for (let i = fromIndex - 1; i >= 0; i -= 1) {
      const previousLevel = Number(rows[i]?.level ?? 0);
      if (previousLevel < targetDepth) {
        break;
      }
      if (previousLevel === targetDepth) {
        return true;
      }
    }

    return false;
  }

  const guides = [];

  for (let depth = 1; depth < level; depth += 1) {
    const ancestorIndex = findAncestorIndex(depth);
    const ancestorHasNextSibling = ancestorIndex >= 0 && hasNextSiblingAtDepth(ancestorIndex, depth);
    guides.push(ancestorHasNextSibling ? "pipe" : "blank");
  }

  const hasNextSibling = hasNextSiblingAtDepth(index, level);
  const hasPreviousSibling = hasPreviousSiblingAtDepth(index, level);

  if (hasNextSibling) {
    guides.push(hasPreviousSibling ? "tee" : "tee-root");
  } else {
    guides.push("elbow");
  }

  return guides;
}

export function formatRequirementTooltip(requirements) {
  const lines = Array.isArray(requirements)
    ? requirements.map((requirement) => {
        const count = Math.max(1, Number(requirement.count ?? 1));
        const name = cleanDisplayName(requirement.name);
        return count === 1 ? name : `${name} x${count}`;
      })
    : [];

  if (lines.length === 0) {
    return "Resources Required:\nNone";
  }

  return `Resources Required:\n${lines.join("\n")}`;
}

export function getBlueprintTooltip(item, row, components) {
  if (row.kind === "main") {
    return formatRequirementTooltip(item.requirements ?? []);
  }

  const requirements = components?.[row.itemKey]?.requirements ?? [];
  return formatRequirementTooltip(requirements);
}

export function getOwnedBlueprintCount(progress, item) {
  const state = getItemState(progress, item);
  const requirements = getComponentRequirements(item);
  let owned = state.mainBlueprintOwned && item.mainBlueprintKey ? 1 : 0;

  for (let i = 0; i < requirements.length; i += 1) {
    if (isComponentRequirementOwned(state, requirements[i], i)) {
      owned += 1;
    }
  }

  return owned;
}

export function getTotalBlueprintCount(item) {
  return (item.mainBlueprintKey ? 1 : 0) + getComponentRequirements(item).length;
}

export function isCraftReady(progress, item) {
  const state = getItemState(progress, item);
  const requirements = getComponentRequirements(item);
  const hasMain = item.mainBlueprintKey ? state.mainBlueprintOwned : true;
  const hasComponents = requirements.every((requirement, index) =>
    isComponentRequirementOwned(state, requirement, index)
  );
  return hasMain && hasComponents;
}

export function isAutoCrafted(progress, item) {
  return progress.settings.craftedMode === "auto" && getComponentRequirements(item).length > 0;
}

export function isCrafted(progress, item) {
  const state = getItemState(progress, item);
  if (isAutoCrafted(progress, item)) {
    return isCraftReady(progress, item);
  }

  return state.crafted;
}

export function isSubsumed(progress, item) {
  if (isPrime(item) || isUmbra(item)) {
    return false;
  }

  return getItemState(progress, item).subsumed;
}

export function matchesSearch(item, text) {
  if (!text) {
    return true;
  }

  return cleanDisplayName(item.name).toLowerCase().includes(text.toLowerCase());
}

export function matchesVariant(item, activeTab, filters) {
  const useLich = ["primary", "secondary", "melee", "arch-guns"].includes(activeTab);
  const { variantNormal, variantPrime, variantLich } = filters;

  if (!variantNormal && !variantPrime && !variantLich) {
    return true;
  }

  if (useLich && isLichVariant(item)) {
    return variantLich;
  }

  if (isPrime(item)) {
    return variantPrime;
  }

  return variantNormal;
}

export function matchesStatus(progress, item, activeTab, filters) {
  const state = getItemState(progress, item);

  if (filters.hideCrafted && isCrafted(progress, item)) {
    return false;
  }

  if (filters.hideMastered && state.mastered) {
    return false;
  }

  if (activeTab === "warframes" && filters.hideSubsumed && isSubsumed(progress, item)) {
    return false;
  }

  return true;
}

export function getProgressScore(progress, item) {
  const total = getTotalBlueprintCount(item);
  if (total === 0) {
    return 0;
  }

  return getOwnedBlueprintCount(progress, item) / total;
}

export function sortItems(items, sortBy, progress) {
  const next = [...items];

  if (sortBy === "name-asc") {
    next.sort((a, b) => getNameSortKey(a.name).localeCompare(getNameSortKey(b.name)));
    return next;
  }

  if (sortBy === "name-desc") {
    next.sort((a, b) => getNameSortKey(b.name).localeCompare(getNameSortKey(a.name)));
    return next;
  }

  if (sortBy === "mr-asc") {
    next.sort((a, b) => Number(a.masteryReq ?? 0) - Number(b.masteryReq ?? 0));
    return next;
  }

  if (sortBy === "mr-desc") {
    next.sort((a, b) => Number(b.masteryReq ?? 0) - Number(a.masteryReq ?? 0));
    return next;
  }

  if (sortBy === "progress-desc") {
    next.sort((a, b) => getProgressScore(progress, b) - getProgressScore(progress, a));
    return next;
  }

  return next;
}

export function computeSummary(currentItems, activeTab, progress) {
  return currentItems.reduce(
    (acc, item) => {
      const state = getItemState(progress, item);
      const ownedBlueprints = getOwnedBlueprintCount(progress, item);
      const totalBlueprints = getTotalBlueprintCount(item);
      acc.blueprintOwned += ownedBlueprints;
      acc.blueprintTotal += totalBlueprints;
      if (isCraftReady(progress, item)) acc.ready += 1;
      if (isCrafted(progress, item)) acc.crafted += 1;
      if (state.mastered) acc.mastered += 1;
      if (activeTab === "warframes" && isSubsumed(progress, item)) acc.subsumed += 1;
      return acc;
    },
    { blueprintOwned: 0, blueprintTotal: 0, ready: 0, crafted: 0, mastered: 0, subsumed: 0 }
  );
}

export function getStatusFilterLabel(activeTab, filters) {
  return (
    [
      filters.hideCrafted ? "Hide crafted" : null,
      filters.hideMastered ? "Hide mastered" : null,
      activeTab === "warframes" && filters.hideSubsumed ? "Hide subsumed" : null,
    ]
      .filter(Boolean)
      .join(" + ") || "Status filters"
  );
}
