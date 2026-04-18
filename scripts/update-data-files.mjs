#!/usr/bin/env node
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from 'node:child_process'

const RAW_BASE = "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json";
const PUBLIC_EXPORT_BASES = ["https://content.warframe.com/PublicExport", "https://origin.warframe.com/PublicExport"];

const COMPONENT_RECIPE_FAMILY_MATCHERS = [
  '/Types/Recipes/Weapons/',
  '/Types/Recipes/WarframeRecipes/',
  '/Types/Recipes/ArchwingRecipes/',
  '/Types/Recipes/DeimosRecipes/Mechs/',
]

const WEAPON_COMPONENT_NAME_SUFFIXES = new Set([
  'barrel',
  'barrels',
  'receiver',
  'receivers',
  'stock',
  'blade',
  'blades',
  'handle',
  'link',
  'limb',
  'gauntlet',
  'string',
  'hilt',
  'grip',
  'guard',
  'chassis',
  'head',
  'ornament',
  'disc',
  'pouch',
  'rivet',
  'hook',
  'engine',
  'stars',
  'boot',
  'chain',
  'subcortex',
  'glove',
  'heatsink',
  'motor',
])

const CATEGORY_SOURCES = [
  { key: "Warframes", file: "Warframes.json", tab: "warframes" },
  { key: "Archwing", file: "Archwing.json", tab: "archwings" },
  { key: "Arch-Gun", file: "Arch-Gun.json", tab: "arch-guns" },
  { key: "Arch-Melee", file: "Arch-Melee.json", tab: "arch-melee" },
  { key: "Primary", file: "Primary.json", tab: "primary" },
  { key: "Secondary", file: "Secondary.json", tab: "secondary" },
  { key: "Melee", file: "Melee.json", tab: "melee" },
  { key: "Pets", file: "Pets.json", tab: "pets" },
  { key: "Sentinels", file: "Sentinels.json", tab: "sentinels" },
  { key: "SentinelWeapons", file: "SentinelWeapons.json", tab: "sentinel-weapons" },
];

function parseArgs(argv) {
  const options = {
    outputDir: "public/data",
    language: "en",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if ((arg === '--output-dir' || arg === '--output') && argv[i + 1]) {
      options.outputDir = argv[i + 1]
      i += 1
      continue
    }

    if (arg === "--language" && argv[i + 1]) {
      options.language = argv[i + 1];
      i += 1;
    }
  }

  return options
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "wf-mastery-tracker-updater/2.0 (+https://github.com)",
      Accept: "application/json,*/*;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return response.json();
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "wf-mastery-tracker-updater/2.0 (+https://github.com)",
      Accept: "*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function decompressIndex(buffer) {
  const decompressed = spawnSync('xz', ['--format=lzma', '--decompress', '--stdout'], {
    input: buffer,
  })

  if (decompressed.error) {
    throw new Error("Failed to run xz for LZMA decompression. Install xz-utils and retry.");
  }

  if (decompressed.status !== 0) {
    const stderr = decompressed.stderr?.toString("utf8") || "unknown xz error";
    throw new Error(`xz decompression failed: ${stderr}`)
  }

  return decompressed.stdout.toString('utf8')
}

