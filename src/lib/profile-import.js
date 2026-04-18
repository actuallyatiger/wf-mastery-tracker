import { createItemState, getComponentRequirementId, getComponentRequirements, normalizeItems } from "./tracker-core";

const WARFRAME_MASTERY_XP_THRESHOLD = 900000;
const NECRAMECH_MASTERY_XP_THRESHOLD = 1600000;
const WEAPON_MASTERY_XP_THRESHOLD = 450000;
const LICH_WEAPON_MASTERY_XP_THRESHOLD = 800000;

function extractProfileRoot(parsed) {
  if (Array.isArray(parsed?.Results) && parsed.Results.length > 0) {
    return parsed.Results[0];
  }

  if (parsed?.LoadOutInventory || parsed?.XPInfo) {
    return parsed;
  }

  return null;
}

function getImportedStatsRows(parsed, profile) {
  const rows = [];

  if (Array.isArray(parsed?.Stats?.Weapons)) {
    rows.push(...parsed.Stats.Weapons);
  }

  if (Array.isArray(profile?.Stats?.Weapons)) {
    rows.push(...profile.Stats.Weapons);
  }

  return rows;
}

function isWeaponItem(item) {
  return ["primary", "secondary", "melee", "arch-guns", "arch-melee", "sentinel-weapons"].includes(item.tab);
}

function isNecramechItem(item) {
  return item.tab === "warframes" && String(item.uniqueName ?? "").includes("/Lotus/Powersuits/EntratiMech/");
}

function isMasteredByImportedXp(item, xpValue) {
  const xp = Number(xpValue);
  if (!Number.isFinite(xp) || xp <= 0) {
    return false;
  }

  if (item.tab === "warframes") {
    if (isNecramechItem(item)) {
      return xp >= NECRAMECH_MASTERY_XP_THRESHOLD;
    }

    return xp >= WARFRAME_MASTERY_XP_THRESHOLD;
  }

  if (isWeaponItem(item)) {
    const threshold = item.variant === "lich" ? LICH_WEAPON_MASTERY_XP_THRESHOLD : WEAPON_MASTERY_XP_THRESHOLD;
    return xp >= threshold;
  }

  return xp > 0;
}

function markCraftedImpliesBlueprintOwnership(item, itemState) {
  const nextState = {
    ...itemState,
    crafted: true,
    mainBlueprintOwned: item.mainBlueprintKey ? true : itemState.mainBlueprintOwned,
    componentBlueprintsOwned: {
      ...(itemState.componentBlueprintsOwned ?? {}),
    },
  };

  const requirements = getComponentRequirements(item);
  for (let i = 0; i < requirements.length; i += 1) {
    const requirementId = getComponentRequirementId(requirements[i], i);
    nextState.componentBlueprintsOwned[requirementId] = true;
  }

  return nextState;
}

export function importProfileData(parsed, dataItems, progressItems, craftedModeDefault) {
  const profile = extractProfileRoot(parsed);
  if (!profile) {
    throw new Error("Could not find profile data in this JSON.");
  }

  const byItemType = new Map((dataItems ?? []).map((item) => [item.uniqueName, item]));
  const nextItems = normalizeItems(progressItems);
  const importedOwnedItemKeys = new Set();

  function resolveExistingState(item) {
    return nextItems[item.id] ?? createItemState();
  }

  function markOwnedByItemType(itemType, options = {}) {
    const item = byItemType.get(itemType);
    if (!item) {
      return false;
    }

    importedOwnedItemKeys.add(itemType);
    if (item.mainBlueprintKey) {
      importedOwnedItemKeys.add(item.mainBlueprintKey);
    }

    const existing = resolveExistingState(item);
    nextItems[item.id] = markCraftedImpliesBlueprintOwnership(item, {
      ...existing,
      mastered: options.mastered || existing.mastered,
    });
    return true;
  }

  const loadOutInventory = profile.LoadOutInventory ?? {};
  for (const entries of Object.values(loadOutInventory)) {
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const entry of entries) {
      const itemType = typeof entry === "string" ? entry : typeof entry?.ItemType === "string" ? entry.ItemType : null;

      if (!itemType) {
        continue;
      }

      markOwnedByItemType(itemType);
    }
  }

  const xpInfo = [
    ...(Array.isArray(profile.XPInfo) ? profile.XPInfo : []),
    ...(Array.isArray(profile.LoadOutInventory?.XPInfo) ? profile.LoadOutInventory.XPInfo : []),
    ...(Array.isArray(parsed?.XPInfo) ? parsed.XPInfo : []),
  ];

  for (const row of xpInfo) {
    const itemType = typeof row?.ItemType === "string" ? row.ItemType : null;
    if (!itemType) {
      continue;
    }

    const item = byItemType.get(itemType);
    if (!item) {
      continue;
    }

    const xp = Number(row?.XP ?? 0);
    markOwnedByItemType(itemType, { mastered: isMasteredByImportedXp(item, xp) });
  }

  for (const row of getImportedStatsRows(parsed, profile)) {
    const itemType = typeof row?.ItemType === "string" ? row.ItemType : typeof row?.type === "string" ? row.type : null;

    if (!itemType) {
      continue;
    }

    const item = byItemType.get(itemType);
    if (!item) {
      continue;
    }

    const xp = Number(row?.XP ?? row?.xp ?? 0);
    markOwnedByItemType(itemType, { mastered: isMasteredByImportedXp(item, xp) });
  }

  for (const item of dataItems ?? []) {
    const requirements = getComponentRequirements(item);
    if (requirements.length === 0) {
      continue;
    }

    const state = resolveExistingState(item);
    const owned = { ...(state.componentBlueprintsOwned ?? {}) };
    let changed = false;

    for (let i = 0; i < requirements.length; i += 1) {
      const requirement = requirements[i];
      const requirementId = getComponentRequirementId(requirement, i);

      if (owned[requirementId]) {
        continue;
      }

      if (importedOwnedItemKeys.has(requirement.itemKey)) {
        owned[requirementId] = true;
        changed = true;
      }
    }

    if (changed) {
      nextItems[item.id] = {
        ...state,
        componentBlueprintsOwned: owned,
      };
    }
  }

  return {
    settingsPatch: {
      craftedMode: craftedModeDefault,
    },
    items: normalizeItems(nextItems),
  };
}
