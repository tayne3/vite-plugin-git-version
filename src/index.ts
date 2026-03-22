import { Plugin } from 'vite'
import { execSync } from 'node:child_process'
import { accessSync } from 'node:fs'
import { join } from 'node:path'

// Define plugin options interface
export interface GitVersionOptions {
  /**
   * Default version if no Git tag is found (default: "0.0.0")
   */
  defaultVersion?: string

  /**
   * Source directory to search for Git info (default: process.cwd())
   */
  sourceDir?: string

  /**
   * Whether to fail if Git tag version doesn't match the default version
   */
  failOnMismatch?: boolean

  /**
   * Maximum length of the commit hash (default: undefined, no limit)
   * When specified, the commit hash will be truncated to this length.
   * This also affects the hash part in fullVersion string.
   * Example: If set to 7, a hash like "1a2b3c4d5e6f7g8h9i" becomes "1a2b3c4"
   */
  commitHashLength?: number

  /**
   * Callback function called when falling back to default version.
   * Useful for custom logging or error handling.
   * @param reason - The reason for falling back
   * @param error - The error that caused the fallback (if any)
   */
  onFallback?: (reason: string, error?: Error) => void
}

// Version info interface
export interface VersionInfo {
  version: string
  fullVersion: string
  major: number
  minor: number
  patch: number
  commitCount?: number
  commitHash?: string
}

// Cache entry interface
export interface CacheEntry {
  versionInfo: VersionInfo
  headHash: string | null
  commitHashLength: number | undefined
  isDirty: boolean | null
}

// Instance-level cache keyed by sourceDir
const versionCache = new Map<string, CacheEntry>()

/**
 * Execute shell command and return output
 */
function execCommand(cmd: string, cwd: string): string {
  try {
    const stdout = execSync(cmd, { cwd, encoding: 'utf8' })
    return stdout.trim()
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`Command failed: ${cmd} - ${errorMessage}`)
  }
}

/**
 * Parses semver string and returns components as numbers
 * @example parseSemVer('1.2.3') => { major: 1, minor: 2, patch: 3 }
 * @example parseSemVer('v1.2.3') => { major: 1, minor: 2, patch: 3 }
 */
export function parseSemVer(
  version: string
): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^v?([0-9]+)\.([0-9]+)\.([0-9]+)$/)
  if (!match) return null

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10)
  }
}

/**
 * Compare two semver versions
 * @param v1 - First version string
 * @param v2 - Second version string
 * @returns negative if v1 < v2, 0 if equal, positive if v1 > v2
 * @example compareSemVer('1.0.0', '2.0.0') => negative
 */
export function compareSemVer(v1: string, v2: string): number {
  const parsed1 = parseSemVer(v1)
  const parsed2 = parseSemVer(v2)

  if (!parsed1 || !parsed2) {
    throw new Error(`Invalid semver format: ${!parsed1 ? v1 : v2}`)
  }

  // Compare major, minor, patch in sequence
  const comparisons = [
    parsed1.major - parsed2.major,
    parsed1.minor - parsed2.minor,
    parsed1.patch - parsed2.patch
  ]

  return comparisons.find((c) => c !== 0) ?? 0
}

/**
 * Get current Git HEAD hash
 */
function getGitHeadHash(sourceDir: string): string | null {
  try {
    return execCommand('git rev-parse HEAD', sourceDir)
  } catch {
    return null
  }
}

/**
 * Check if working tree has uncommitted changes
 */
function isWorkingTreeDirty(sourceDir: string): boolean {
  try {
    const status = execCommand('git status --porcelain', sourceDir)
    return status.length > 0
  } catch {
    return false
  }
}

/**
 * Check if cached version is still valid by comparing with current Git HEAD
 */
function isCacheValid(sourceDir: string, currentCommitHashLength?: number): boolean {
  const cacheEntry = versionCache.get(sourceDir)
  if (!cacheEntry || cacheEntry.headHash === null || cacheEntry.isDirty === null) {
    return false
  }

  // Check if commitHashLength has changed
  if (cacheEntry.commitHashLength !== currentCommitHashLength) {
    return false
  }

  try {
    const currentHeadHash = getGitHeadHash(sourceDir)
    const currentDirty = isWorkingTreeDirty(sourceDir)
    return cacheEntry.headHash === currentHeadHash && cacheEntry.isDirty === currentDirty
  } catch {
    return false
  }
}

/**
 * Extract version information from Git
 */
