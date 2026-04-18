<script>
  export let settings;
  export let profileUrl;
  export let onSetCraftedMode;
  export let onSetTheme;
  export let onImportProgress;
  export let onClearProgress;
</script>

<section class="settings-popover card">
  <h2>Settings</h2>
  <label>
    Crafted behavior
    <select value={settings.craftedMode} on:change={(event) => onSetCraftedMode(event.currentTarget.value)}>
      <option value="manual">Manual crafted toggle (default)</option>
      <option value="auto">Auto crafted from required blueprints</option>
    </select>
  </label>

  <label>
    Theme
    <select value={settings.theme} on:change={(event) => onSetTheme(event.currentTarget.value)}>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
      <option value="system">System</option>
    </select>
  </label>

  <div class="actions">
    <div class="import-json-actions">
      <label class="file-upload">
        Import profile JSON
        <input type="file" accept="application/json" on:change={onImportProgress} />
      </label>
      <details class="import-help">
        <summary aria-label="How to get profile JSON">?</summary>
        <div class="import-help-popover tiny">
          <p><strong>How to find profile JSON</strong></p>
          <p>1. Find <code>EE.log</code>:</p>
          <p><code>Windows: %LOCALAPPDATA%\Warframe\EE.log</code></p>
          <p>
            <code
              >Linux (Steam Proton):
              ~/.steam/steam/steamapps/compatdata/230410/pfx/drive_c/users/steamuser/AppData/Local/Warframe/EE.log</code
            >
          </p>
          <p>
            2. In that file, find a line like <code>Logged in (...)</code>. The value in parentheses is your player id.
          </p>
          <p>3. Open this URL in a browser and replace <code>&lt;playerId&gt;</code>:</p>
          <p><code>{profileUrl}&lt;playerId&gt;</code></p>
          <p>4. Save the JSON response and import it here.</p>
        </div>
      </details>
    </div>
    <button class="danger" on:click={onClearProgress}>Clear progress</button>
  </div>
</section>
