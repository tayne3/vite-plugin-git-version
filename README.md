# vite-plugin-git-semver

Vite plugin for Git-based version management with semver support.

## Features

- 🚀 Extract version info from Git tags
- 📦 Simple API for easy integration
- 🔧 Configurable commit hash length
- 💾 Smart caching for fast rebuilds
- 🏷️ Semver 2.0.0 compliant

## Installation

```bash
npm install -D vite-plugin-git-semver
# or
pnpm add -D vite-plugin-git-semver
# or
yarn add -D vite-plugin-git-semver
```

## Usage

### Basic Setup

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import gitVersion, { getVersionInfo } from "vite-plugin-git-semver";

export default defineConfig({
  plugins: [
    gitVersion({
      defaultVersion: "1.0.0",
      commitHashLength: 7,
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(getVersionInfo().fullVersion),
  },
});
```

### Use Version Info in App

```typescript
// In your app code
console.log(__APP_VERSION__); // "1.2.3-dev.5+abc1234"
```

### Access Version Info Programmatically

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import gitVersion, { getVersionInfo } from "vite-plugin-git-semver";

export default defineConfig({
  plugins: [
    gitVersion({
      defaultVersion: "1.0.0",
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(getVersionInfo().fullVersion),
    __APP_VERSION_MAJOR__: getVersionInfo().major,
    __APP_VERSION_MINOR__: getVersionInfo().minor,
    __APP_VERSION_PATCH__: getVersionInfo().patch,
  },
});
```

## Options

| Option             | Type      | Default         | Description                          |
| ------------------ | --------- | --------------- | ------------------------------------ |
| `defaultVersion`   | `string`  | `'0.0.0'`       | Fallback version if no Git tag found |
| `sourceDir`        | `string`  | `process.cwd()` | Directory to search for Git info     |
| `failOnMismatch`   | `boolean` | `false`         | Throw error if version mismatch      |
| `commitHashLength` | `number`  | `undefined`     | Max length of commit hash            |

## API

### `gitVersion(options?: GitVersionOptions): Plugin`

Returns a Vite plugin for Git-based version management.

### `getVersionInfo(): VersionInfo`

Returns the cached version information. Must be called after the plugin is initialized.

### `VersionInfo`

```typescript
interface VersionInfo {
  version: string; // e.g., "1.2.3"
  fullVersion: string; // e.g., "1.2.3-dev.5+abc1234"
  major: number; // e.g., 1
  minor: number; // e.g., 2
  patch: number; // e.g., 3
  commitCount?: number; // e.g., 5 (only for dev versions)
  commitHash?: string; // e.g., "abc1234" (only for dev versions)
}
```

## Version Formats

### Tagged Release

When HEAD is exactly on a Git tag:

```
version: "1.2.3"
fullVersion: "1.2.3"
```

With dirty working tree:

```
version: "1.2.3"
fullVersion: "1.2.3+dirty"
```

### Development Version

When there are commits after the latest tag:

```
version: "1.2.3"
fullVersion: "1.2.3-dev.5+abc1234"
commitCount: 5
commitHash: "abc1234"
```

With dirty working tree:

```
version: "1.2.3"
fullVersion: "1.2.3-dev.5+abc1234.dirty"
```

## Requirements

- Git must be installed and available in PATH
- Project must be a Git repository with at least one commit
- For version tagging, use semantic versioning tags (e.g., `v1.0.0` or `1.0.0`)
