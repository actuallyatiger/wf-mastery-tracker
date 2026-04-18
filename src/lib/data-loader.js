export async function loadTrackerData(baseUrl) {
  const manifestResponse = await fetch(`${baseUrl}data/manifest.json`);
  if (!manifestResponse.ok) {
    throw new Error(`manifest status ${manifestResponse.status}`);
  }

  const manifest = await manifestResponse.json();
  const tabEntries = Object.entries(manifest.tabs ?? {});

  const [blueprintsResponse, componentsResponse, ...tabResponses] = await Promise.all([
    fetch(`${baseUrl}data/${manifest.blueprintsFile ?? "blueprints.json"}`),
    fetch(`${baseUrl}data/${manifest.componentsFile ?? "components.json"}`),
    ...tabEntries.map(([, path]) => fetch(`${baseUrl}data/${path}`)),
  ]);

  if (!blueprintsResponse.ok) {
    throw new Error(`blueprints status ${blueprintsResponse.status}`);
  }

  if (!componentsResponse.ok) {
    throw new Error(`components status ${componentsResponse.status}`);
  }

  const firstBadTab = tabResponses.find((response) => !response.ok);
  if (firstBadTab) {
    throw new Error(`tab payload status ${firstBadTab.status}`);
  }

  const [blueprints, components, ...tabPayloads] = await Promise.all([
    blueprintsResponse.json(),
    componentsResponse.json(),
    ...tabResponses.map((response) => response.json()),
  ]);

  const items = tabPayloads.flatMap((tabPayload) => tabPayload.items ?? []);

  return {
    items,
    components,
    blueprints,
    generatedAt: manifest.generatedAt ?? null,
    counts: manifest.counts ?? {},
  };
}