function extractGitVersionInfo(options: GitVersionOptions = {}): VersionInfo {
  const {
    defaultVersion = '0.0.0',
    sourceDir = process.cwd(),
    failOnMismatch = false,
    commitHashLength,
    onFallback
  } = options

  // Parse default version and validate format
  const defaultParsed = parseSemVer(defaultVersion)
  if (!defaultParsed) {
    throw new Error(
      `Default version '${defaultVersion}' does not follow semver format (MAJOR.MINOR.PATCH).`
    )
  }

  // Create default result
  const defaultResult: VersionInfo = {
    version: defaultVersion,
    fullVersion: defaultVersion,
    ...defaultParsed
  }

  // If cache exists, check if it's still valid
  const existingCache = versionCache.get(sourceDir)
  if (existingCache) {
    const isValid = isCacheValid(sourceDir, commitHashLength)
    if (isValid) {
      return existingCache.versionInfo
    }
  }

  const result = { ...defaultResult }

  try {
    // Check if Git is available
    execCommand('git --version', sourceDir)

    // Check if source directory is a git repository
    accessSync(join(sourceDir, '.git'))
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e))
    const reason = 'Git check failed'
    console.warn(`${reason}, falling back to default version. Error: ${error.message}`)
    onFallback?.(reason, error)
    // Update cache with default result if git is not available
    versionCache.set(sourceDir, {
      versionInfo: result,
      headHash: null,
      commitHashLength,
      isDirty: null
    })
    return result
  }

  let isDirty: boolean | null = null

  try {
    // Execute git describe command
    const gitDescribeOutput = execCommand('git describe --tags --abbrev=9', sourceDir)

    // Regular expressions for parsing Git output
    const regexVersionTag = /^v?([0-9]+\.[0-9]+\.[0-9]+)$/
    const regexVersionDev = /^v?([0-9]+\.[0-9]+\.[0-9]+)-([0-9]+)-g([a-f0-9]+)$/

    // Parse git describe output
    const tagMatch = gitDescribeOutput.match(regexVersionTag)
    const devMatch = gitDescribeOutput.match(regexVersionDev)

    // Detect working tree dirty state
    isDirty = isWorkingTreeDirty(sourceDir)

    if (tagMatch) {
      // Exact tagged release version
      const gitTagVersion = tagMatch[1]
      const parsedVersion = parseSemVer(gitTagVersion)

      if (!parsedVersion) {
        throw new Error(`Failed to parse git tag version: ${gitTagVersion}`)
      }

      if (failOnMismatch && defaultVersion !== gitTagVersion) {
        throw new Error(
          `Project version (${defaultVersion}) does not match Git tag (${gitTagVersion}).`
        )
      }

      Object.assign(result, {
        version: gitTagVersion,
        fullVersion: isDirty ? `${gitTagVersion}+dirty` : gitTagVersion,
        ...parsedVersion
      })
    } else if (devMatch) {
      // Untagged development version (commits after the tag)
      const gitTagVersion = devMatch[1]
      const commitCount = parseInt(devMatch[2], 10)
      const commitHash =
        commitHashLength !== undefined && commitHashLength > 0
          ? devMatch[3].substring(0, commitHashLength)
          : devMatch[3]

      const parsedVersion = parseSemVer(gitTagVersion)
      if (!parsedVersion) {
        throw new Error(`Failed to parse git tag version: ${gitTagVersion}`)
      }

      if (failOnMismatch && compareSemVer(defaultVersion, gitTagVersion) < 0) {
        throw new Error(
          `Project version (${defaultVersion}) must be at least equal to tagged ancestor (${gitTagVersion}).`
        )
      }

      // Format according to SemVer 2.0.0 for pre-release versions with build metadata
      Object.assign(result, {
        version: gitTagVersion,
        fullVersion: `${gitTagVersion}-dev.${commitCount}+${commitHash}${isDirty ? '.dirty' : ''}`,
        ...parsedVersion,
        commitCount,
        commitHash
      })
    } else {
      console.warn(`Failed to parse version from git describe output: '${gitDescribeOutput}'`)
    }

    // Get current HEAD hash for cache validation
    const headHash = getGitHeadHash(sourceDir)

    // Update cache
    versionCache.set(sourceDir, {
      versionInfo: { ...result },
      headHash,
      commitHashLength,
      isDirty
    })

    return result
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    const reason = 'Failed to get git version information'
    console.warn(`${reason}, falling back to default version. Error: ${err.message}`)
    onFallback?.(reason, err)
    // Update cache for default result on error
    versionCache.set(sourceDir, {
      versionInfo: result,
      headHash: null,
      commitHashLength,
      isDirty
    })
    return result
  }
}

/**
 * initialize version info, only call once per sourceDir
 */
function initializeVersionInfo(options: GitVersionOptions = {}) {
  const sourceDir = options.sourceDir ?? process.cwd()

  // Check if already cached for this sourceDir
  if (versionCache.has(sourceDir)) {
    return
  }

  extractGitVersionInfo({
    ...options,
    sourceDir
  })
}

/**
 * get version info for a specific sourceDir
 */
export function getVersionInfo(sourceDir?: string): VersionInfo {
  const dir = sourceDir ?? process.cwd()
  const cacheEntry = versionCache.get(dir)

  if (cacheEntry) {
    return cacheEntry.versionInfo
  }
  throw new Error(
    `Version info not initialized for directory: ${dir}. Make sure the plugin is properly configured.`
  )
}

/**
 * Vite plugin for Git-based version management
 */
export default function gitVersion(options: GitVersionOptions = {}): Plugin {
  const sourceDir = options.sourceDir ?? process.cwd()

  // Initialize version info early to fail fast
  try {
    initializeVersionInfo(options)
    if (!versionCache.has(sourceDir)) {
      throw new Error('Version info not available after initialization')
    }
  } catch (error) {
    const errorString = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to initialize git version info: ${errorString}`)
  }

  return {
    name: 'vite-plugin-git-semver'
  }
}
