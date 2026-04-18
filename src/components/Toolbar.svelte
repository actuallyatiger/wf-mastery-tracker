<script>
  export let tabs = [];
  export let sortOptions = [];
  export let activeTab;
  export let search;
  export let variantNormal;
  export let variantPrime;
  export let variantLich;
  export let hideCrafted;
  export let hideMastered;
  export let hideSubsumed;
  export let sortBy;
  export let statusFilterLabel;
  export let sortLabel;
  export let summary;
  export let currentItemCount;
  export let onResetFilters;
</script>

<section class="toolbar card">
  <div class="tab-row">
    {#each tabs as tab}
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
            search = "";
          }}
        >
          ×
        </button>
      {/if}
    </div>

    <details class="filter-menu">
      <summary><span class="summary-label">Variants</span></summary>
      <div class="filter-list">
        <label>
          <input type="checkbox" bind:checked={variantNormal} />
          Normal
        </label>
        <label>
          <input type="checkbox" bind:checked={variantPrime} />
          Prime
        </label>
        <label>
          <input type="checkbox" bind:checked={variantLich} />
          Kuva / Tenet / Coda
        </label>
      </div>
    </details>

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
        {#if activeTab === "warframes"}
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
        {#each sortOptions as option}
          <button
            type="button"
            class:active={sortBy === option.value}
            on:click={(event) => {
              sortBy = option.value;
              const parent = event.currentTarget.closest("details");
              if (parent) {
                parent.removeAttribute("open");
              }
            }}
          >
            {option.label}
          </button>
        {/each}
      </div>
    </details>

    <button on:click={onResetFilters}>Reset filters</button>
  </div>

  <div class="stats">
    <span>Blueprints: {summary.blueprintOwned}/{summary.blueprintTotal}</span>
    <span>Craft-ready: {summary.ready}/{currentItemCount}</span>
    <span>Crafted: {summary.crafted}/{currentItemCount}</span>
    <span>Mastered: {summary.mastered}/{currentItemCount}</span>
    {#if activeTab === "warframes"}
      <span>Subsumed: {summary.subsumed}/{currentItemCount}</span>
    {/if}
  </div>
</section>