function parseIndexEntries(indexText) {
  return indexText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function findManifestEntry(indexEntries, fileName) {
  const entry = indexEntries.find((line) => line.startsWith(`${fileName}!`))
  if (!entry) {
    throw new Error(`Unable to locate ${fileName} in Public Export index.`)
  }

  return entry
}

function extractArrayLike(data, preferredKeys) {
  for (const key of preferredKeys) {
    if (Array.isArray(data[key])) {
      return data[key]
    }
  }

  for (const value of Object.values(data)) {
    if (Array.isArray(value)) {
      return value
    }
  }

  return [];
}

function titleCaseFromSlug(value) {
  return (
    value
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.replace(/([a-z])([A-Z])/g, "$1 $2")
      ?.replace(/[_-]+/g, " ")
      ?.trim() || value
  );
}

function isComponentBlueprintIngredient(itemType, recipesByResult) {
  const recipe = recipesByResult.get(itemType);
  if (!recipe?.uniqueName) {
    return false;
  }

  return COMPONENT_RECIPE_FAMILY_MATCHERS.some((matcher) => recipe.uniqueName.includes(matcher));
}

function isLikelyWeaponComponentIngredient(itemType, requirementName) {
  if (typeof itemType === "string" && itemType.includes("/WeaponParts/")) {
    return true;
  }

  const suffix = String(requirementName ?? "")
    .replace(/^<ARCHWING>\s*/i, "")
    .trim()
    .split(/\s+/)
    .at(-1)
    ?.toLowerCase();

  if (!suffix) {
    return false;
  }

  return WEAPON_COMPONENT_NAME_SUFFIXES.has(suffix);
}

function buildNonComponentRequirementsFromExport({ ingredientRows, recipesByResult, nameLookup, majorItemKeys }) {
  return ingredientRows
    .filter((ingredient) => ingredient?.ItemType)
    .filter((ingredient) => {
      const itemKey = ingredient.ItemType;
      const requirementName = nameLookup.get(itemKey) ?? titleCaseFromSlug(itemKey);

      const isComponentBlueprint = isComponentBlueprintIngredient(itemKey, recipesByResult);
      const isWeaponComponent = isLikelyWeaponComponentIngredient(itemKey, requirementName);
      const isMajorItemIngredient = majorItemKeys.has(itemKey);

      return !isComponentBlueprint && !isWeaponComponent && !isMajorItemIngredient;
    })
    .map((ingredient) => ({
      itemKey: ingredient.ItemType,
      name: nameLookup.get(ingredient.ItemType) ?? titleCaseFromSlug(ingredient.ItemType),
      count: Number(ingredient.ItemCount ?? 1),
      craftable: recipesByResult.has(ingredient.ItemType),
    }));
}

async function fetchPublicExportRecipeContext(language) {
  let indexText = null;
  let baseUrl = null;
  let lastError = null;

  for (const candidate of PUBLIC_EXPORT_BASES) {
    try {
      const indexBuffer = await fetchBuffer(`${candidate}/index_${language}.txt.lzma`);
      indexText = decompressIndex(indexBuffer);
      baseUrl = candidate;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!indexText || !baseUrl) {
    throw lastError ?? new Error("Could not load Public Export index.");
  }

  const indexEntries = parseIndexEntries(indexText);
  const recipesEntry = findManifestEntry(indexEntries, `ExportRecipes_${language}.json`);
  const resourcesEntry = findManifestEntry(indexEntries, `ExportResources_${language}.json`);

  const recipesManifestUrl = `${baseUrl}/Manifest/${recipesEntry}`;
  const resourcesManifestUrl = `${baseUrl}/Manifest/${resourcesEntry}`;
  const [recipesManifest, resourcesManifest] = await Promise.all([
    fetchJson(recipesManifestUrl),
    fetchJson(resourcesManifestUrl),
  ]);

  const recipesRaw = extractArrayLike(recipesManifest, ["ExportRecipes"]);
  const resourcesRaw = extractArrayLike(resourcesManifest, ["ExportResources"]);

  const recipesByResult = new Map();
  for (const recipe of recipesRaw) {
    if (recipe?.resultType) {
      recipesByResult.set(recipe.resultType, recipe);
    }
  }

  const exportNames = new Map();
  for (const row of resourcesRaw) {
    if (row?.uniqueName && row?.name) {
      exportNames.set(row.uniqueName, row.name);
    }
  }

  return {
    recipesByResult,
    exportNames,
  };
}

function isPrime(item) {
  return Boolean(item?.isPrime) || /\bprime\b/i.test(String(item?.name ?? ""));
}

function isLichStyleWeapon(item) {
  return /\b(kuva|tenet|coda)\b/i.test(String(item?.name ?? ""));
}

function toVariant(item) {
  if (isLichStyleWeapon(item)) {
    return "lich";
  }

  if (isPrime(item)) {
    return "prime";
  }

  return "normal";
}

function isBlueprintLike(component) {
  const uniqueName = String(component?.uniqueName ?? "");
  const name = String(component?.name ?? "");
  return name === "Blueprint" || uniqueName.endsWith("Blueprint") || uniqueName.includes("/Types/Recipes/");
}

function isResourceLike(component) {
  const type = String(component?.type ?? "");
  return type === "Resource" || type === "Fish" || type === "Gem" || type === "Misc" || type === "Pet Resource";
}

function getComponentName(component, fallback) {
  return component?.name ?? fallback ?? component?.uniqueName ?? "Unknown Component";
}

function addRequirement(requirementsMap, component, context) {
  const key = String(component?.uniqueName ?? "");
  if (!key) {
    return;
  }

  const existing = requirementsMap.get(key);
  const count = Math.max(1, Number(component?.itemCount ?? 1));
  const row = {
    itemKey: key,
    name: getComponentName(component, context.displayNameByUniqueName.get(key)),
    count,
    craftable: isBlueprintLike(component) && !isResourceLike(component),
  };

  if (!existing) {
    requirementsMap.set(key, row);
    return;
  }

  existing.count += count;
}

function deriveRecipeFromSourceItem(sourceItem, context, includeNested = true) {
  const allComponents = Array.isArray(sourceItem?.components) ? sourceItem.components : [];
  const blueprintCandidates = allComponents.filter(isBlueprintLike);
  const mainBlueprint =
    blueprintCandidates.find((component) => component.name === "Blueprint") ??
    blueprintCandidates.find((component) => String(component.uniqueName).endsWith("Blueprint")) ??
    null;

  const componentRows = [];
  const requirementsMap = new Map();
  const componentInstanceByKey = new Map();

  for (const component of allComponents) {
    const key = String(component?.uniqueName ?? "");
    if (!key || key === mainBlueprint?.uniqueName) {
      continue;
    }

    const count = Math.max(1, Number(component?.itemCount ?? 1));
    const trackedItem = context.masterableByUniqueName.get(key);
    const recipeItem = context.recipeByUniqueName.get(key);
    const isTrackedItemIngredient = Boolean(trackedItem);
    const isCraftableBlueprintIngredient = isBlueprintLike(component) && !isResourceLike(component);
    const isComponentIngredient = isTrackedItemIngredient || isCraftableBlueprintIngredient;

    if (!isComponentIngredient) {
      addRequirement(requirementsMap, component, context);
      continue;
    }

    for (let i = 0; i < count; i += 1) {
      const sequence = (componentInstanceByKey.get(key) ?? 0) + 1;
      componentInstanceByKey.set(key, sequence);
      const parentId = `${key}::${sequence}`;

      componentRows.push({
        id: parentId,
        itemKey: key,
        name: getComponentName(component, context.displayNameByUniqueName.get(key)),
        level: 0,
      });

      const nestedSource = trackedItem ?? recipeItem;
      if (!includeNested || !nestedSource) {
        continue;
      }

      const nested = deriveRecipeFromSourceItem(nestedSource, context, false);
      const nestedByKey = new Map();

      for (const nestedRow of nested.componentRequirements) {
        if (Number(nestedRow.level ?? 0) !== 0) {
          continue;
        }

        const nestedCount = (nestedByKey.get(nestedRow.itemKey) ?? 0) + 1;
        nestedByKey.set(nestedRow.itemKey, nestedCount);

        componentRows.push({
          id: `${parentId}::${nestedRow.itemKey}::${nestedCount}`,
          itemKey: nestedRow.itemKey,
          name: nestedRow.name,
          level: 1,
          parentId,
          parentItemKey: key,
        });
      }
    }
  }

  return {
    mainBlueprintKey: mainBlueprint?.uniqueName ?? null,
    componentRequirements: componentRows,
    requirements: [...requirementsMap.values()],
  };
}

function normalizeSourceItems(tabId, sourceItems, context) {
  return sourceItems
    .filter((item) => item?.uniqueName && item?.name)
    .filter((item) => Boolean(item.masterable))
    .map((item) => {
      const recipe = deriveRecipeFromSourceItem(item, context);

      return {
        id: item.uniqueName,
        uniqueName: item.uniqueName,
        name: item.name,
        masteryReq: Number(item.masteryReq ?? 0),
        tab: tabId,
        variant: toVariant(item),
        category: item.category ?? null,
        type: item.type ?? null,
        productCategory: item.productCategory ?? null,
        imageName: item.imageName ?? null,
        hasRecipe: Boolean(recipe.mainBlueprintKey),
        mainBlueprintKey: recipe.mainBlueprintKey,
        componentRequirements: recipe.componentRequirements,
        requirements: recipe.requirements,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mergeAndNormalizeItems(categoryPayloads, context) {
  const merged = [];

  for (const [tabId, items] of categoryPayloads.entries()) {
    const normalized = normalizeSourceItems(tabId, items, context);
    merged.push(...normalized);
  }

  const byId = new Map();
  for (const item of merged) {
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
      continue;
    }

    const existing = byId.get(item.id);
    if (existing.tab === "warframes" && item.tab === "archwings") {
      byId.set(item.id, item);
    }
  }

  return [...byId.values()];
}

function buildBlueprintNameLookup(items) {
  const lookup = {};
  for (const item of items) {
    if (item.mainBlueprintKey) {
      lookup[item.mainBlueprintKey] = `${item.name} Blueprint`;
    }
  }
  return lookup;
}

function buildComponentsLookup(items, context) {
  const map = {};
  const itemsByUniqueName = new Map(items.map((item) => [item.uniqueName, item]));
  const majorItemKeys = new Set(items.map((item) => item.uniqueName));
  const exportNameLookup = new Map(context.displayNameByUniqueName);

  for (const [itemKey, itemName] of context.publicExportNames.entries()) {
    if (!exportNameLookup.has(itemKey)) {
      exportNameLookup.set(itemKey, itemName);
    }
  }

  for (const item of items) {
    for (const requirement of item.componentRequirements ?? []) {
      if (!requirement?.itemKey) {
        continue;
      }

      if (!map[requirement.itemKey]) {
        const linkedItem = itemsByUniqueName.get(requirement.itemKey);
        const recipeSource = context.recipeByUniqueName.get(requirement.itemKey);
        const sourceRecipe = recipeSource ? deriveRecipeFromSourceItem(recipeSource, context, false) : null;
        const exportRecipe = context.publicExportRecipesByResult.get(requirement.itemKey);
        const exportRequirements = exportRecipe
          ? buildNonComponentRequirementsFromExport({
              ingredientRows: exportRecipe.ingredients ?? [],
              recipesByResult: context.publicExportRecipesByResult,
              nameLookup: exportNameLookup,
              majorItemKeys,
            })
          : null;

        map[requirement.itemKey] = {
          uniqueName: requirement.itemKey,
          name: linkedItem?.name ?? context.displayNameByUniqueName.get(requirement.itemKey) ?? requirement.name,
          requirements: exportRequirements ?? sourceRecipe?.requirements ?? linkedItem?.requirements ?? [],
        };
      }
    }
  }

  return map;
}

function buildCounts(items) {
  const tabs = [
    "warframes",
    "primary",
    "secondary",
    "melee",
    "archwings",
    "arch-guns",
    "arch-melee",
    "sentinels",
    "sentinel-weapons",
    "pets",
  ];

  const counts = {};
  for (const tab of tabs) {
    counts[tab] = items.filter((item) => item.tab === tab).length;
  }

  counts.total = items.length;
  return counts;
}

function groupItemsByTab(items) {
  const grouped = {};

  for (const source of CATEGORY_SOURCES) {
    grouped[source.tab] = [];
  }

  for (const item of items) {
    if (!grouped[item.tab]) {
      grouped[item.tab] = [];
    }

    grouped[item.tab].push(item);
  }

  for (const tab of Object.keys(grouped)) {
    grouped[tab].sort((a, b) => a.name.localeCompare(b.name));
  }

  return grouped;
}

async function writeJsonFile(path, payload) {
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf8");
  await rename(tmpPath, path);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const categoryPayloads = new Map();

  for (const source of CATEGORY_SOURCES) {
    const url = `${RAW_BASE}/${source.file}`;
    const payload = await fetchJson(url);
    if (!Array.isArray(payload)) {
      throw new Error(`Expected array payload for ${source.file}`);
    }

    categoryPayloads.set(source.tab, payload);
  }

  const allCatalogItems = await fetchJson(`${RAW_BASE}/All.json`);
  const allRecipeItems = Array.isArray(allCatalogItems) ? allCatalogItems : [];

  const masterableByUniqueName = new Map(
    allRecipeItems
      .filter((item) => item?.uniqueName && item?.name)
      .filter((item) => Boolean(item.masterable))
      .map((item) => [item.uniqueName, item])
  );
  const displayNameByUniqueName = new Map(
    allRecipeItems.filter((item) => item?.uniqueName && item?.name).map((item) => [item.uniqueName, item.name])
  );
  const recipeByUniqueName = new Map(
    allRecipeItems.filter((item) => item?.uniqueName && item?.name).map((item) => [item.uniqueName, item])
  );

  const context = {
    masterableByUniqueName,
    displayNameByUniqueName,
    recipeByUniqueName,
    publicExportRecipesByResult: new Map(),
    publicExportNames: new Map(),
  };

  try {
    const publicExportContext = await fetchPublicExportRecipeContext(options.language);
    context.publicExportRecipesByResult = publicExportContext.recipesByResult;
    context.publicExportNames = publicExportContext.exportNames;
  } catch (error) {
    console.warn(`Warning: could not load Public Export recipe data (${error.message}).`);
  }

  const items = mergeAndNormalizeItems(categoryPayloads, context);

  if (items.length < 300) {
    throw new Error(`Sanity check failed: only ${items.length} items found.`);
  }

  const generatedAt = new Date().toISOString();
  const counts = buildCounts(items);
  const blueprints = buildBlueprintNameLookup(items);
  const components = buildComponentsLookup(items, context);
  const itemsByTab = groupItemsByTab(items);

  await mkdir(options.outputDir, { recursive: true });
  await mkdir(join(options.outputDir, "tabs"), { recursive: true });

  const tabs = {};
  for (const source of CATEGORY_SOURCES) {
    const fileName = `tabs/${source.tab}.json`;
    tabs[source.tab] = fileName;
    await writeJsonFile(join(options.outputDir, fileName), {
      tab: source.tab,
      itemCount: itemsByTab[source.tab]?.length ?? 0,
      items: itemsByTab[source.tab] ?? [],
    });
  }

  await writeJsonFile(join(options.outputDir, "blueprints.json"), blueprints);
  await writeJsonFile(join(options.outputDir, "components.json"), components);
  await writeJsonFile(join(options.outputDir, "manifest.json"), {
    version: 3,
    generatedAt,
    source: {
      provider: "WFCD/warframe-items",
      baseUrl: RAW_BASE,
      categories: CATEGORY_SOURCES.map((source) => source.key),
    },
    counts,
    tabs,
    blueprintsFile: "blueprints.json",
    componentsFile: "components.json",
  });

  console.log(`Updated ${options.outputDir}: ${items.length} items across ${Object.keys(tabs).length} tabs.`);
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
