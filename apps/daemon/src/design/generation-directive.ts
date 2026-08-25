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
  const live = targets[0];
  return [
    '## Strict design-generation target',
    `This run is bound to durable manifest revision ${target.manifestRevision}.`,
    `Generate exactly these ${targets.length} surface(s), in this order:`,
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
    live
      ? `- The open live primary is the first listed surface (\`${live.id}\` → \`${live.file}\`). Change-turns must re-stream exactly one complete HTML document as \`<artifact identifier="${live.id}" type="text/html">\`. Never Write, Edit, or overwrite that open live file.`
      : '- The first listed surface is the live-stream surface. Do not substitute a generic artifact or a different filename.',
    '- Remaining claimed surfaces may use filesystem Write/Edit on their exact declared files only.',
    '- Each generated HTML artifact identifier must equal its surface id. Persist only a single HTML document per file.',
    '- Use the global scope and existing project files to keep navigation, visual language, data model, and responsive behavior coherent with the whole product.',
  ].join('\n');
}
