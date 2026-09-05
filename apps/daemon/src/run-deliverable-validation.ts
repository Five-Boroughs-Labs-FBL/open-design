import fs from 'node:fs/promises';
import path from 'node:path';

import { HYPERFRAMES_VIDEO_MODEL } from '@open-design/contracts';
import type {
  ChatRunStatus,
  ProjectFile,
  ProjectFileKind,
  ProjectMetadata,
} from '@open-design/contracts';
import { designManifestPathIdentity } from '@open-design/contracts';

import { listFiles, resolveProjectDir } from './projects.js';

export type RunDeliverableValidation =
  | 'valid'
  | 'not_succeeded'
  | 'no_artifact'
  | 'project_missing'
  | 'entry_missing'
  | 'entry_not_touched'
  | 'unexpected_artifact'
  | 'entry_unreadable'
  | 'type_mismatch';

export interface RunDeliverableValidationResult {
  valid: boolean;
  validation: RunDeliverableValidation;
  entryFile?: string;
  artifactKind?: ProjectFileKind;
}

interface ValidateRunDeliverableInput {
  projectsRoot: string;
  projectId: string | null;
  projectMetadata?: Partial<ProjectMetadata> | Record<string, unknown> | null;
  runStatus: ChatRunStatus;
  artifactCount: number;
  /** Exact artifact paths changed by this run. Undefined means the runtime
   *  could not produce a reliable per-file diff (for example contention). */
  touchedPaths?: string[];
  /** Exact manifest files claimed by a progressive-generation run. */
  targetFiles?: string[];
}

const PROJECT_KIND_FILE_KINDS: Partial<
  Record<ProjectMetadata['kind'], ReadonlySet<ProjectFileKind>>
> = {
  prototype: new Set(['html']),
  template: new Set(['html']),
  deck: new Set(['html', 'presentation', 'pdf']),
  brand: new Set(['html', 'document', 'pdf']),
  image: new Set(['image']),
  video: new Set(['video']),
  audio: new Set(['audio']),
};

function safeRelativeFile(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/')) return null;
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return null;
  }
  return segments.join('/');
}

function projectKind(
  metadata: ValidateRunDeliverableInput['projectMetadata'],
): ProjectMetadata['kind'] | null {
  const value = metadata?.kind;
  return value === 'prototype'
    || value === 'deck'
    || value === 'template'
    || value === 'other'
    || value === 'brand'
    || value === 'image'
    || value === 'video'
    || value === 'audio'
    ? value
    : null;
}

function isHyperFramesProject(
  metadata: ValidateRunDeliverableInput['projectMetadata'],
): boolean {
  return metadata?.videoModel === HYPERFRAMES_VIDEO_MODEL
    || metadata?.intent === 'hyperframes';
}

/**
 * The file kinds a project may deliver as its canonical entry, or `null` when
 * any kind is acceptable.
 *
 * `metadata.kind` records the Home surface a project was created from, not the
 * shape of what it delivers. For most kinds those coincide; HyperFrames breaks
 * the identity. A HyperFrames project rides on `kind: 'video'` because Video is
 * the surface that offers it, while the artifact the user authors, edits and
 * previews is an HTML composition — the MP4 is a render of that HTML, produced
 * on demand and not necessarily present in the project at all. OD Next already
 * says so on the way in: `DAEMON_OWNED_OUTPUT_KINDS.hyperframes` admits `html`
 * and `source` as supported deliverable kinds at plan time, so rejecting them
 * at completion time contradicts the plan the same daemon approved.
 *
 * Generative video projects (fal / Veo / Sora / Volcengine) keep the strict
 * video-only contract: there the provider returns a video file, and an HTML
 * "preview page" in its place is a genuine delivery failure.
 */
function acceptedDeliverableKinds(
  metadata: ValidateRunDeliverableInput['projectMetadata'],
): ReadonlySet<ProjectFileKind> | null {
  const kind = projectKind(metadata);
  if (!kind || kind === 'other') return null;
  const declared = PROJECT_KIND_FILE_KINDS[kind];
  if (!declared) return null;
  if (kind === 'video' && isHyperFramesProject(metadata)) {
    return new Set<ProjectFileKind>([...declared, 'html']);
  }
  return declared;
}

function filePath(file: ProjectFile): string {
  return typeof file.path === 'string' && file.path ? file.path : file.name;
}

