/**
 * Cloud-session expiry can bounce the SPA to the sign-in onboarding view.
 * ACP Design iframes a project conversation with chrome hidden, so that bounce
 * would trap the embed on "Sign in to OpenDesign" and drop `?t=` / `acpEmbed`.
 * Hosted ACP SSO is the identity path — do not bounce to OpenDesign Cloud AMR.
 * Project deep links follow the same rule as first-run onboarding: do not hijack.
 */
export function shouldForceCloudOnboarding(input: {
  cloudIdentityRejected: boolean;
  amcEmbed: boolean;
  routeKind: string;
  acpSsoConfigured?: boolean;
  embedSession?: boolean;
}): boolean {
  if (!input.cloudIdentityRejected) return false;
  if (input.amcEmbed) return false;
  if (input.acpSsoConfigured) return false;
  if (input.embedSession) return false;
  if (input.routeKind === 'project') return false;
  return true;
}

/** Home-shell bounce for a missing OpenDesign Cloud session. Must use the same ACP/embed exceptions as shouldForceCloudOnboarding — otherwise catalog SSO returns `?t=` and the shell immediately hijacks to Sign in with ACP. */
export function shouldBounceCloudHomeToOnboarding(input: {
  view: string;
  usesOpenDesignCloud: boolean;
  amrLoggedIn: boolean | null;
  amrAuthRequired: boolean;
  acpSsoConfigured?: boolean;
  embedSession?: boolean;
  amcEmbed?: boolean;
}): boolean {
  if (input.view === 'onboarding') return false;
  const cloudIdentityRejected =
    (input.usesOpenDesignCloud && input.amrLoggedIn === false)
    || input.amrAuthRequired;
  return shouldForceCloudOnboarding({
    cloudIdentityRejected,
    amcEmbed: input.amcEmbed === true,
    acpSsoConfigured: input.acpSsoConfigured,
    embedSession: input.embedSession,
    routeKind: 'home',
  });
}
