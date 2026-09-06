// Brand mark for a model id. Accepts both BYOK-style `provider/model` ids
// (e.g. `anthropic/claude-sonnet-4-5`) and bare catalog ids (e.g.
// `claude-fable-5`, `deepseek-v4-flash`): the vendor token is the slash
// prefix when present, otherwise the id's leading `-` token — the same
// derivation the two-level picker's company grouping uses. Unknown vendors
// return null and callers fall back to a neutral/agent mark instead of
// inventing artwork.
//
// Mono silhouettes that `AgentIcon` paints via CSS mask (so dark/light theme
// both stay legible) are returned as `{ kind: 'agent' }` — never as a raw
// `<img src>` of a dark-fill SVG (that 404s or vanishes on graphite).
export type ModelProviderIcon =
  | { kind: 'img'; src: string }
  | { kind: 'agent'; id: string };

export function modelProviderIcon(
  modelId: string | null | undefined,
): ModelProviderIcon | null {
  if (!modelId) return null;
  const slash = modelId.indexOf('/');
  const vendor = (
    slash > 0 ? modelId.slice(0, slash) : modelId.split('-')[0] ?? modelId
  ).toLowerCase();
  if (!vendor) return null;
  if (vendor.includes('anthropic') || vendor.includes('claude'))
    return { kind: 'img', src: '/agent-icons/claude.svg' };
  if (
    vendor.includes('openai') ||
    vendor.includes('gpt') ||
    vendor === 'o1' ||
    vendor === 'o3' ||
    vendor === 'o4'
  )
    return { kind: 'img', src: '/model-icons/openai.svg' };
  if (vendor.includes('google') || vendor.includes('gemini'))
    return { kind: 'img', src: '/model-icons/google-gemini.svg' };
  if (vendor.includes('xai') || vendor.includes('grok'))
    return { kind: 'agent', id: 'grok-build' };
  if (vendor.includes('deepseek')) return { kind: 'img', src: '/agent-icons/deepseek.svg' };
  if (vendor.includes('glm') || vendor.includes('zhipu'))
    return { kind: 'img', src: '/agent-icons/glm.svg' };
  if (vendor.includes('qwen')) return { kind: 'img', src: '/agent-icons/qwen.svg' };
  if (vendor.includes('kimi') || vendor.includes('moonshot'))
    return { kind: 'img', src: '/agent-icons/kimi.svg' };
  if (vendor.includes('mimo')) return { kind: 'img', src: '/agent-icons/mimo.svg' };
  if (vendor.includes('minimax')) return { kind: 'img', src: '/model-icons/minimax.svg' };
  if (vendor.includes('muse') || vendor.includes('meta') || vendor.includes('llama'))
    return { kind: 'img', src: '/model-icons/meta.png' };
  if (vendor.includes('doubao') || vendor.includes('bytedance'))
    return { kind: 'img', src: '/model-icons/bytedance.svg' };
  if (vendor.includes('openrouter')) return { kind: 'img', src: '/model-icons/openrouter.svg' };
  return null;
}

/** @deprecated Prefer `modelProviderIcon` — img-only helper kept for call sites that cannot render AgentIcon. */
export function modelProviderIconSrc(
  modelId: string | null | undefined,
): string | null {
  const icon = modelProviderIcon(modelId);
  if (!icon) return null;
  if (icon.kind === 'img') return icon.src;
  return `/agent-icons/${icon.id}.svg`;
}
