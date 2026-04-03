#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { spawnSync } from 'node:child_process'

const ORIGIN_BASE = 'https://origin.warframe.com/PublicExport'
const CONTENT_BASE = 'https://content.warframe.com/PublicExport'
const INDEX_BASES = [ORIGIN_BASE, CONTENT_BASE]
const CORE_WEAPON_CATEGORIES = new Set(['LongGuns', 'Pistols', 'Melee'])
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
  'core',
])

function parseArgs(argv) {
  const options = {
    language: 'en',
    output: 'public/data/items.json',
    includeAllWeapons: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--language' && argv[i + 1]) {
      options.language = argv[i + 1]
      i += 1
      continue
    }

    if (arg === '--output' && argv[i + 1]) {
      options.output = argv[i + 1]
      i += 1
      continue
    }

    if (arg === '--include-all-weapons') {
      options.includeAllWeapons = true
    }
  }

  return options
}

function titleCaseFromSlug(value) {
  return value
    .split('/')
    .filter(Boolean)
    .at(-1)
    ?.replace(/([a-z])([A-Z])/g, '$1 $2')
    ?.replace(/[_-]+/g, ' ')
    ?.trim() || value
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'wf-mastery-tracker-updater/1.0 (+https://github.com)',
      Accept: '*/*',
    },
  })
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'wf-mastery-tracker-updater/1.0 (+https://github.com)',
      Accept: 'application/json,*/*;q=0.9',
    },
  })
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`)
  }

  return response.json()
}

function decompressIndex(buffer) {
  const decompressed = spawnSync('xz', ['--format=lzma', '--decompress', '--stdout'], {
    input: buffer,
  })

  if (decompressed.error) {
    throw new Error(
      'Failed to run xz for LZMA decompression. Install xz-utils (Linux) or xz (macOS).'
    )
  }

  if (decompressed.status !== 0) {
    const stderr = decompressed.stderr?.toString('utf8') || 'unknown error'
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

  throw new Error(`Could not find array payload for keys: ${preferredKeys.join(', ')}`)
}

function dedupe(values) {
  return [...new Set(values)]
}

function buildNameLookup({ warframesRaw, weaponsRaw, resourcesRaw }) {
  const lookup = new Map()

  for (const row of [...warframesRaw, ...weaponsRaw, ...resourcesRaw]) {
    if (row?.uniqueName && row?.name) {
      lookup.set(row.uniqueName, row.name)
    }
  }

  return lookup
}

function buildRecipeLookup(recipesRaw) {
  const recipesByResult = new Map()
  const recipesByUniqueName = new Map()

  for (const recipe of recipesRaw) {
    if (recipe?.resultType) {
      recipesByResult.set(recipe.resultType, recipe)
    }
    if (recipe?.uniqueName) {
      recipesByUniqueName.set(recipe.uniqueName, recipe)
    }
  }

  return { recipesByResult, recipesByUniqueName }
}

function isLikelyPrime(name) {
  return /\bprime\b/i.test(name)
}

function isLichStyleWeapon(name) {
  return /\b(kuva|tenet|coda)\b/i.test(name)
}

function classifyWarframeType(frame) {
  if (frame.productCategory === 'SpaceSuits') {
    return 'archwings'
  }
  if (frame.productCategory === 'MechSuits') {
    return 'necramechs'
  }
  return 'warframes'
}

function classifyWeaponTab(weapon) {
  if (weapon.productCategory === 'LongGuns') {
    return 'primary'
  }
  if (weapon.productCategory === 'Pistols') {
    return 'secondary'
  }
  if (weapon.productCategory === 'Melee') {
    return 'melee'
  }
  return 'other'
}

function isComponentBlueprintIngredient(itemType, recipesByResult) {
  const recipe = recipesByResult.get(itemType)
  if (!recipe?.uniqueName) {
    return false
  }

  return COMPONENT_RECIPE_FAMILY_MATCHERS.some((matcher) => recipe.uniqueName.includes(matcher))
}

function isLikelyWeaponComponentIngredient(itemType, requirementName) {
  if (typeof itemType === 'string' && itemType.includes('/WeaponParts/')) {
    return true
  }

  const suffix = String(requirementName ?? '')
    .replace(/^<ARCHWING>\s*/i, '')
    .trim()
    .split(/\s+/)
    .at(-1)
    ?.toLowerCase()

  if (!suffix) {
    return false
  }

  return WEAPON_COMPONENT_NAME_SUFFIXES.has(suffix)
}

function buildComponentRequirements({ ingredientRows, recipesByResult, nameLookup, majorItemKeys }) {
  const componentRequirements = []
  const parentInstanceCounts = new Map()

  for (const ingredient of ingredientRows) {
    const itemKey = ingredient?.ItemType
    if (!itemKey) {
      continue
    }

    const requirementName = nameLookup.get(itemKey) ?? titleCaseFromSlug(itemKey)
    const isComponentBlueprint = isComponentBlueprintIngredient(itemKey, recipesByResult)
    const isWeaponComponent = isLikelyWeaponComponentIngredient(itemKey, requirementName)
    const isMajorItemIngredient = majorItemKeys.has(itemKey)

    if (!isComponentBlueprint && !isWeaponComponent && !isMajorItemIngredient) {
      continue
    }

    const count = Number(ingredient.ItemCount ?? 1)

    // If a major blueprint is required (for example Equinox Day/Night Aspects),
    // also include its own component blueprint requirements one level down.
    if (!isComponentBlueprint && !isMajorItemIngredient) {
      continue
    }

    const nestedRecipe = recipesByResult.get(itemKey)
    const nestedIngredientRows = nestedRecipe?.ingredients ?? []

    for (let i = 0; i < count; i += 1) {
      const parentSequence = (parentInstanceCounts.get(itemKey) ?? 0) + 1
      parentInstanceCounts.set(itemKey, parentSequence)
      const parentId = `${itemKey}::${parentSequence}`
      componentRequirements.push({
        id: parentId,
        itemKey,
        name: requirementName,
        level: 0,
      })

      for (const nestedIngredient of nestedIngredientRows) {
        const nestedItemKey = nestedIngredient?.ItemType
        if (!nestedItemKey) {
          continue
        }

        const nestedName = nameLookup.get(nestedItemKey) ?? titleCaseFromSlug(nestedItemKey)
        if (
          !isComponentBlueprintIngredient(nestedItemKey, recipesByResult) &&
          !isLikelyWeaponComponentIngredient(nestedItemKey, nestedName) &&
          !majorItemKeys.has(nestedItemKey)
        ) {
          continue
        }

        const nestedCount = Number(nestedIngredient.ItemCount ?? 1)
        for (let nestedIndex = 0; nestedIndex < nestedCount; nestedIndex += 1) {
          componentRequirements.push({
            id: `${parentId}::${nestedItemKey}::${nestedIndex + 1}`,
            itemKey: nestedItemKey,
            name: nestedName,
            level: 1,
            parentId,
            parentItemKey: itemKey,
          })
        }
      }
    }
  }

  return componentRequirements
}

function buildNonComponentRequirements({ ingredientRows, recipesByResult, nameLookup, majorItemKeys }) {
  return ingredientRows
    .filter((ingredient) => ingredient?.ItemType)
    .filter((ingredient) => {
      const itemKey = ingredient.ItemType
      const requirementName = nameLookup.get(itemKey) ?? titleCaseFromSlug(itemKey)

      const isComponentBlueprint = isComponentBlueprintIngredient(itemKey, recipesByResult)
      const isWeaponComponent = isLikelyWeaponComponentIngredient(itemKey, requirementName)
      const isMajorItemIngredient = majorItemKeys.has(itemKey)

      return !isComponentBlueprint && !isWeaponComponent && !isMajorItemIngredient
    })
    .map((ingredient) => ({
      itemKey: ingredient.ItemType,
      name: nameLookup.get(ingredient.ItemType) ?? titleCaseFromSlug(ingredient.ItemType),
      count: Number(ingredient.ItemCount ?? 1),
      craftable: recipesByResult.has(ingredient.ItemType),
    }))
}

function normalizeWarframes({ warframesRaw, recipesByResult, nameLookup, majorItemKeys }) {
  return warframesRaw
    .filter((frame) => frame?.uniqueName && frame?.name)
    .filter((frame) => ['Suits', 'SpaceSuits', 'MechSuits'].includes(frame.productCategory))
    .map((frame) => {
      const recipe = recipesByResult.get(frame.uniqueName)
      const ingredientRows = recipe?.ingredients ?? []
      const componentRequirements = buildComponentRequirements({
        ingredientRows,
        recipesByResult,
        nameLookup,
        majorItemKeys,
      })
      const requirements = buildNonComponentRequirements({
        ingredientRows,
        recipesByResult,
        nameLookup,
        majorItemKeys,
      })

      return {
        id: frame.uniqueName,
        uniqueName: frame.uniqueName,
        name: frame.name,
        masteryReq: Number(frame.masteryReq ?? 0),
        tab: classifyWarframeType(frame),
        variant: isLikelyPrime(frame.name) ? 'prime' : 'normal',
        productCategory: frame.productCategory,
        hasRecipe: Boolean(recipe),
        mainBlueprintKey: recipe?.uniqueName ?? null,
        componentRequirements,
        requirements,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function normalizeWeapons({ weaponsRaw, recipesByResult, nameLookup, includeAllWeapons, majorItemKeys }) {
  return weaponsRaw
    .filter((weapon) => weapon?.uniqueName && weapon?.name)
    .filter((weapon) => includeAllWeapons || CORE_WEAPON_CATEGORIES.has(weapon.productCategory))
    .map((weapon) => {
      const recipe = recipesByResult.get(weapon.uniqueName)
      const ingredientRows = recipe?.ingredients ?? []
      const componentRequirements = buildComponentRequirements({
        ingredientRows,
        recipesByResult,
        nameLookup,
        majorItemKeys,
      })
      const requirements = buildNonComponentRequirements({
        ingredientRows,
        recipesByResult,
        nameLookup,
        majorItemKeys,
      })

      return {
        id: weapon.uniqueName,
        uniqueName: weapon.uniqueName,
        name: weapon.name,
        masteryReq: Number(weapon.masteryReq ?? 0),
        tab: classifyWeaponTab(weapon),
        variant: isLichStyleWeapon(weapon.name)
          ? 'lich'
          : isLikelyPrime(weapon.name)
            ? 'prime'
            : 'normal',
        productCategory: weapon.productCategory ?? 'Unknown',
        slot: Number(weapon.slot ?? -1),
        hasRecipe: Boolean(recipe),
        mainBlueprintKey: recipe?.uniqueName ?? null,
        componentRequirements,
        requirements,
      }
    })
    .filter((weapon) => weapon.tab !== 'other')
    .sort((a, b) => a.name.localeCompare(b.name))
}

function buildBlueprintNameLookup({ recipesRaw, nameLookup }) {
  const lookup = {}

  for (const recipe of recipesRaw) {
    if (!recipe?.resultType || !recipe?.uniqueName) {
      continue
    }

    const resultName = nameLookup.get(recipe.resultType)
    if (resultName) {
      lookup[recipe.uniqueName] = `${resultName} Blueprint`
    }
  }

  return lookup
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  let indexUrl = ''
  let indexBuffer = null
  let lastIndexError = null

  for (const base of INDEX_BASES) {
    const candidate = `${base}/index_${options.language}.txt.lzma`
    try {
      indexBuffer = await fetchBuffer(candidate)
      indexUrl = candidate
      break
    } catch (error) {
      lastIndexError = error
    }
  }

  if (!indexBuffer || !indexUrl) {
    throw lastIndexError ?? new Error('Could not fetch Public Export index from any source.')
  }

  const indexText = decompressIndex(indexBuffer)
  const indexEntries = parseIndexEntries(indexText)

  const manifestFiles = {
    warframes: `ExportWarframes_${options.language}.json`,
    weapons: `ExportWeapons_${options.language}.json`,
    recipes: `ExportRecipes_${options.language}.json`,
    resources: `ExportResources_${options.language}.json`,
  }

  const manifestEntries = Object.fromEntries(
    Object.entries(manifestFiles).map(([key, fileName]) => [key, findManifestEntry(indexEntries, fileName)])
  )

  const manifestUrls = Object.fromEntries(
    Object.entries(manifestEntries).map(([key, entry]) => [key, `${CONTENT_BASE}/Manifest/${entry}`])
  )

  const [warframesManifest, weaponsManifest, recipesManifest, resourcesManifest] = await Promise.all([
    fetchJson(manifestUrls.warframes),
    fetchJson(manifestUrls.weapons),
    fetchJson(manifestUrls.recipes),
    fetchJson(manifestUrls.resources),
  ])

  const warframesRaw = extractArrayLike(warframesManifest, ['ExportWarframes'])
  const weaponsRaw = extractArrayLike(weaponsManifest, ['ExportWeapons'])
  const recipesRaw = extractArrayLike(recipesManifest, ['ExportRecipes'])
  const resourcesRaw = extractArrayLike(resourcesManifest, ['ExportResources'])

  const { recipesByResult } = buildRecipeLookup(recipesRaw)

  const nameLookup = buildNameLookup({ warframesRaw, weaponsRaw, resourcesRaw })

  const majorItemKeys = new Set([
    ...warframesRaw
      .filter((frame) => ['Suits', 'SpaceSuits', 'MechSuits'].includes(frame?.productCategory))
      .map((frame) => frame?.uniqueName)
      .filter(Boolean),
    ...weaponsRaw
      .filter((weapon) => CORE_WEAPON_CATEGORIES.has(weapon?.productCategory))
      .map((weapon) => weapon?.uniqueName)
      .filter(Boolean),
  ])

  const warframes = normalizeWarframes({ warframesRaw, recipesByResult, nameLookup, majorItemKeys })
  const weapons = normalizeWeapons({
    weaponsRaw,
    recipesByResult,
    nameLookup,
    includeAllWeapons: options.includeAllWeapons,
    majorItemKeys,
  })

  const componentMap = {}
  for (const item of [...warframes, ...weapons]) {
    for (const requirement of item.componentRequirements) {
      const componentKey = requirement.itemKey
      const componentRecipe = recipesByResult.get(componentKey)
      const componentIngredientRows = componentRecipe?.ingredients ?? []
      componentMap[componentKey] = {
        uniqueName: componentKey,
        name: nameLookup.get(componentKey) ?? titleCaseFromSlug(componentKey),
        requirements: buildNonComponentRequirements({
          ingredientRows: componentIngredientRows,
          recipesByResult,
          nameLookup,
          majorItemKeys,
        }),
      }
    }
  }

  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    language: options.language,
    filters: {
      includeAllWeapons: options.includeAllWeapons,
    },
    source: {
      indexUrl,
      manifests: manifestEntries,
    },
    counts: {
      warframes: warframes.filter((item) => item.tab === 'warframes').length,
      necramechs: warframes.filter((item) => item.tab === 'necramechs').length,
      archwings: warframes.filter((item) => item.tab === 'archwings').length,
      primary: weapons.filter((item) => item.tab === 'primary').length,
      secondary: weapons.filter((item) => item.tab === 'secondary').length,
      melee: weapons.filter((item) => item.tab === 'melee').length,
      weapons: weapons.length,
      components: Object.keys(componentMap).length,
    },
    blueprints: buildBlueprintNameLookup({ recipesRaw, nameLookup }),
    components: componentMap,
    warframes,
    weapons,
  }

  if (warframes.length < 40) {
    throw new Error(`Sanity check failed: only ${warframes.length} warframes found.`)
  }

  if (weapons.length < 100) {
    throw new Error(`Sanity check failed: only ${weapons.length} weapons found.`)
  }

  const outputDir = dirname(options.output)
  await mkdir(outputDir, { recursive: true })

  const tmpPath = `${options.output}.tmp`
  await writeFile(tmpPath, JSON.stringify(output, null, 2), 'utf8')

  JSON.parse(await readFile(tmpPath, 'utf8'))
  await rename(tmpPath, options.output)

  console.log(
    `Updated ${options.output}: ${warframes.length} warframes, ${weapons.length} weapons, ${Object.keys(componentMap).length} components.`
  )
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