function projectFileForPortablePath(files: ProjectFile[], target: string): ProjectFile | null {
  const exact = files.find(
    (file) => filePath(file).replaceAll('\\', '/').normalize('NFC') === target.normalize('NFC'),
  );
  if (exact) return exact;
  const identity = designManifestPathIdentity(target);
  const matches = files.filter((file) => designManifestPathIdentity(filePath(file)) === identity);
  return matches.length === 1 ? matches[0] ?? null : null;
}

function inferredEntry(
  files: ProjectFile[],
  acceptedKinds: ReadonlySet<ProjectFileKind> | null,
): ProjectFile | null {
  const rootIndex = files.find((file) => filePath(file) === 'index.html');
  if (rootIndex) return rootIndex;

  const rootHtml = files.filter((file) => {
    const candidate = filePath(file);
    return !candidate.includes('/') && file.kind === 'html';
  });
  if (rootHtml.length === 1) return rootHtml[0] ?? null;

  if (acceptedKinds) {
    const compatible = files.filter((file) => acceptedKinds.has(file.kind));
    if (compatible.length === 1) return compatible[0] ?? null;
  }

  return files.length === 1 ? files[0] ?? null : null;
}

function matchesAcceptedKinds(
  acceptedKinds: ReadonlySet<ProjectFileKind> | null,
  fileKind: ProjectFileKind,
): boolean {
  return !acceptedKinds || acceptedKinds.has(fileKind);
}

/**
 * Resolve and verify the one canonical file a successful run can deliver.
 *
 * `artifactCount` proves this run touched output; it does not prove the
 * project's declared entry still exists. The filesystem-backed file list and
 * a direct readability check are therefore authoritative.
 */
