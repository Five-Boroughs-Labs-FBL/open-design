import type { DesignGenerationTarget, DesignManifestV2 } from '@open-design/contracts';

export function renderDesignGenerationDirective(
  manifest: DesignManifestV2,
  target: DesignGenerationTarget,
): string {
  const targets = target.surfaceIds.map((id) => {
    const surface = manifest.surfaces.find((candidate) => candidate.id === id)!;
    return {
      id: surface.id,
      file: surface.file,
      title: surface.title,
      purpose: surface.purpose,
      kind: surface.kind,
      states: surface.states,
      formFactors: surface.formFactors,
    };
  });
  const lead = targets[0];
  return [
    '## Strict design-generation target',
    `This run is bound to durable manifest revision ${target.manifestRevision}.`,
    `Generate exactly these ${targets.length} surface(s):`,
    ...targets.map((surface, index) =>
      `${index + 1}. surface id \`${surface.id}\` → project file \`${surface.file}\` (${surface.title}; ${surface.kind})`),
    '',
    'Global locked design scope (applies to every target; do not narrow or reinterpret it):',
    JSON.stringify(manifest.scope, null, 2),
    '',
    'Target details:',
    JSON.stringify(targets, null, 2),
    '',
    'Rules:',
    '- Produce no other design surfaces or HTML files in this run.',
    '- Never create, edit, rename, or delete `DESIGN-MANIFEST.json`; the daemon owns manifest state and reconciliation.',
    '- Preserve the exact ids and stable filenames above. The entry surface is always `index.html`; secondary surfaces must never overwrite it.',
    lead
      ? `- The lead agent owns the first listed surface (\`${lead.id}\` → \`${lead.file}\`). Write or edit that exact project file, including on change-turns.`
      : '- Use only the declared target files.',
    '- For each remaining claimed surface, spawn one general-purpose sub-agent with its exact surface id and filename in the shared workspace (no git worktrees). Each agent owns only its assigned file; the lead writes its own file while the children work.',
    '- Deliver every surface through filesystem Write/Edit as exactly one complete HTML document. Project files are the source of truth; do not stream HTML source in chat or <artifact> blocks.',
    '- Keep thinking, planning, and summaries in chat, never in the design files. Wait for all assigned files to finish before reporting completion.',
    '- Use the global scope and existing project files to keep navigation, visual language, data model, and responsive behavior coherent with the whole product.',
  ].join('\n');
}
