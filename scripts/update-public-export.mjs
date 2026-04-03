#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { spawnSync } from 'node:child_process'

const ORIGIN_BASE = 'https://origin.warframe.com/PublicExport'
const CONTENT_BASE = 'https://content.warframe.com/PublicExport'
const CORE_WEAPON_CATEGORIES = new Set(['LongGuns', 'Pistols', 'Melee'])

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
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

async function fetchJson(url) {
  const response = await fetch(url)
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

function normalizeWarframes({ warframesRaw, recipesByResult, nameLookup }) {
  return warframesRaw
    .filter((frame) => frame?.uniqueName && frame?.name)
    .filter((frame) => frame.productCategory === 'Suits')
    .map((frame) => {
      const recipe = recipesByResult.get(frame.uniqueName)
      const ingredientRows = recipe?.ingredients ?? []
      const componentBlueprintKeys = dedupe(
        ingredientRows
          .map((ingredient) => ingredient?.ItemType)
          .filter((key) => key && recipesByResult.has(key))
      )

      const requirements = ingredientRows
        .filter((ingredient) => ingredient?.ItemType)
        .map((ingredient) => ({
          itemKey: ingredient.ItemType,
          name: nameLookup.get(ingredient.ItemType) ?? titleCaseFromSlug(ingredient.ItemType),
          count: Number(ingredient.ItemCount ?? 1),
          craftable: recipesByResult.has(ingredient.ItemType),
        }))

      return {
        id: frame.uniqueName,
        uniqueName: frame.uniqueName,
        name: frame.name,
        masteryReq: Number(frame.masteryReq ?? 0),
        productCategory: frame.productCategory,
        hasRecipe: Boolean(recipe),
        mainBlueprintKey: recipe?.uniqueName ?? null,
        componentBlueprintKeys,
        requirements,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function normalizeWeapons({ weaponsRaw, recipesByResult, nameLookup, includeAllWeapons }) {
  return weaponsRaw
    .filter((weapon) => weapon?.uniqueName && weapon?.name)
    .filter((weapon) => includeAllWeapons || CORE_WEAPON_CATEGORIES.has(weapon.productCategory))
    .map((weapon) => {
      const recipe = recipesByResult.get(weapon.uniqueName)
      const ingredientRows = recipe?.ingredients ?? []
      const componentBlueprintKeys = dedupe(
        ingredientRows
          .map((ingredient) => ingredient?.ItemType)
          .filter((key) => key && recipesByResult.has(key))
      )

      const requirements = ingredientRows
        .filter((ingredient) => ingredient?.ItemType)
        .map((ingredient) => ({
          itemKey: ingredient.ItemType,
          name: nameLookup.get(ingredient.ItemType) ?? titleCaseFromSlug(ingredient.ItemType),
          count: Number(ingredient.ItemCount ?? 1),
          craftable: recipesByResult.has(ingredient.ItemType),
        }))

      return {
        id: weapon.uniqueName,
        uniqueName: weapon.uniqueName,
        name: weapon.name,
        masteryReq: Number(weapon.masteryReq ?? 0),
        productCategory: weapon.productCategory ?? 'Unknown',
        slot: Number(weapon.slot ?? -1),
        hasRecipe: Boolean(recipe),
        mainBlueprintKey: recipe?.uniqueName ?? null,
        componentBlueprintKeys,
        requirements,
      }
    })
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

  const indexUrl = `${ORIGIN_BASE}/index_${options.language}.txt.lzma`
  const indexBuffer = await fetchBuffer(indexUrl)
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

  const recipesByResult = new Map(
    recipesRaw
      .filter((recipe) => recipe?.resultType)
      .map((recipe) => [recipe.resultType, recipe])
  )

  const nameLookup = buildNameLookup({ warframesRaw, weaponsRaw, resourcesRaw })

  const warframes = normalizeWarframes({ warframesRaw, recipesByResult, nameLookup })
  const weapons = normalizeWeapons({
    weaponsRaw,
    recipesByResult,
    nameLookup,
    includeAllWeapons: options.includeAllWeapons,
  })

  const componentMap = {}
  for (const item of [...warframes, ...weapons]) {
    for (const componentKey of item.componentBlueprintKeys) {
      componentMap[componentKey] = {
        uniqueName: componentKey,
        name: nameLookup.get(componentKey) ?? titleCaseFromSlug(componentKey),
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
      warframes: warframes.length,
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