export async function validateRunDeliverable(
  input: ValidateRunDeliverableInput,
): Promise<RunDeliverableValidationResult> {
  if (input.runStatus !== 'succeeded') {
    return { valid: false, validation: 'not_succeeded' };
  }
  if (!Number.isFinite(input.artifactCount) || input.artifactCount <= 0) {
    return { valid: false, validation: 'no_artifact' };
  }
  if (!input.projectId) {
    return { valid: false, validation: 'project_missing' };
  }

  let projectRoot: string;
  let files: ProjectFile[];
  try {
    projectRoot = resolveProjectDir(
      input.projectsRoot,
      input.projectId,
      input.projectMetadata,
    );
    files = await listFiles(input.projectsRoot, input.projectId, {
      metadata: input.projectMetadata,
    }) as ProjectFile[];
  } catch {
    return { valid: false, validation: 'project_missing' };
  }

  const acceptedKinds = acceptedDeliverableKinds(input.projectMetadata);
  const normalizedTargetFiles = input.targetFiles?.map(safeRelativeFile) ?? [];
  if (input.targetFiles && (
    normalizedTargetFiles.some((candidate) => candidate === null)
    || normalizedTargetFiles.length === 0
  )) {
    return { valid: false, validation: 'entry_missing' };
  }
  const scopedFiles = normalizedTargetFiles.filter((candidate): candidate is string => candidate !== null);
  const declared = safeRelativeFile(input.projectMetadata?.entryFile);
  const selected = scopedFiles.length > 0
    ? projectFileForPortablePath(files, scopedFiles[0]!)
    : declared
      ? projectFileForPortablePath(files, declared)
      : inferredEntry(files, acceptedKinds);
  if (scopedFiles.length > 0) {
    const selectedTargets = scopedFiles.map(
      (target) => projectFileForPortablePath(files, target),
    );
    if (selectedTargets.some((file) => file === null)) {
      return { valid: false, validation: 'entry_missing' };
    }
    if (!input.touchedPaths) {
      return {
        valid: false,
        validation: 'entry_not_touched',
        entryFile: scopedFiles[0]!,
      };
    }
    {
      const touchedPaths = normalizedTouchedPathList(projectRoot, input.touchedPaths);
      const touched = new Set(touchedPaths.map((candidate) => candidate.identity));
      const claimed = new Set(scopedFiles.map(designManifestPathIdentity));
      const unexpected = touchedPaths.find((candidate) => (
        candidate.identity === designManifestPathIdentity('DESIGN-MANIFEST.json')
        || (/\.html?$/i.test(candidate.relative) && !claimed.has(candidate.identity))
      ));
      if (unexpected) {
        return {
          valid: false,
          validation: 'unexpected_artifact',
          entryFile: unexpected.relative,
        };
      }
      if (scopedFiles.some((file) => !touched.has(designManifestPathIdentity(file)))) {
        const firstFile = scopedFiles[0] as string;
        const firstTarget = selectedTargets[0];
        return {
          valid: false,
          validation: 'entry_not_touched',
          entryFile: firstFile,
          ...(firstTarget ? { artifactKind: firstTarget.kind } : {}),
        };
      }
    }
    for (const [index, file] of selectedTargets.entries()) {
      if (!file || !matchesAcceptedKinds(acceptedKinds, file.kind)) {
        const targetFile = scopedFiles[index] as string;
        return {
          valid: false,
          validation: 'type_mismatch',
          entryFile: targetFile,
          ...(file ? { artifactKind: file.kind } : {}),
        };
      }
      const targetFile = scopedFiles[index] as string;
      if (!await readableProjectFile(projectRoot, filePath(file))) {
        return {
          valid: false,
          validation: 'entry_unreadable',
          entryFile: targetFile,
          artifactKind: file.kind,
        };
      }
    }
    const firstFile = scopedFiles[0] as string;
    const firstTarget = selectedTargets[0];
    return {
      valid: true,
      validation: 'valid',
      entryFile: firstFile,
      ...(firstTarget ? { artifactKind: firstTarget.kind } : {}),
    };
  }
  if (!selected) {
    return { valid: false, validation: 'entry_missing' };
  }

  const entryFile = filePath(selected);
  const facts = {
    entryFile,
    artifactKind: selected.kind,
  };
  if (input.touchedPaths) {
    const touched = new Set(
      input.touchedPaths.flatMap((candidate) => {
        if (typeof candidate !== 'string' || !candidate) return [];
        const absolute = path.isAbsolute(candidate)
          ? path.resolve(candidate)
          : path.resolve(projectRoot, candidate);
        const relative = path.relative(projectRoot, absolute);
        if (
          !relative
          || relative.startsWith('..')
          || path.isAbsolute(relative)
        ) {
          return [];
        }
        return [designManifestPathIdentity(relative.replaceAll(path.sep, '/'))];
      }),
    );
    if (!touched.has(designManifestPathIdentity(entryFile))) {
      return {
        valid: false,
        validation: 'entry_not_touched',
        ...facts,
      };
    }
  }
  if (!matchesAcceptedKinds(acceptedKinds, selected.kind)) {
    return {
      valid: false,
      validation: 'type_mismatch',
      ...facts,
    };
  }

  try {
    const target = path.resolve(projectRoot, entryFile);
    const relative = path.relative(projectRoot, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return { valid: false, validation: 'entry_unreadable', ...facts };
    }
    const stat = await fs.stat(target);
    if (!stat.isFile()) {
      return { valid: false, validation: 'entry_unreadable', ...facts };
    }
    const handle = await fs.open(target, 'r');
    await handle.close();
  } catch {
    return { valid: false, validation: 'entry_unreadable', ...facts };
  }

  return {
    valid: true,
    validation: 'valid',
    ...facts,
  };
}

function normalizedTouchedPaths(projectRoot: string, candidates: string[]): Set<string> {
  return new Set(normalizedTouchedPathList(projectRoot, candidates).map(({ identity }) => identity));
}

function normalizedTouchedPathList(
  projectRoot: string,
  candidates: string[],
): Array<{ relative: string; identity: string }> {
  const byIdentity = new Map<string, { relative: string; identity: string }>();
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate) continue;
    const absolute = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(projectRoot, candidate);
    const relative = path.relative(projectRoot, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    const portable = relative.replaceAll(path.sep, '/');
    const identity = designManifestPathIdentity(portable);
    if (!byIdentity.has(identity)) byIdentity.set(identity, { relative: portable, identity });
  }
  return [...byIdentity.values()];
}

async function readableProjectFile(projectRoot: string, file: string): Promise<boolean> {
  try {
    const target = path.resolve(projectRoot, file);
    const relative = path.relative(projectRoot, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
    const fileStat = await fs.stat(target);
    if (!fileStat.isFile()) return false;
    const handle = await fs.open(target, 'r');
    await handle.close();
    return true;
  } catch {
    return false;
  }
}
