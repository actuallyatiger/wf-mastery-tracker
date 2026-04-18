<script>
  export let item;
  export let activeTab;
  export let state;
  export let cleanDisplayName;
  export let isPrime;
  export let isUmbra;
  export let isSubsumed;
  export let isCrafted;
  export let isAutoCrafted;
  export let getBlueprintRows;
  export let getBlueprintTreeGuides;
  export let getBlueprintTooltip;
  export let isComponentRequirementOwned;
  export let toggleMainBlueprint;
  export let toggleComponentBlueprint;
  export let toggleCrafted;
  export let toggleMastered;
  export let toggleSubsumed;

  $: blueprintRows = getBlueprintRows(item);
</script>

<article class="card item-card">
  <div class="title-row">
    <h3>{cleanDisplayName(item.name)}</h3>
    <small>MR {item.masteryReq}</small>
  </div>

  {#if blueprintRows.length > 0}
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

          {#if row.kind === "main"}
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
              checked={isComponentRequirementOwned(state, row, componentIndex)}
              on:change={(event) => toggleComponentBlueprint(item, row, componentIndex, event.currentTarget.checked)}
            />
            <span class="component-row-text" data-tooltip={getBlueprintTooltip(item, row)}>
              {cleanDisplayName(row.name)}
            </span>
          {/if}
        </label>
      {/each}
    </div>
  {/if}

  <div class="toggle-grid" class:with-blueprint-divider={blueprintRows.length > 0}>
    <label class="check-row">
      <input
        type="checkbox"
        checked={isCrafted(item)}
        aria-readonly={isAutoCrafted(item)}
        on:click={(event) => {
          if (isAutoCrafted(item)) {
            event.preventDefault();
          }
        }}
        on:change={(event) => {
          if (!isAutoCrafted(item)) {
            toggleCrafted(item, event.currentTarget.checked);
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

    {#if activeTab === "warframes" && !isPrime(item) && !isUmbra(item)}
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
